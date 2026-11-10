import { counterCountAfterPlacement } from '../rules/runtime/counter-rules';
// src/engine/game-reducer.ts
// Pure reducer: (state, mutation) => newState.
// Returns a new GameRoom with shallow copies along the changed path.
// Untouched subtrees are shared by reference.

import { recordCardObservation, closeCardObservations, reconcileHandObservations } from './observation-state';
import { createToken } from './token-creation';
import { trackCausalChange } from './change-cause';
import type { GameMutation } from '../types/game-mutation.types';
import type { DamageAssignment } from '../types/damage.types';
import { newTurnHistory } from './turn-history';
import type { GameRoom } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';
import { moveCard } from './zone-transitions';
import { reconcileCombat } from './combat-state';
import { validDamageAssignments } from './damage-service';
import { planDamageResults } from './damage-keywords';
import { nextEffectTimestamp, nextEffectSequence, normalizeContinuousEntry } from './continuous-effects';
import { captureSourceInformation } from './source-information';
import { CardCharacteristicService } from './card-characteristic-service';
import type { OperationOutcome } from '../types/operation-outcome.types';
import { sameStateValue } from '../shared/state-value';
import { applyLibraryReorder, applyLibraryShuffle } from './library-operations';
import { legalEquipmentAttachment } from './mechanics/equipment';

/**
 * Find a card by uuid across all zones in the room.
 * Searches battlefield, stack (inside StackObject.source), and per-player zones.
 */
function findCard(room: GameRoom, cardUuid: string): CardInstance | undefined {
  // battlefield
  const bf = room.battlefield.find(c => c.uuid === cardUuid);

  if (bf) return bf;

  // stack (card lives inside StackObject.source)
  for (const so of room.stack) {
    if (so.source.uuid === cardUuid) return so.source;
  }

  // per-player zones
  for (const player of Object.values(room.players)) {
    const h = player.hand.find(c => c.uuid === cardUuid);

    if (h) return h;

    const gy = player.graveyard.find(c => c.uuid === cardUuid);

    if (gy) return gy;

    const dk = player.deck.find(c => c.uuid === cardUuid);

    if (dk) return dk;
  }

  return undefined;
}

/**
 * Update a card's state on the battlefield. Returns a new room with the card
 * replaced at its index.
 */
function updateCardOnBattlefield(room: GameRoom, cardUuid: string, update: (card: CardInstance) => CardInstance): GameRoom {
  const idx = room.battlefield.findIndex(c => c.uuid === cardUuid);

  // Guard: a card that is not on the battlefield leaves the room untouched.
  if (idx === -1) return room;

  const updated = update(room.battlefield[idx]);

  return {
    ...room,
    battlefield: [
      ...room.battlefield.slice(0, idx),
      updated,
      ...room.battlefield.slice(idx + 1),
    ],
  };
}

/**
 * Update a card's state in a per-player zone. Returns a new room.
 */
function updateCardInPlayerZone(
  room: GameRoom,
  cardUuid: string,
  playerId: string,
  zone: 'hand' | 'graveyard' | 'deck',
  update: (card: CardInstance) => CardInstance,
): GameRoom {
  const player = room.players[playerId];

  // Guard: an unknown player leaves the room untouched.
  if (!player) return room;

  const arr = player[zone];
  const idx = arr.findIndex(c => c.uuid === cardUuid);

  // Guard: a card that is not in the zone leaves the room untouched.
  if (idx === -1) return room;

  const updated = update(arr[idx]);
  const newArr = [...arr.slice(0, idx), updated, ...arr.slice(idx + 1)];

  return {
    ...room,
    players: {
      ...room.players,
      [playerId]: {
        ...player,
        [zone]: newArr,
      },
    },
  };
}

/**
 * Pure reducer: (state, mutation) => newState.
 */
export function gameReducer(state: GameRoom, mutation: GameMutation): GameRoom {
  return reduceGameOperation(state, mutation).state;
}

