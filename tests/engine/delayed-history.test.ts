import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import { captureSourceInformation } from '../../src/engine/source-information';
import { registerAction } from '../../src/engine/action-registry';
import { activateAbilityHandler } from '../../src/engine/handlers/activate-ability-handler';
import type { CardInstance, TriggeredAbility } from '../../src/types/card.types';
import { planActionCosts, planManaActivation } from '../../src/engine/action-costs';
import { normalizeAbility } from '../../src/library/card-parser';
import { SyncService } from '../../src/server/sync-service';
import { applyDeltaChanges } from '../../src/client/store/deltaReducer';
import { abilityUseKey } from '../../src/engine/turn-history';
import type { Server } from 'socket.io';

const gain = { action: 'MODIFY_LIFE', params: { amount: 3 }, targeting: { type: 'self' as const, required: false } };
function fixture(ability?: Partial<TriggeredAbility>) {
  const room = createTestRoom(), source = instantiateCard('empire-servant');
  source.state = { ...source.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1', summoningSickness: false };
  source.blueprint = { ...source.blueprint, abilities: ability ? [{ id: 'test', type: 'triggered', castSpeed: 'instant', triggerCondition: 'BEGIN_UPKEEP', effect: gain, ...ability }] : [] };
  room.battlefield = [source]; const engine = new GameEngine(room); engine.initRoom(); return { engine, source };
}
function delayed(engine: GameEngine, source: CardInstance, lifetime: 'once' | 'end_of_turn' | 'permanent' = 'once') {
  return { id: 'delayed', source: structuredClone(source), sourceInfo: captureSourceInformation(engine.roomState, source), controllerId: 'player1', lifetime,
    ability: { id: 'end', type: 'triggered' as const, triggerCondition: 'END_OF_TURN' as const, castSpeed: 'instant' as const, effect: gain } };
}
describe('delayed triggers and event-derived turn history', () => {
  it('creates distinct registrations from two instructions and consumes one-shot triggers only once per batch', () => {
    const { engine, source } = fixture();
    const effect = { action: 'CREATE_DELAYED_TRIGGER', params: { ability: delayed(engine, source).ability }, tags: [], targets: [], targeting: { type: 'self' as const, required: false } };
    engine.roomState.stack.push({ uuid: 'creator', type: 'triggered', source, controllerId: 'player1', countered: false, effects: [effect, effect] });
    engine.resolveTopOfStack(); expect(new Set(engine.roomState.delayedTriggers!.map(trigger => trigger.id)).size).toBe(2);
    engine.applyMutations([{ type: 'SET_PHASE', phase: 'stateEndPhase' }, { type: 'SET_PHASE', phase: 'postcombatMainPhase' }, { type: 'SET_PHASE', phase: 'stateEndPhase' }]);
    expect(engine.roomState.triggerQueue!.entries).toHaveLength(2); expect(engine.roomState.delayedTriggers).toEqual([]); engine.dispose();
  });
  it('keeps permanent delayed registrations across turns and preserves their original controller', () => {
    const { engine, source } = fixture();
    engine.applyMutations([{ type: 'ADD_DELAYED_TRIGGER', registration: delayed(engine, source, 'permanent') }]);
    source.state.controllerId = 'player2';
    engine.applyMutations([{ type: 'SET_PHASE', phase: 'stateEndPhase' }]); expect(engine.roomState.stack[0].controllerId).toBe('player1');
    engine.resolveTopOfStack();
    engine.applyMutations([{ type: 'SET_TURN', playerId: 'player1', advance: true }, { type: 'SET_PHASE', phase: 'postcombatMainPhase' }, { type: 'SET_PHASE', phase: 'stateEndPhase' }]);
    expect(engine.roomState.stack).toHaveLength(1); expect(engine.roomState.delayedTriggers).toHaveLength(1); engine.dispose();
  });
  it('retains changed source characteristics at departure and replays history/registrations through deltas', () => {
    const { engine, source } = fixture();
    const registration = delayed(engine, source); registration.ability.effect = { ...gain, params: { amount: 'DYNAMIC:source.power' } };
    const before = structuredClone(engine.roomState);
    const mutations = engine.applyMutations([{ type: 'ADD_DELAYED_TRIGGER', registration }, { type: 'ADD_COUNTER', cardUuid: source.uuid, counterType: '+1/+1', amount: 2 },
      { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'exile' }, { type: 'SET_PHASE', phase: 'stateEndPhase' }]);
    const sync = new SyncService({} as Server); const delta = sync.buildDelta(before, mutations, { action: 'test', playerId: 'player1' });
    expect(applyDeltaChanges(before, delta.changes)).toEqual(engine.roomState);
    engine.resolveTopOfStack(); expect(engine.roomState.players.player1.life).toBe(23); engine.dispose();
  });
  it('does not see draws that occur later in the same atomic batch', () => {
    const { engine } = fixture({ trigger: { condition: { op: 'gte', left: { path: 'history.own.CARD_DRAWN' }, right: 1 } } });
    const card = instantiateCard('land-red'); card.state.ownerId = card.state.controllerId = 'player1'; engine.roomState.players.player1.deck = [card];
    engine.applyMutations([{ type: 'SET_PHASE', phase: 'upkeepStep' }, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'library', to: 'hand', reason: 'draw' }]);
    expect(engine.roomState.stack).toEqual([]); expect(engine.roomState.turnHistory!.playerCounts.player1.CARD_DRAWN).toBe(1); engine.dispose();
  });
  it('includes the current death in history while retaining pre-departure witnesses', () => {
    const { engine, source } = fixture({ triggerCondition: 'ON_DIE', trigger: { condition: { op: 'gte', left: { path: 'history.own.PERMANENT_DIED' }, right: 1 } } });
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' }]);
    expect(engine.roomState.stack).toHaveLength(1); engine.dispose();
  });
  it('observes simultaneous deaths together in history conditions', () => {
    const { engine, source } = fixture({ triggerCondition: 'ON_DIE', trigger: { subject: 'any', condition: { op: 'gte', left: { path: 'history.own.PERMANENT_DIED' }, right: 2 } } });
    const other = instantiateCard('empire-servant'); other.state = { ...other.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1' };
    other.blueprint = { ...other.blueprint, abilities: [] }; engine.roomState.battlefield.push(other);
    engine.applyMutations([source, other].map(card => ({ type: 'SET_DAMAGE', cardUuid: card.uuid, amount: 100 })));
    expect(engine.roomState.triggerQueue?.entries ?? engine.roomState.stack).toHaveLength(2); engine.dispose();
  });
  it('reserves trigger uses separately for each turn even if one batch crosses a turn boundary', () => {
    const { engine } = fixture({ triggerCondition: 'ON_LIFE_GAIN', limitPerTurn: 1, effect: { ...gain, params: { amount: 0 } } });
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 21 }, { type: 'SET_TURN', playerId: 'player2', advance: true }, { type: 'SET_LIFE', playerId: 'player1', amount: 22 }]);
    expect(engine.roomState.triggerQueue?.entries ?? engine.roomState.stack).toHaveLength(2); engine.dispose();
  });
  it('rolls back limited mana activations when the larger payment fails and prevents repeated nested uses', () => {
    const { engine, source } = fixture();
    source.blueprint = { ...source.blueprint, abilities: [{ id: 'mana', type: 'activated', castSpeed: 'instant', cost: { life: 1 }, limitPerTurn: 1,
      effect: { action: 'ADD_MANA', params: { color: 'red', amount: 1 }, targeting: { type: 'self', required: false } } }] };
    const before = structuredClone(engine.roomState), selection = { cardUuid: source.uuid, abilityId: 'mana' };
    expect(planActionCosts(engine.roomState, 'player1', source, { mana: { generic: 100 } }, { manaActivations: [selection] }).success).toBe(false);
    expect(planActionCosts(engine.roomState, 'player1', source, {}, { manaActivations: [selection, selection] }).success).toBe(false);
    expect(engine.roomState).toEqual(before);
    const first = planManaActivation(engine.roomState, 'player1', selection); expect(first.success).toBe(true);
    if (first.success) engine.applyMutations(first.mutations);
    expect(planManaActivation(engine.roomState, 'player1', selection).success).toBe(false); engine.dispose();
  });
  it('preserves activation limits in normalized definitions and does not consume them for rejected or canceled announcements', () => {
    expect(normalizeAbility({ id: 'limited', type: 'activated', effectId: 'MODIFY_LIFE', limitPerTurn: 1 })?.limitPerTurn).toBe(1);
    const { engine, source } = fixture(); registerAction('activate_ability', activateAbilityHandler);
    source.blueprint = { ...source.blueprint, abilities: [{ id: 'limited', type: 'activated', castSpeed: 'instant', cost: {}, limitPerTurn: 1,
      effect: { action: 'MODIFY_LIFE', params: { amount: -1 }, targeting: { type: 'player', required: true } } }] };
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: source.uuid, abilityId: 'limited', targets: [{ targetType: 'player', playerId: 'missing' }] }).success).toBe(false);
    expect(engine.roomState.turnHistory?.uses ?? {}).toEqual({});
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: source.uuid, abilityId: 'limited' }).success).toBe(true);
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: engine.roomState.pendingChoice!.id, cancel: true }).success).toBe(true);
    expect(engine.roomState.turnHistory?.uses ?? {}).toEqual({}); engine.dispose();
  });
  it('records unlimited trigger and activation uses for history predicates too', () => {
    const { engine, source } = fixture({ effect: { ...gain, params: { amount: 0 } } });
    engine.applyMutations([{ type: 'SET_PHASE', phase: 'upkeepStep' }]);
    expect(engine.roomState.turnHistory!.uses[abilityUseKey(source, 'test')]).toBe(1); engine.resolveTopOfStack();
    source.blueprint = { ...source.blueprint, abilities: [{ id: 'unlimited', type: 'activated', castSpeed: 'instant', cost: {}, effect: { ...gain, params: { amount: 0 } } }] };
    registerAction('activate_ability', activateAbilityHandler);
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: source.uuid, abilityId: 'unlimited' }).success).toBe(true);
    expect(engine.roomState.turnHistory!.uses[abilityUseKey(source, 'unlimited')]).toBe(1); engine.dispose();
  });
  it('lets later events observe prior trigger uses without depending on ability discovery order', () => {
    const { engine, source } = fixture({ id: 'first', triggerCondition: 'ON_LIFE_GAIN', effect: { ...gain, params: { amount: 0 } } });
    const first = source.blueprint.abilities[0] as TriggeredAbility;
    source.blueprint = { ...source.blueprint, abilities: [first, { ...first, id: 'later', trigger: { condition: { op: 'gte', left: { path: 'history.uses.' + abilityUseKey(source, 'first') }, right: 1 } } }] };
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 21 }, { type: 'SET_LIFE', playerId: 'player1', amount: 22 }]);
    const objects = engine.roomState.triggerQueue?.entries.map(entry => entry.object) ?? engine.roomState.stack;
    expect(objects.map(object => object.type === 'triggered' ? object.ability?.id : undefined)).toEqual(['first', 'first', 'later']);
    expect(engine.roomState.turnHistory!.uses[abilityUseKey(source, 'first')]).toBe(2); expect(engine.roomState.turnHistory!.uses[abilityUseKey(source, 'later')]).toBe(1); engine.dispose();
  });
  it('retains a one-shot end-step trigger after source departure and serialized recovery', () => {
    const { engine, source } = fixture();
    engine.applyMutations([{ type: 'ADD_DELAYED_TRIGGER', registration: delayed(engine, source) }, { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'exile' }]);
    const restored = new GameEngine(JSON.parse(JSON.stringify(engine.roomState))); restored.initRoom(); engine.dispose();
    restored.applyMutations([{ type: 'SET_PHASE', phase: 'stateEndPhase' }]); expect(restored.roomState.stack).toHaveLength(1);
    expect(restored.roomState.delayedTriggers).toEqual([]); restored.resolveTopOfStack(); expect(restored.roomState.players.player1.life).toBe(23);
    restored.applyMutations([{ type: 'SET_PHASE', phase: 'postcombatMainPhase' }, { type: 'SET_PHASE', phase: 'stateEndPhase' }]); expect(restored.roomState.stack).toEqual([]); restored.dispose();
  });
  it('expires end-of-turn registrations and can create delayed definitions through a generic effect', () => {
    const { engine, source } = fixture();
    engine.roomState.stack.push({ uuid: 'creator', type: 'triggered', source, controllerId: 'player1', countered: false,
      effects: [{ action: 'CREATE_DELAYED_TRIGGER', params: { ability: delayed(engine, source).ability, lifetime: 'end_of_turn' }, tags: [], targets: [], targeting: { type: 'self', required: false } }] });
    engine.resolveTopOfStack(); expect(engine.roomState.delayedTriggers).toHaveLength(1); expect(engine.roomState.delayedTriggers![0].id).not.toBe('');
    engine.applyMutations([{ type: 'SET_PHASE', phase: 'cleanupStep' }]); expect(engine.roomState.delayedTriggers).toEqual([]); engine.dispose();
  });
  it('enforces a trigger limit across multiple events in one batch and resets on a real new turn', () => {
    const { engine } = fixture({ triggerCondition: 'ON_LIFE_GAIN', limitPerTurn: 1, effect: { ...gain, params: { amount: 0 } } });
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 21 }, { type: 'SET_LIFE', playerId: 'player1', amount: 22 }]); expect(engine.roomState.stack).toHaveLength(1);
    engine.resolveTopOfStack(); engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 23 }]); expect(engine.roomState.stack).toEqual([]);
    engine.applyMutations([{ type: 'SET_TURN', playerId: 'player2', advance: true }, { type: 'SET_LIFE', playerId: 'player1', amount: 24 }]); expect(engine.roomState.stack).toHaveLength(1); engine.dispose();
  });
  it('records draw history for a conditional upkeep trigger and clears it on turn advancement', () => {
    const { engine } = fixture({ trigger: { controller: 'any', condition: { op: 'gte', left: { path: 'history.own.CARD_DRAWN' }, right: 1 } } });
    const card = instantiateCard('land-red'); card.state.ownerId = card.state.controllerId = 'player1'; engine.roomState.players.player1.deck = [card];
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'library', to: 'hand', reason: 'draw' }, { type: 'SET_PHASE', phase: 'upkeepStep' }]);
    expect(engine.roomState.stack).toHaveLength(1); engine.resolveTopOfStack();
    engine.applyMutations([{ type: 'SET_TURN', playerId: 'player2', advance: true }, { type: 'SET_PHASE', phase: 'stateMainPhase' }, { type: 'SET_PHASE', phase: 'upkeepStep' }]);
    expect(engine.roomState.stack).toEqual([]); expect(engine.roomState.turnHistory?.events.some(event => event.eventId === 'CARD_DRAWN')).toBe(false); engine.dispose();
  });
  it('counts successful activations, rejects repeated ones without paying and restores limits after serialization', () => {
    const { engine, source } = fixture(); registerAction('activate_ability', activateAbilityHandler);
    source.blueprint = { ...source.blueprint, abilities: [{ id: 'limited', type: 'activated', castSpeed: 'instant', cost: { mana: { red: 1 } }, effect: gain, limitPerTurn: 1 }] };
    const activate = (current: GameEngine) => current.executePlayerAction('player1', 'activate_ability', { cardUuid: source.uuid, abilityId: 'limited' });
    expect(activate(engine).success).toBe(true); const saved = JSON.parse(JSON.stringify(engine.roomState)); engine.dispose();
    const restored = new GameEngine(saved); restored.initRoom(); const before = structuredClone(restored.roomState);
    expect(activate(restored).success).toBe(false); expect(restored.roomState).toEqual(before);
    restored.applyMutations([{ type: 'SET_TURN', playerId: 'player2', advance: true }]); expect(activate(restored).success).toBe(true); restored.dispose();
  });
});
