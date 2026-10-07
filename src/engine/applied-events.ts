import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { EventDraft, GameEventPayloads, ResolutionReport } from '../types/game-event.types';
import { captureSourceInformation } from './source-information';
import { getCardInZone } from './zone-transitions';

export interface AppliedMutation {
  mutation: GameMutation;
  before: GameRoom;
  after: GameRoom;
}

/** Compare changed branches of plain immutable game data; shared refs stop traversal. */
export function sameStateValue(before: unknown, after: unknown): boolean {
  if (Object.is(before, after)) return true;
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object') return false;
  if (Array.isArray(before) !== Array.isArray(after)) return false;
  if (Array.isArray(before) && Array.isArray(after) && before.length !== after.length) return false;
  const oldKeys = Object.keys(before);
  const newKeys = Object.keys(after);
  if (oldKeys.length !== newKeys.length) return false;
  const oldObject = before as Record<string, unknown>;
  const newObject = after as Record<string, unknown>;
  return oldKeys.every(key => Object.prototype.hasOwnProperty.call(newObject, key) && sameStateValue(oldObject[key], newObject[key]));
}

/** Pure derivation. New semantic events belong here; logging needs no event-specific cases. */
export function deriveAppliedEvents(batchBefore: GameRoom, batchAfter: GameRoom, steps: AppliedMutation[], resolution?: ResolutionReport,
  observe?: (before: GameRoom, after: GameRoom) => void): EventDraft[] {
  const events: EventDraft[] = [];
  let eventBefore = batchBefore, eventAfter = batchAfter;
  const add = <K extends keyof GameEventPayloads>(eventId: K, payload: GameEventPayloads[K]) => {
    events.push({ eventId, roomId: batchAfter.roomId, payload } as EventDraft);
    observe?.(eventBefore, eventAfter);
  };
  for (const { mutation: m, before, after } of steps) {
    eventBefore = before; eventAfter = after;
    add('MUTATION_APPLIED', { mutation: m });
    if (m.type === 'COUNTER_STACK') {
      const stackObj = before.stack.find(object => object.uuid === m.stackUuid);
      if (stackObj && !after.stack.some(object => object.uuid === m.stackUuid)) {
        add('STACK_COUNTERED', { stackObj });
        if (stackObj.type === 'spell') {
          const card = after.players[stackObj.source.state.ownerId].graveyard.find(card => card.uuid === stackObj.source.uuid);
          if (card) add('CARD_MOVED', { cardUuid: card.uuid, from: 'stack', to: 'graveyard', before: stackObj.source, after: card });
        }
      }
    }
    if (m.type === 'SET_PENDING_CHOICE') {
      if (before.pendingChoice && before.pendingChoice.id !== after.pendingChoice?.id) add('CHOICE_COMPLETED', { choiceId: before.pendingChoice.id, playerId: before.pendingChoice.playerId, kind: before.pendingChoice.kind });
      if (after.pendingChoice && before.pendingChoice?.id !== after.pendingChoice.id) add('CHOICE_REQUESTED', { choiceId: after.pendingChoice.id, playerId: after.pendingChoice.playerId, kind: after.pendingChoice.kind });
    }
    if (m.type === 'MOVE_CARD') {
      const oldCard = getCardInZone(before, m.cardUuid, m.playerId, m.from);
      const newCard = getCardInZone(after, m.cardUuid, m.playerId, m.to);
      if (oldCard && newCard) add('CARD_MOVED', { cardUuid: m.cardUuid, from: m.from, to: m.to, before: oldCard, after: newCard });
      if (m.from === 'battlefield') {
        const departed = oldCard;
        if (departed) {
          const snapshot = m.sourceSnapshot ?? captureSourceInformation(before, departed);
          const payload = { card: snapshot.card, snapshot, controllerId: snapshot.card.state.controllerId };
          add('PERMANENT_LEFT', payload);
          if (m.to === 'graveyard') add('PERMANENT_DIED', payload);
        }
      }
      if (m.to === 'battlefield' && newCard) add('PERMANENT_ENTERED', { card: newCard, controllerId: newCard.state.controllerId });
    }
    if (m.type === 'SET_DAMAGE') {
      const oldCard = before.battlefield.find(card => card.uuid === m.cardUuid);
      const card = after.battlefield.find(card => card.uuid === m.cardUuid);
      const oldDamage = oldCard?.state.damageTaken ?? 0;
      const newDamage = card?.state.damageTaken ?? 0;
      if (card?.blueprint.cardTypes.includes('Creature') && newDamage > oldDamage) {
        add('DAMAGE_TAKEN', { card, controllerId: card.state.controllerId, amount: newDamage - oldDamage, oldDamage, newDamage, source: m.source });
      }
    }
    if (m.type === 'SET_LIFE') {
      const oldLife = before.players[m.playerId].life;
      const newLife = after.players[m.playerId].life;
      if (oldLife !== newLife) add('LIFE_CHANGED', { playerId: m.playerId, oldLife, newLife, amount: newLife - oldLife });
    }
    if (m.type === 'DECLARE_ATTACKERS') {
      add('ATTACKERS_DECLARED', { attackerIds: after.combat.map(decl => decl.attacker.uuid) });
      for (const decl of after.combat) add('ATTACK_DECLARED', { card: decl.attacker, controllerId: decl.attacker.state.controllerId });
    }
    if (m.type === 'COMPLETE_BLOCKER_DECLARATION' || (m.type === 'ASSIGN_BLOCKERS' && !steps.some(step => step.mutation.type === 'COMPLETE_BLOCKER_DECLARATION'))) add('BLOCKERS_DECLARED', {
      blockerAssignments: after.combat.map(decl => ({ attackerUuid: decl.attacker.uuid, blockerUuids: decl.blockers.map(card => card.uuid) })),
    });
    if (m.type === 'SET_PHASE' && before.phase !== after.phase) {
      add('PHASE_CHANGED', { previousPhase: before.phase, phase: after.phase, currentPlayer: after.activeTurnPlayerId });
      if (after.phase === 'stateTurnStart') add('TURN_STARTED', { currentPlayer: after.activeTurnPlayerId });
      if (after.phase === 'upkeepStep') add('UPKEEP_STARTED', { currentPlayer: after.activeTurnPlayerId });
      if (after.phase === 'stateEndPhase') add('END_STEP_STARTED', { currentPlayer: after.activeTurnPlayerId });
      if (after.phase === 'beginCombatStep') add('COMBAT_BEGIN', { currentPlayer: after.activeTurnPlayerId });
      if (after.phase === 'endCombatStep') add('COMBAT_ENDED', { currentPlayer: after.activeTurnPlayerId });
      if (after.phase === 'combatDamageStep') add('COMBAT_DAMAGE_RESOLVED', {
        damageAssignments: steps.map(step => step.mutation).filter(mutation => mutation.type === 'SET_DAMAGE' || mutation.type === 'SET_LIFE'),
      });
    }
    if (m.type === 'SET_TURN' && before.activeTurnPlayerId !== after.activeTurnPlayerId) add('TURN_SWITCHED', { previousPlayer: before.activeTurnPlayerId, newPlayer: after.activeTurnPlayerId });
    if (m.type === 'SET_PRIORITY' && before.priorityPlayerId !== after.priorityPlayerId) add('PRIORITY_GIVEN', { previousPlayer: before.priorityPlayerId, playerId: after.priorityPlayerId });
    if (before.stack !== after.stack) {
      const newAction = after.stack.find(object => !before.stack.some(old => old.uuid === object.uuid));
      add('STACK_UPDATED', { before: before.stack, stack: after.stack, newAction });
      if (newAction) add('ACTION_PROPOSED', { actionType: newAction.type, playerId: newAction.controllerId, stackObj: newAction });
    }
  }
  eventBefore = batchBefore; eventAfter = batchAfter;
  // Completion notifications require the resolving object to have actually left the stack.
  if (resolution && batchBefore.stack.some(object => object.uuid === resolution.stackObj.uuid) && !batchAfter.stack.some(object => object.uuid === resolution.stackObj.uuid)) {
    const stackObj = resolution.stackObj;
    for (const result of resolution.effects) add('STACK_ITEM_RESOLVED', { ...result, stackObj });
    add('STACK_RESOLVED', { effectId: stackObj.effects[0]?.action ?? 'structural', stackObj, countered: stackObj.countered });
  }
  return events;
}
