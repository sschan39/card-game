import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { registerAction } from '../../src/engine/action-registry';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { activateAbilityHandler } from '../../src/engine/handlers/activate-ability-handler';
import { instantiateCard } from '../../src/library/card-factory';
import { createTestRoom } from '../helpers/test-room-factory';
import type { CardInstance } from '../../src/types/card.types';
import { EffectRegistry } from '../../src/engine/effect-registry';

function fixture() {
  registerAction('cast_spell', playCardHandler); registerAction('activate_ability', activateAbilityHandler);
  const room = createTestRoom(); const engine = new GameEngine(room); engine.initRoom();
  return engine;
}
function owned(id: string, playerId: string, zone: 'hand' | 'battlefield' = 'hand'): CardInstance {
  const card = instantiateCard(id); card.state = { ...card.state, zone, ownerId: playerId, controllerId: playerId, summoningSickness: false };
  return card;
}
describe('selected stack counter operations', () => {
  it('removes the resolving ability by UUID while preserving an object added by its instruction', () => {
    const engine = fixture(), source = owned('card_09876_core_set', 'player1', 'battlefield');
    const ability = source.blueprint.abilities[0];
    if (ability.type !== 'activated') throw new Error('fixture');
    source.blueprint = { ...source.blueprint, abilities: [{ ...ability, effect: { action: 'TEST_PUSH', params: {}, targeting: { type: 'self', required: false } } }] };
    engine.roomState.battlefield = [source];
    EffectRegistry.TEST_PUSH = (_room, stack) => [{ type: 'PUSH_STACK', stackObject: { ...stack, uuid: 'new-object', effects: [] } }];
    try {
      expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: source.uuid, abilityId: ability.id }).success).toBe(true);
      engine.resolveTopOfStack();
      expect(engine.roomState.stack.map(object => object.uuid)).toEqual(['new-object']);
    } finally { delete EffectRegistry.TEST_PUSH; engine.dispose(); }
  });
  it('counters a spell immediately, preserves paid costs, and publishes its removal', () => {
    const engine = fixture(), spell = owned('broken-fireball', 'player1'), counter = owned('counterspell-fixture', 'player2');
    engine.roomState.players.player1.hand = [spell]; engine.roomState.players.player2.hand = [counter]; engine.roomState.players.player2.mana.blue = 3;
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: spell.uuid, targets: [{ targetType: 'player', playerId: 'player2' }] }).success).toBe(true);
    const target = engine.roomState.stack[0].uuid;
    engine.passPriority('player1');
    expect(engine.executePlayerAction('player2', 'cast_spell', { cardUuid: counter.uuid, targets: [{ targetType: 'spell', stackUuid: target }] }).success).toBe(true);
    engine.drainEventBatches(); engine.resolveTopOfStack();
    expect(engine.roomState.stack).toEqual([]);
    expect(engine.roomState.players.player1.graveyard.map(c => c.uuid)).toContain(spell.uuid);
    expect(engine.roomState.players.player2.graveyard.map(c => c.uuid)).toContain(counter.uuid);
    expect(engine.roomState.players.player1.mana.red).toBe(4); expect(engine.roomState.players.player2.mana.blue).toBe(1);
    expect(engine.roomState.players.player2.life).toBe(20);
    expect(engine.drainEventBatches().flatMap(batch => batch.events).some(event => event.eventId === 'STACK_COUNTERED')).toBe(true); engine.dispose();
  });
  it('removes a chosen lower ability without moving its source or removing other objects', () => {
    const engine = fixture(), source = owned('card_09876_core_set', 'player1', 'battlefield'); engine.roomState.battlefield = [source];
    for (let index = 0; index < 2; index++) expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: source.uuid, abilityId: 'firebreathing' }).success).toBe(true);
    const [lower, upper] = engine.roomState.stack;
    engine.applyMutations([{ type: 'COUNTER_STACK', stackUuid: lower.uuid }]);
    expect(engine.roomState.stack.map(object => object.uuid)).toEqual([upper.uuid]);
    expect(engine.roomState.battlefield.map(card => card.uuid)).toEqual([source.uuid]);
    expect(engine.roomState.players.player1.mana.red).toBe(3); engine.dispose();
  });
  it('ability-counter data rejects spells and accepts activated abilities', () => {
    const engine = fixture(), counter = owned('ability-counter-fixture', 'player1'), spell = owned('broken-fireball', 'player1'), source = owned('card_09876_core_set', 'player1', 'battlefield');
    engine.roomState.battlefield = [source]; engine.roomState.players.player1.hand = [counter, spell]; engine.roomState.players.player1.mana.blue = 2;
    engine.executePlayerAction('player1', 'activate_ability', { cardUuid: source.uuid, abilityId: 'firebreathing' });
    const target = engine.roomState.stack[0].uuid;
    engine.executePlayerAction('player1', 'cast_spell', { cardUuid: spell.uuid, targets: [{ targetType: 'player', playerId: 'player2' }] });
    const before = structuredClone(engine.roomState);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: counter.uuid, targets: [{ targetType: 'stack', stackUuid: engine.roomState.stack[1].uuid }] }).success).toBe(false);
    expect(engine.roomState).toEqual(before);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: counter.uuid, targets: [{ targetType: 'stack', stackUuid: target }] }).success).toBe(true);
    engine.resolveTopOfStack(); expect(engine.roomState.stack).toHaveLength(1); expect(engine.roomState.stack[0].type).toBe('spell'); expect(engine.roomState.battlefield).toHaveLength(1); engine.dispose();
  });
});
