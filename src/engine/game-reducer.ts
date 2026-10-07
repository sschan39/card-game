// src/engine/game-reducer.ts
// Pure reducer: (state, mutation) => newState.
// Returns a new GameRoom with shallow copies along the changed path.
// Untouched subtrees are shared by reference.

import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';
import { moveCard } from './zone-transitions';

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
  if (!player) return room;

  const arr = player[zone];
  const idx = arr.findIndex(c => c.uuid === cardUuid);
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
  // Terminal snapshots are immutable, including duplicate END_GAME messages.
  if (state.status === 'gameOver' || state.outcome) return state;
  switch (mutation.type) {
    case 'END_GAME':
      return {
        ...state,
        status: 'gameOver',
        outcome: mutation.outcome,
        engineState: 'game_over',
        priorityPlayerId: null,
        lastPassedPlayerId: null,
      };
    // -- Player mutations --
    case 'SET_PLAYER_ZONES': {
      const player = state.players[mutation.playerId];
      if (!player) return state;
      return { ...state, players: { ...state.players, [mutation.playerId]: {
        ...player, deck: mutation.deck, hand: mutation.hand,
      } } };
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
          state: { ...card.state, damageTaken: 0 },
        })),
      };

    case 'ADD_COUNTER':
      return updateCardOnBattlefield(state, mutation.cardUuid, card => ({
        ...card,
        state: {
          ...card.state,
          counters: {
            ...card.state.counters,
            [mutation.counterType]: (card.state.counters[mutation.counterType] || 0) + mutation.amount,
          },
        },
      }));

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
    case 'ADD_CONTINUOUS_EFFECT':
      return {
        ...state,
        continuousEffectPool: [...state.continuousEffectPool, mutation.entry],
      };

    case 'REMOVE_CONTINUOUS_EFFECT':
      return {
        ...state,
        continuousEffectPool: state.continuousEffectPool.filter(
          entry => entry.source !== mutation.source
        ),
      };

    case 'CLEAR_END_OF_TURN_EFFECTS':
      return {
        ...state,
        continuousEffectPool: state.continuousEffectPool.filter(
          entry => entry.duration !== 'END_OF_TURN'
        ),
      };

    // -- Zone mutations --
    case 'MOVE_CARD': return moveCard(state, mutation);

    // -- Stack mutations --
    case 'PUSH_STACK':
      return {
        ...state,
        stack: [...state.stack, mutation.stackObject],
      };

    case 'POP_STACK': {
      if (state.stack.length === 0) return state;
      return {
        ...state,
        stack: state.stack.slice(0, -1),
      };
    }

    case 'SET_COUNTERED': {
      const stackIdx = state.stack.findIndex(so => so.uuid === mutation.stackUuid);
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
              blockers: mutation.blockerUuids
                .map(uuid => findCard(state, uuid))
                .filter((c): c is NonNullable<typeof c> => c !== undefined),
            }
          : decl
      );
      return { ...state, combat: updatedCombat };
    }

    case 'COMPLETE_BLOCKER_DECLARATION':
      return { ...state, combatDeclarations: { attackers: state.combatDeclarations?.attackers ?? true, blockers: true } };

    case 'CLEAR_COMBAT':
      return {
        ...state,
        combat: [],
        combatDeclarations: { attackers: false, blockers: false },
      };

    // -- Phase / Turn mutations --
    case 'SET_PHASE':
      return { ...state, phase: mutation.phase };

    case 'SET_STATUS':
      return { ...state, status: mutation.status };

    case 'SET_ENGINE_STATE':
      return { ...state, engineState: mutation.state };

    case 'SET_TURN':
      return { ...state, activeTurnPlayerId: mutation.playerId, ...(mutation.advance ? { turnNumber: (state.turnNumber ?? 1) + 1 } : {}) };

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