/** Atomic reducer operation: no rules checkpoint may observe a partially damaged board. */
export function reduceDamageBatch(room: GameRoom, proposed: readonly DamageAssignment[], results?: GameMutation[]): GameRoom {
  const assignments = validDamageAssignments(room, proposed);

  // Guard: nothing valid to apply means no state change at all.
  if (!assignments.length) return room;

  return (results ?? planDamageResults(room, assignments)).reduce(gameReducer, room);
}

/** Authoritative operation outcome; preview/replay use its state-only projection. */
export function reduceGameOperation(state: GameRoom, mutation: GameMutation): OperationOutcome {
  // Guard: a finished game rejects every further mutation.
  if (state.status === 'gameOver' || state.outcome) return { status: 'rejected', state, reason: 'Game is over' };

  const result = reduceMutation(state, mutation);
  const outcome: OperationOutcome = 'state' in result ? result
    : sameStateValue(state, result) ? { status: 'unchanged', state } : { status: 'committed', state: result };

  // Only a committed change can affect derived characteristics.
  if (outcome.status !== 'committed') return outcome;

  let next = outcome.state;
  const characteristicsChanged = next !== state && (next.battlefield !== state.battlefield || next.continuousEffectPool !== state.continuousEffectPool ||
    next.stack !== state.stack || mutation.type === 'MOVE_CARD' || mutation.type === 'SET_PLAYER_ZONES');

  if (characteristicsChanged) {
    const worldTimestamp = Math.max(nextEffectTimestamp(state), next.effectTimestamp ?? 0);
    let worldGained = false;
    const changed = next.battlefield.map(card => {
      const previous = state.battlefield.find(c => c.uuid === card.uuid && (c.state.zoneRevision ?? 0) === (card.state.zoneRevision ?? 0));

      // A permanent that changed controller is summoning sick again.
      let updated = previous && CardCharacteristicService.resolveController(state, previous) !== CardCharacteristicService.resolveController(next, card)
        ? { ...card, state: { ...card.state, summoningSickness: true } } : card;

      const wasWorld = !!previous && CardCharacteristicService.resolve(state, previous).superTypes.includes('World');
      const isWorld = CardCharacteristicService.resolve(next, card).superTypes.includes('World');

      // A newly world-typed permanent stamps the world timestamp; a lost one clears it.
      if (isWorld && !wasWorld) {
        worldGained = true;
        updated = { ...updated, state: { ...updated.state, worldTimestamp } };
      } else if (!isWorld && updated.state.worldTimestamp !== undefined) {
        const { worldTimestamp: removed, ...rest } = updated.state;

        updated = { ...updated, state: rest };
      }

      return updated;
    });

    if (changed.some((c, i) => c !== next.battlefield[i])) next = { ...next, battlefield: changed };

    if (worldGained) next = { ...next, effectTimestamp: worldTimestamp };
  }

  if (mutation.type === 'MOVE_CARD' || mutation.type === 'SET_PLAYER_ZONES' || mutation.type === 'CLEAR_END_OF_TURN_EFFECTS')
    next = reconcileHandObservations(next, mutation.type === 'CLEAR_END_OF_TURN_EFFECTS');
  if (next.status === 'gameOver') next = closeCardObservations(next);
  for (const object of state.stack) {
    if (!next.stack.some(current => current.uuid === object.uuid)) next = closeCardObservations(next, object.uuid);
  }
  next = characteristicsChanged || next.combat !== state.combat ? reconcileCombat(next) : next;

  return { ...outcome, state: trackCausalChange(state, next, mutation) };
}

