import { answerSingleRecipientCombat } from '../helpers/combat-fixture';
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import { EffectRegistry } from '../../src/engine/effect-registry';
import { registerAction } from '../../src/engine/action-registry';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { SyncService } from '../../src/server/sync-service';
import { applyDeltaChanges } from '../../src/client/store/deltaReducer';
import type { TriggerEvent, CardInstance } from '../../src/types/card.types';
import type { StackObject } from '../../src/types/effect.types';
import { captureSourceInformation } from '../../src/engine/source-information';

function game(events: TriggerEvent[]) {
  const room = createTestRoom(), source = instantiateCard('empire-servant');
  source.state = { ...source.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1' };
  source.blueprint = { ...source.blueprint, abilities: events.map(triggerCondition => ({ id: triggerCondition, type: 'triggered', castSpeed: 'instant', triggerCondition,
    effect: { action: 'MODIFY_LIFE', params: { amount: 0 }, targeting: { type: 'self', required: false } } })) };
  room.battlefield = [source]; const engine = new GameEngine(room); engine.initRoom();
  const ids = () => engine.roomState.stack.map(object => object.type === 'triggered' ? object.ability?.triggerCondition : undefined);
  return { room, source, engine, ids };
}
function spell(source: CardInstance): StackObject { return { uuid: 'fixture', type: 'triggered', controllerId: 'player1', source, countered: false, effects: [] }; }
function settleOrdering(engine: GameEngine) {
  while (engine.roomState.pendingChoice?.kind === 'ordering') {
    const choice = engine.roomState.pendingChoice;
    expect(engine.executePlayerAction(choice.playerId, 'choose', { choiceId: choice.id, choices: choice.options.map(option => option.id) }).success).toBe(true);
  }
}
describe('canonical trigger events from committed changes', () => {
  it('publishes combat completion after damage and its history are applied', () => {
    const { engine, source, ids } = game(['COMBAT_DAMAGE']);
    source.state.ownerId = source.state.controllerId = 'player2';
    source.blueprint = { ...source.blueprint, abilities: source.blueprint.abilities.map(ability => ({ ...ability, trigger: { controller: 'any', condition: { all: [
      { op: 'eq', left: { path: 'controller.life' }, right: 19 }, { op: 'eq', left: { path: 'history.own.LIFE_LOST' }, right: 1 },
    ] } } } as import('../../src/types/card.types').TriggeredAbility)) };
    const attacker = instantiateCard('empire-servant'); attacker.state = { ...attacker.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1' };
    attacker.blueprint = { ...attacker.blueprint, abilities: [] }; engine.roomState.battlefield.push(attacker);
    engine.roomState.phase = 'declareBlockersStep'; engine.roomState.combatDeclarations = { attackers: true, blockers: true };
    engine.roomState.combat = [{ uuid: 'combat', attacker, attackerPower: 1, blockers: [] }];
    engine.advancePhase('complete'); expect(ids()).toEqual([]);
    answerSingleRecipientCombat(engine);
    expect(engine.roomState.players.player2.life).toBe(19); expect(ids()).toEqual(['COMBAT_DAMAGE']);
    const events = engine.drainEventBatches().flatMap(batch => batch.events);
    expect(events.findIndex(event => event.eventId === 'LIFE_LOST')).toBeLessThan(events.findIndex(event => event.eventId === 'COMBAT_DAMAGE_RESOLVED')); engine.dispose();
  });
  it('emits a blocker subject only when declaration is completed', () => {
    const { engine, source, ids } = game(['ON_BLOCK']);
    const attacker = instantiateCard('empire-servant'); attacker.state = { ...attacker.state, zone: 'battlefield', ownerId: 'player2', controllerId: 'player2' };
    attacker.blueprint = { ...attacker.blueprint, abilities: [] }; engine.roomState.battlefield.push(attacker);
    engine.applyMutations([{ type: 'DECLARE_ATTACKERS', declarations: [{ uuid: 'combat', attacker, attackerPower: 1, blockers: [] }] }, { type: 'ASSIGN_BLOCKERS', attackerUuid: attacker.uuid, blockerUuids: [source.uuid] }]);
    expect(ids()).toEqual([]); engine.applyMutations([{ type: 'COMPLETE_BLOCKER_DECLARATION' }]); expect(ids()).toEqual(['ON_BLOCK']); engine.dispose();
  });
  it('routes a default combat damage step trigger with turn ownership', () => {
    const { engine, ids } = game(['COMBAT_DAMAGE']);
    engine.roomState.phase = 'declareBlockersStep';
    engine.roomState.combatDeclarations = { attackers: true, blockers: true };
    engine.advancePhase('complete');
    expect(ids()).toEqual(['COMBAT_DAMAGE']); engine.dispose();
  });
  it.each([false, true])('retains the original departed damage source, including returned=%s', returned => {
    const { engine, source: watcher, ids } = game(['ON_DAMAGE_DEALT']);
    const ability = watcher.blueprint.abilities[0];
    if (ability.type !== 'triggered') throw new Error('fixture');
    watcher.blueprint = { ...watcher.blueprint, abilities: [{ ...ability, trigger: { subject: 'another', controller: 'self', cardTypes: ['Creature'] } }] };
    const source = instantiateCard('empire-servant');
    source.state = { ...source.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1', zoneRevision: 0 };
    source.blueprint = { ...source.blueprint, abilities: [] }; engine.roomState.battlefield.push(source);
    engine.applyMutations([{ type: 'PUSH_STACK', stackObject: { ...spell(structuredClone(source)), sourceInfo: captureSourceInformation(engine.roomState, source),
      effects: [{ action: 'MODIFY_LIFE', params: { amount: -2 }, tags: ['damage'], targeting: { type: 'player', required: true, maxTargets: 1 }, targets: [{ targetType: 'player', playerId: 'player2' }] }] } }]);
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'exile' },
      ...(returned ? [{ type: 'MOVE_CARD' as const, cardUuid: source.uuid, playerId: 'player1', from: 'exile' as const, to: 'battlefield' as const, controllerId: 'player2' }] : [])]);
    engine.resolveTopOfStack(); expect(ids()).toEqual(['ON_DAMAGE_DEALT']);
    const event = engine.drainEventBatches().flatMap(batch => batch.events).find(event => event.eventId === 'DAMAGE_DEALT');
    expect(event?.payload).toMatchObject({ controllerId: 'player1', card: { uuid: source.uuid, state: { zoneRevision: 0, controllerId: 'player1' } } }); engine.dispose();
  });
  it('distinguishes sourced damage from life loss and records only new damage', () => {
    const { engine, source, ids } = game(['ON_DAMAGE_DEALT']);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player2', amount: 18 }]); expect(ids()).toEqual([]);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player2', amount: 15, damageSource: source.uuid, combat: true }]);
    expect(ids()).toEqual(['ON_DAMAGE_DEALT']);
    const event = engine.drainEventBatches().flatMap(batch => batch.events).find(event => event.eventId === 'DAMAGE_DEALT');
    expect(event?.payload).toMatchObject({ amount: 3, combat: true, recipient: { playerId: 'player2' }, card: { uuid: source.uuid } });
    engine.dispose();
  });
  it('separates life gain and loss and retains the incremental amount', () => {
    const { engine, ids } = game(['ON_LIFE_GAIN', 'ON_LIFE_LOSS']);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 23 }, { type: 'SET_LIFE', playerId: 'player1', amount: 21 }]);
    settleOrdering(engine);
    expect(ids()).toEqual(['ON_LIFE_GAIN', 'ON_LIFE_LOSS']);
    const events = engine.drainEventBatches().flatMap(batch => batch.events);
    expect(events.find(event => event.eventId === 'LIFE_GAINED')?.payload.amount).toBe(3);
    expect(events.find(event => event.eventId === 'LIFE_LOST')?.payload.amount).toBe(2); engine.dispose();
  });
  it('draws and discards fire only for those semantic actions', () => {
    const { engine, source, ids } = game(['ON_DRAW', 'ON_DISCARD_FROM_HAND']);
    const card = instantiateCard('land-red'); card.state.ownerId = card.state.controllerId = 'player1'; engine.roomState.players.player1.deck = [card];
    engine.applyMutations(EffectRegistry.DRAW(engine.roomState, spell(source), { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self', required: false }, targets: [] }));
    expect(ids()).toEqual(['ON_DRAW']);
    engine.applyMutations(EffectRegistry.DISCARD_HAND(engine.roomState, spell(source), { action: 'DISCARD_HAND', params: {}, tags: [], targeting: { type: 'self', required: false }, targets: [] }));
    settleOrdering(engine);
    expect(ids().filter(id => id === 'ON_DISCARD_FROM_HAND')).toHaveLength(2);
    const returned = engine.roomState.players.player1.graveyard[0];
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: returned.uuid, playerId: 'player1', from: 'graveyard', to: 'hand' }, { type: 'MOVE_CARD', cardUuid: returned.uuid, playerId: 'player1', from: 'hand', to: 'graveyard' }]);
    expect(ids().filter(id => id === 'ON_DISCARD_FROM_HAND')).toHaveLength(2); engine.dispose();
  });
  it('fires spell cast after successful stack insertion and never for rejection or resolution', () => {
    const { engine, ids } = game(['ON_SPELL_CAST']); registerAction('cast_spell', playCardHandler);
    const card = engine.roomState.players.player1.hand[0];
    card.blueprint = { ...card.blueprint, cardTypes: ['Spell'], onCastEffects: [], castRequirements: { allowedZones: ['hand'], speed: 'instant', cost: {} } };
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: 'missing' }).success).toBe(false); expect(ids()).toEqual([]);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }).success).toBe(true);
    expect(ids()).toEqual([undefined, 'ON_SPELL_CAST']);
    engine.resolveTopOfStack(); engine.resolveTopOfStack(); expect(ids()).toEqual([]); engine.dispose();
  });
  it('noncreatures going to the graveyard leave without dying', () => {
    const { engine, source, ids } = game(['ON_DIE', 'ON_LEAVE_BATTLEFIELD']);
    source.blueprint = { ...source.blueprint, cardTypes: ['Artifact'] };
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' }]);
    expect(ids()).toEqual(['ON_LEAVE_BATTLEFIELD']);
    expect(engine.drainEventBatches().flatMap(batch => batch.events).some(event => event.eventId === 'PERMANENT_DIED')).toBe(false); engine.dispose();
  });
  it.each(['hand', 'exile'] as const)('departure to %s emits leave, preserves identity/revision and replays deltas', destination => {
    const { engine, source, ids } = game(['ON_DIE', 'ON_LEAVE_BATTLEFIELD']); const before = structuredClone(engine.roomState);
    const mutations = engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: destination }]);
    expect(ids()).toEqual(['ON_LEAVE_BATTLEFIELD']); expect(engine.roomState.battlefield).toEqual([]);
    const cards = destination === 'hand' ? engine.roomState.players.player1.hand : engine.roomState.players.player1.exile;
    expect(cards?.find(card => card.uuid === source.uuid)?.state).toMatchObject({ zone: destination, zoneRevision: 1 });
    const delta = new SyncService({} as never).buildDelta(before, mutations, { action: 'fixture', playerId: 'player1' });
    expect(applyDeltaChanges(before, delta.changes)).toEqual(engine.roomState); engine.dispose();
  });
});
