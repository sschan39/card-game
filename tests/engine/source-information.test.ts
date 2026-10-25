import { describe, expect, it } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '@library/card-factory';
import { CardCharacteristicService } from '@engine/card-characteristic-service';
import type { ActionCost, EffectDefinition } from '@shared/effect.types';
import { ModifierRegistry } from '@engine/modifier-registry';

function fixture(cost: ActionCost = {}, effect: EffectDefinition = { action: 'MODIFY_STATS', params: { damage: 'DYNAMIC:source.power' }, targeting: { type: 'permanent', required: true, maxTargets: 1 } }) {
  const room = createTestRoom(); const source = instantiateCard('card_09876_core_set'), target = instantiateCard('empire-servant');
  source.blueprint = { ...source.blueprint, abilities: [{ id: 'test', type: 'activated', castSpeed: 'instant', cost, effect }] };
  target.blueprint = { ...target.blueprint, toughness: 20, abilities: [] };
  for (const card of [source, target]) card.state = { ...card.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1', summoningSickness: false };
  room.battlefield = [source, target]; const engine = new GameEngine(room); engine.initRoom();
  const activate = () => engine.executePlayerAction('player1', 'activate_ability', { cardUuid: source.uuid, abilityId: 'test', ...(effect.targeting.type === 'self' ? {} : { targets: [{ targetType: 'permanent', cardUuid: target.uuid }] }) });
  return { engine, source, target, activate };
}
describe('independent ability sources and last-known information', () => {
  it.each(['ON_DIE', 'ON_DAMAGE_TAKEN'] as const)('retains immediate departure characteristics for %s discovered after a sequential batch', triggerCondition => {
    const { engine, source } = fixture();
    source.blueprint = { ...source.blueprint, abilities: [{ type: 'triggered', triggerCondition,
      effect: { action: 'MODIFY_LIFE', params: { amount: 'DYNAMIC:source.power' }, targeting: { type: 'self', required: false } } }] };
    engine.roomState.continuousEffectPool.push({ source: source.uuid, layer: 7, effect: { type: 'STAT_DELTA', power: 2 }, scope: { cardUuid: source.uuid }, duration: 'WHILE_ON_BATTLEFIELD' });
    engine.applyMutations([
      { type: 'ADD_COUNTER', cardUuid: source.uuid, counterType: '+1/+1', amount: 2 },
      { type: 'SET_DAMAGE', cardUuid: source.uuid, amount: 1 },
      { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' },
    ]);
    expect(engine.roomState.stack).toHaveLength(1);
    expect(engine.roomState.stack[0].sourceInfo?.power).toBe(9);
    const departure = engine.drainEventBatches().flatMap(batch => batch.events).find(event => event.eventId === 'PERMANENT_LEFT');
    expect(departure?.payload.snapshot.power).toBe(9);
    engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.life).toBe(29);
    engine.dispose();
  });
  it('uses current source characteristics after activation', () => {
    const { engine, source, target, activate } = fixture(); expect(activate().success).toBe(true);
    engine.applyMutations([{ type: 'ADD_COUNTER', cardUuid: source.uuid, counterType: '+1/+1', amount: 2 }]);
    engine.resolveTopOfStack(); expect(engine.roomState.battlefield.find(card => card.uuid === target.uuid)!.state.damageTaken).toBe(7); engine.dispose();
  });
  it('uses departure information after counters change and the persistent card returns', () => {
    const { engine, source, target, activate } = fixture(); activate();
    engine.applyMutations([{ type: 'ADD_COUNTER', cardUuid: source.uuid, counterType: '+1/+1', amount: 2 },
      { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' },
      { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'graveyard', to: 'battlefield' }]);
    const restored = new GameEngine(JSON.parse(JSON.stringify(engine.roomState))); restored.initRoom(); engine.dispose();
    restored.resolveTopOfStack(); expect(restored.roomState.battlefield.find(card => card.uuid === target.uuid)!.state.damageTaken).toBe(7);
    expect(restored.roomState.battlefield.find(card => card.uuid === source.uuid)!.state.counters).toEqual({}); restored.dispose();
  });
  it('captures derived source information when sacrifice is paid before stack insertion', () => {
    const { engine, source, target, activate } = fixture({ sacrifice: true });
    engine.roomState.continuousEffectPool.push({ source: source.uuid, layer: 7, effect: { type: 'STAT_DELTA', power: 2 }, scope: { cardUuid: source.uuid }, duration: 'WHILE_ON_BATTLEFIELD' });
    expect(activate().success).toBe(true); expect(engine.roomState.battlefield.some(card => card.uuid === source.uuid)).toBe(false);
    engine.resolveTopOfStack(); expect(engine.roomState.battlefield.find(card => card.uuid === target.uuid)!.state.damageTaken).toBe(7); engine.dispose();
  });
  it('keeps a resolved temporary buff after its source leaves and excludes a returned target', () => {
    const { engine, source, target, activate } = fixture({}, { action: 'GRANT_STATS', params: { power: 2 }, targeting: { type: 'permanent', required: true, maxTargets: 1 } });
    activate(); engine.resolveTopOfStack();
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' }]);
    const buffed = engine.roomState.battlefield.find(card => card.uuid === target.uuid)!;
    expect(CardCharacteristicService.resolvePower(engine.roomState, buffed)).toBe(3);
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: target.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' },
      { type: 'MOVE_CARD', cardUuid: target.uuid, playerId: 'player1', from: 'graveyard', to: 'battlefield' }]);
    expect(CardCharacteristicService.resolvePower(engine.roomState, engine.roomState.battlefield[0])).toBe(1); engine.dispose();
  });
  it('uses the shared preceding state for simultaneous state-based departures', () => {
    const { engine, source, target, activate } = fixture();
    const anthem = instantiateCard('empire-servant'); anthem.blueprint = { ...anthem.blueprint, abilities: [] };
    anthem.state = { ...anthem.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1', summoningSickness: false };
    engine.roomState.battlefield = [anthem, source, target];
    engine.roomState.continuousEffectPool.push({ source: anthem.uuid, layer: 7, effect: { type: 'STAT_DELTA', power: 2 }, scope: { cardTypes: ['Creature'] }, duration: 'WHILE_ON_BATTLEFIELD' });
    activate(); engine.applyMutations([anthem, source].map(card => ({ type: 'SET_DAMAGE', cardUuid: card.uuid, amount: 100 })));
    engine.resolveTopOfStack(); expect(engine.roomState.battlefield.find(card => card.uuid === target.uuid)!.state.damageTaken).toBe(7); engine.dispose();
  });
  it('passes dynamic source information to any effect primitive', () => {
    const { engine, source, activate } = fixture({}, { action: 'MODIFY_LIFE', params: { amount: 'DYNAMIC:source.power' }, targeting: { type: 'self', required: false } });
    activate(); engine.applyMutations([{ type: 'ADD_COUNTER', cardUuid: source.uuid, counterType: '+1/+1', amount: 2 }]);
    engine.resolveTopOfStack(); expect(engine.roomState.players.player1.life).toBe(27); engine.dispose();
  });
  it('uses current source information for target permission revalidation', () => {
    const { engine, source, target, activate } = fixture();
    const unregister = ModifierRegistry.registerTargetRule((_room, _player, card) => (card.state.counters['+1/+1'] ?? 0) < 2);
    try {
      activate(); engine.applyMutations([{ type: 'ADD_COUNTER', cardUuid: source.uuid, counterType: '+1/+1', amount: 2 }]);
      engine.resolveTopOfStack(); expect(engine.roomState.battlefield.find(card => card.uuid === target.uuid)!.state.damageTaken).toBe(0);
    } finally { unregister(); engine.dispose(); }
  });
});