function reduceMutation(state: GameRoom, mutation: GameMutation): GameRoom | OperationOutcome {
  // Terminal snapshots are immutable, including duplicate END_GAME messages.
  if (state.status === 'gameOver' || state.outcome) return state;

  switch (mutation.type) {
    case 'CREATE_TOKEN': return createToken(state, mutation);
    case 'RECORD_CARD_OBSERVATION': return recordCardObservation(state, mutation.observation, mutation.sequence);
    case 'CLOSE_CARD_OBSERVATIONS': return closeCardObservations(state, mutation.ownerStackUuid);
    case 'SHUFFLE_LIBRARY': return applyLibraryShuffle(state, mutation);
    case 'REORDER_LIBRARY': return applyLibraryReorder(state, mutation);

    case 'ADD_REPLACEMENT_EFFECT': {
      // Guard: a rule with an explicit id is only registered once.
      if (mutation.effect.id && state.replacementEffects?.some(rule => rule.id === mutation.effect.id)) return state;

      let sequence = (state.replacementSequence ?? 0) + 1;

      while (state.replacementEffects?.some(rule => rule.id === `replacement:${state.roomId}:${sequence}`)) sequence++;

      const effect = {
        ...structuredClone(mutation.effect),
        id: mutation.effect.id ?? `replacement:${state.roomId}:${sequence}`,
        ...(mutation.effect.duration === 'end_of_turn' && mutation.effect.expiresTurn === undefined ? { expiresTurn: state.turnNumber ?? 1 } : {}),
      };

      return { ...state, replacementSequence: sequence, replacementEffects: [...state.replacementEffects ?? [], effect] };
    }

    case 'REMOVE_REPLACEMENT_EFFECT': return { ...state, replacementEffects: (state.replacementEffects ?? []).filter(rule => rule.id !== mutation.id) };

    case 'CEASE_CARD': {
      // A token spell on the stack is removed from the stack itself.
      if (mutation.zone === 'stack') return {
        ...state,
        stack: state.stack.filter(object => !(object.type === 'spell' && object.source.isToken && object.source.uuid === mutation.cardUuid && (object.source.state.zoneRevision ?? 0) === mutation.zoneRevision)),
      };

      const key = mutation.zone === 'library' ? 'deck' : mutation.zone === 'hand' || mutation.zone === 'graveyard' || mutation.zone === 'exile' ? mutation.zone : undefined;
      const player = state.players[mutation.playerId];

      // Guard: the zone must be a per-player zone holding that exact token.
      if (!key || !player || !player[key]?.some(c => c.isToken && c.uuid === mutation.cardUuid && (c.state.zoneRevision ?? 0) === mutation.zoneRevision)) return state;

      return { ...state, players: { ...state.players, [player.id]: { ...player, [key]: player[key]!.filter(c => c.uuid !== mutation.cardUuid) } } };
    }

    case 'ATTACH_CARD': return legalEquipmentAttachment(state, mutation) ? updateCardOnBattlefield(state, mutation.cardUuid, card => ({
      ...card,
      state: {
        ...card.state,
        attachedTo: mutation.hostUuid,
        attachedToRevision: mutation.hostRevision,
        attachedToPlayerId: null,
      },
    })) : state;

    case 'UNATTACH_CARD': return updateCardOnBattlefield(state, mutation.cardUuid, card => ({
      ...card,
      state: { ...card.state, attachedTo: null, attachedToPlayerId: null, attachedToRevision: undefined },
    }));

    case 'SET_BATTLE_PROTECTOR': return updateCardOnBattlefield(state, mutation.cardUuid, card => ({
      ...card,
      state: { ...card.state, protectorId: mutation.playerId },
    }));

    case 'SET_REPLACEMENT_EFFECTS': return { ...state, replacementEffects: mutation.effects };
    case 'SET_COMBAT_DAMAGE': return { ...state, combatDamage: mutation.state };

    case 'APPLY_DAMAGE_BATCH': return validDamageAssignments(state, mutation.assignments).length
      ? { status: 'committed', state: reduceDamageBatch(state, mutation.assignments, mutation.results) }
      : { status: 'rejected', state, reason: 'No valid damage assignments' };

    case 'CHANGE_LIFE': return !state.players[mutation.playerId] ? state : {
      ...state,
      players: { ...state.players, [mutation.playerId]: { ...state.players[mutation.playerId], life: state.players[mutation.playerId].life + mutation.amount } },
    };

    case 'SET_FAILED_DRAW': return !state.players[mutation.playerId] ? state : {
      ...state,
      players: { ...state.players, [mutation.playerId]: { ...state.players[mutation.playerId], failedDraw: mutation.value } },
    };

    case 'DRAW_CARDS': {
      let next = state;

      for (let i = 0; i < mutation.amount; i++) {
        const player = next.players[mutation.playerId];

        if (!player) break;

        const card = player.deck[player.deck.length - 1];

        next = card ? gameReducer(next, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: card.state.ownerId, from: 'library', to: 'hand', reason: 'draw' })
          : gameReducer(next, { type: 'SET_FAILED_DRAW', playerId: player.id, value: true });
      }

      return next;
    }

    case 'MARK_DAMAGE': return updateCardOnBattlefield(state, mutation.cardUuid, card => (card.state.zoneRevision ?? 0) !== mutation.zoneRevision ? card : ({
      ...card,
      state: { ...card.state, damageTaken: card.state.damageTaken + mutation.amount },
    }));

    case 'SET_DEATHTOUCH_DAMAGE': return updateCardOnBattlefield(state, mutation.cardUuid, card => ({
      ...card,
      state: { ...card.state, deathtouchDamage: mutation.value },
    }));

    case 'DESTROY_CARD':
    case 'SACRIFICE_CARD': {
      const card = state.battlefield.find(c => c.uuid === mutation.cardUuid && (c.state.zoneRevision ?? 0) === mutation.zoneRevision);

      // Guard: the permanent must still exist, and an indestructible one survives destroy.
      if (!card || mutation.type === 'DESTROY_CARD' && CardCharacteristicService.resolveKeywords(state, card).some(k => k.toLowerCase() === 'indestructible')) return state;

      return gameReducer(state, {
        type: 'MOVE_CARD',
        cardUuid: card.uuid,
        playerId: card.state.ownerId,
        from: 'battlefield',
        to: 'graveyard',
        reason: mutation.type === 'DESTROY_CARD' ? 'destroy' : 'sacrifice',
      });
    }

    case 'REGENERATE_CARD': {
      const card = state.battlefield.find(c => c.uuid === mutation.cardUuid && (c.state.zoneRevision ?? 0) === mutation.zoneRevision);

      // Guard: a permanent that already left the battlefield cannot regenerate.
      if (!card) return state;

      const next = updateCardOnBattlefield(state, card.uuid, c => ({
        ...c,
        state: { ...c.state, isTapped: true, damageTaken: 0, deathtouchDamage: false },
      }));

      // Regenerating also removes the permanent from combat.
      return { ...next, combat: next.combat.filter(d => d.attacker.uuid !== card.uuid).map(d => ({ ...d, blockers: d.blockers.filter(c => c.uuid !== card.uuid) })) };
    }

    case 'SET_PENDING_CHOICE': return { ...state, pendingChoice: mutation.choice };
    case 'SET_PENDING_TRIGGERS': return { ...state, pendingTriggers: mutation.mutations };
    case 'SET_TRIGGER_QUEUE': return { ...state, triggerQueue: mutation.queue };

    case 'ADD_DELAYED_TRIGGER': return mutation.registration.id && state.delayedTriggers?.some(trigger => trigger.id === mutation.registration.id) ? state
      : { ...state, delayedTriggers: [...state.delayedTriggers ?? [], mutation.registration] };

    case 'REMOVE_DELAYED_TRIGGER': return { ...state, delayedTriggers: (state.delayedTriggers ?? []).filter(trigger => trigger.id !== mutation.id) };
    case 'SET_TURN_HISTORY': return { ...state, turnHistory: mutation.history };

    case 'RECORD_GAME_RULE_USE': return { ...state, gameRuleUses: { ...state.gameRuleUses, [mutation.key]: (state.gameRuleUses?.[mutation.key] ?? 0) + 1 } };

    case 'RECORD_LAND_PLAY': {
      // Guard: a stale turn number is ignored.
      if (mutation.turnNumber !== undefined && mutation.turnNumber !== (state.turnNumber ?? 1)) return state;

      const history = state.turnHistory ?? newTurnHistory(state.turnNumber ?? 1);

      return { ...state, turnHistory: { ...history, landPlays: { ...history.landPlays, [mutation.playerId]: (history.landPlays?.[mutation.playerId] ?? 0) + 1 } } };
    }

    case 'RECORD_ABILITY_USE': {
      // Guard: a stale turn number is ignored.
      if (mutation.turnNumber !== undefined && mutation.turnNumber !== (state.turnNumber ?? 1)) return state;

      const history = state.turnHistory ?? newTurnHistory(state.turnNumber ?? 1);

      return { ...state, turnHistory: { ...history, uses: { ...history.uses, [mutation.key]: (history.uses[mutation.key] ?? 0) + 1 } } };
    }

    case 'END_GAME':
      return {
        ...state,
        status: 'gameOver',
        outcome: mutation.outcome,
        pendingChoice: null,
        pendingTriggers: [],
        triggerQueue: null,
        stack: [],
        engineState: 'game_over',
        priorityPlayerId: null,
        lastPassedPlayerId: null,
      };

    // -- Player mutations --
    case 'SET_PLAYER_ZONES': {
      const player = state.players[mutation.playerId];

      // Guard: an unknown player leaves the room untouched.
      if (!player) return state;

      return {
        ...state,
        players: {
          ...state.players,
          [mutation.playerId]: {
            ...player,
            deck: mutation.deck,
            hand: mutation.hand,
          },
        },
      };
    }

    case 'SET_LIFE':
      return {
        ...state,
        players: {
          ...state.players,
          [mutation.playerId]: {
            ...state.players[mutation.playerId],
            life: mutation.amount,
          },
        },
      };

    case 'SET_MANA':
      return {
        ...state,
        players: {
          ...state.players,
          [mutation.playerId]: {
            ...state.players[mutation.playerId],
            mana: {
              ...state.players[mutation.playerId].mana,
              [mutation.color]: mutation.amount,
            },
          },
        },
      };

    case 'ADD_MANA':
      return {
        ...state,
        players: {
          ...state.players,
          [mutation.playerId]: {
            ...state.players[mutation.playerId],
            mana: {
              ...state.players[mutation.playerId].mana,
              [mutation.color]: (state.players[mutation.playerId].mana[mutation.color] ?? 0) + mutation.amount,
            },
          },
        },
      };

    case 'SPEND_MANA': {
      const player = state.players[mutation.playerId];
      const newMana = { ...player.mana };

      for (const [color, amount] of Object.entries(mutation.cost)) {
        newMana[color as keyof typeof newMana] -= amount!;
      }

      return {
        ...state,
        players: {
          ...state.players,
          [mutation.playerId]: {
            ...player,
            mana: newMana,
          },
        },
      };
    }

    // -- Card state mutations --
    case 'TAP_CARD':
      return updateCardOnBattlefield(state, mutation.cardUuid, card => ({
        ...card,
        state: { ...card.state, isTapped: true },
      }));

    case 'UNTAP_CARD':
      return updateCardOnBattlefield(state, mutation.cardUuid, card => ({
        ...card,
        state: { ...card.state, isTapped: false },
      }));

    case 'SET_SUMMONING_SICKNESS':
      return updateCardOnBattlefield(state, mutation.cardUuid, card => ({
        ...card,
        state: { ...card.state, summoningSickness: mutation.value },
      }));

    case 'SET_ATTACKED_THIS_TURN':
      return updateCardOnBattlefield(state, mutation.cardUuid, card => ({
        ...card,
        state: { ...card.state, attackedThisTurn: mutation.value },
      }));

    case 'SET_DAMAGE':
      return updateCardOnBattlefield(state, mutation.cardUuid, card => ({
        ...card,
        state: { ...card.state, damageTaken: mutation.amount },
      }));

    case 'CLEAR_DAMAGE':
      return {
        ...state,
        battlefield: state.battlefield.map(card => ({
          ...card,
          state: { ...card.state, damageTaken: 0, ...(card.state.deathtouchDamage !== undefined ? { deathtouchDamage: false } : {}) },
        })),
      };

    case 'ADD_COUNTER':
      return updateCardOnBattlefield(state, mutation.cardUuid, card => {
        const current = card.state.counters[mutation.counterType] ?? 0;
        const count = counterCountAfterPlacement(mutation.counterType, current, mutation.amount);
        if (count === current) return card;
        return {
          ...card,
          state: { ...card.state, counters: { ...card.state.counters, [mutation.counterType]: count } },
        };
      });

    case 'REMOVE_COUNTER':
      return updateCardOnBattlefield(state, mutation.cardUuid, card => ({
        ...card,
        state: {
          ...card.state,
          counters: {
            ...card.state.counters,
            [mutation.counterType]: Math.max(0, (card.state.counters[mutation.counterType] || 0) - mutation.amount),
          },
        },
      }));

    // -- Continuous effect pool mutations --
    case 'ADD_CONTINUOUS_EFFECT': {
      // Guard: an entry with an explicit id is only added once.
      if (mutation.entry.id && state.continuousEffectPool.some(e => e.id === mutation.entry.id)) return state;

      const entry = normalizeContinuousEntry(state, mutation.entry);

      return {
        ...state,
        effectTimestamp: Math.max(state.effectTimestamp ?? 0, entry.timestamp!),
        effectSequence: nextEffectSequence(state),
        continuousEffectPool: [...state.continuousEffectPool, entry],
      };
    }

    case 'REMOVE_CONTINUOUS_EFFECT':
      return {
        ...state,
        continuousEffectPool: state.continuousEffectPool.filter(
          entry => mutation.id !== undefined ? entry.id !== mutation.id : entry.source !== mutation.source || (mutation.dependentOnly === true && entry.requiredZone === null),
        ),
      };

    case 'CLEAR_END_OF_TURN_EFFECTS':
      return {
        ...state,
        ...(state.replacementEffects ? { replacementEffects: state.replacementEffects.filter(rule => rule.duration !== 'end_of_turn') } : {}),
        continuousEffectPool: state.continuousEffectPool.filter(
          entry => entry.duration !== 'END_OF_TURN',
        ),
      };

    // -- Zone mutations --
    case 'MOVE_CARD': {
      const moved = moveCard(state, mutation);

      // Guard: a rejected move leaves the room untouched.
      if (moved === state) return moved;

      const timestamp = nextEffectTimestamp(state);

      return { ...moved, effectTimestamp: timestamp };
    }

    // -- Stack mutations --
    case 'REMOVE_STACK': {
      const object = state.stack.find(item => item.uuid === mutation.stackUuid);

      // Guard: a spell leaves the stack through a zone move, not a plain removal.
      return !object || object.type === 'spell' ? state : { ...state, stack: state.stack.filter(item => item.uuid !== mutation.stackUuid) };
    }

    case 'COUNTER_STACK': {
      const object = state.stack.find(item => item.uuid === mutation.stackUuid);

      // Guard: an unknown stack object cannot be countered.
      if (!object) return state;

      // A countered spell goes to its owner's graveyard; an ability just leaves the stack.
      return object.type === 'spell' ? moveCard(state, { type: 'MOVE_CARD', cardUuid: object.source.uuid, playerId: object.source.state.ownerId, from: 'stack', to: 'graveyard' })
        : { ...state, stack: state.stack.filter(item => item.uuid !== mutation.stackUuid) };
    }

    case 'PUSH_STACK':
      return {
        ...state,
        stack: [...state.stack, mutation.stackObject],
      };

    case 'POP_STACK': {
      // Guard: an empty stack has nothing to pop.
      if (state.stack.length === 0) return state;

      return {
        ...state,
        stack: state.stack.slice(0, -1),
      };
    }

    case 'SET_COUNTERED': {
      const stackIdx = state.stack.findIndex(so => so.uuid === mutation.stackUuid);

      // Guard: an unknown stack object cannot be marked countered.
      if (stackIdx === -1) return state;

      const updated = { ...state.stack[stackIdx], countered: true };

      return {
        ...state,
        stack: [
          ...state.stack.slice(0, stackIdx),
          updated,
          ...state.stack.slice(stackIdx + 1),
        ],
      };
    }

    case 'SET_FIZZLED': {
      const stackIdx = state.stack.findIndex(so => so.uuid === mutation.stackUuid);

      // Guard: an unknown stack object cannot be marked fizzled.
      if (stackIdx === -1) return state;

      const updated = { ...state.stack[stackIdx], fizzled: true };

      return {
        ...state,
        stack: [
          ...state.stack.slice(0, stackIdx),
          updated,
          ...state.stack.slice(stackIdx + 1),
        ],
      };
    }

    // -- Combat mutations (turn-based action — declared attackers) --
    case 'DECLARE_ATTACKERS':
      return {
        ...state,
        combat: mutation.declarations,
        combatDeclarations: { attackers: true, blockers: false },
      };

    case 'ASSIGN_BLOCKERS': {
      const updatedCombat = state.combat.map(decl =>
        decl.attacker.uuid === mutation.attackerUuid
          ? {
            ...decl,
            blocked: decl.blocked || mutation.blockerUuids.length > 0,
            blockers: mutation.blockerUuids
              .map(uuid => findCard(state, uuid))
              .filter((c): c is NonNullable<typeof c> => c !== undefined)
              .map(card => captureSourceInformation(state, card).card),
          }
          : decl,
      );

      return { ...state, combat: updatedCombat };
    }

    case 'COMPLETE_BLOCKER_DECLARATION':
      return { ...state, combatDeclarations: { attackers: state.combatDeclarations?.attackers ?? true, blockers: true } };

    case 'CLEAR_COMBAT':
      return {
        ...state,
        combat: [],
        combatDamage: null,
        combatDeclarations: { attackers: false, blockers: false },
      };

    // -- Phase / Turn mutations --
    case 'SET_PHASE':
      return {
        ...state,
        phase: mutation.phase,
        ...(mutation.phase === 'cleanupStep' && state.delayedTriggers ? { delayedTriggers: state.delayedTriggers.filter(trigger => trigger.lifetime !== 'end_of_turn') } : {}),
      };

    case 'SET_STATUS':
      return { ...state, status: mutation.status };

    case 'SET_ENGINE_STATE':
      return { ...state, engineState: mutation.state };

    case 'SET_TURN':
      return {
        ...state,
        activeTurnPlayerId: mutation.playerId,
        ...(mutation.advance ? { turnNumber: (state.turnNumber ?? 1) + 1, turnHistory: newTurnHistory((state.turnNumber ?? 1) + 1) } : {}),
      };

    case 'SET_PRIORITY':
      return { ...state, priorityPlayerId: mutation.playerId };

    case 'SET_LAST_PASSED':
      return { ...state, lastPassedPlayerId: mutation.playerId };

    // -- RPS mutations --
    case 'SET_RPS_STATUS':
      return {
        ...state,
        rpsState: { ...state.rpsState, status: mutation.status },
      };

    case 'SET_RPS_PLAYED_CARD':
      return {
        ...state,
        rpsState: {
          ...state.rpsState,
          playedCards: {
            ...state.rpsState.playedCards,
            [mutation.playerId]: mutation.card,
          },
        },
      };

    default:
      return state;
  }
}
