import { describe, expect, it } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import { GameEngine } from '../../src/engine/game-engine';
import { EffectRegistry } from '../../src/engine/effect-registry';
import { ModifierRegistry } from '../../src/engine/modifier-registry';
import type { EffectDefinition } from '../../src/types/effect.types';

function fixture(cardTypes = ['Spell']) {
  const room = createTestRoom();
  const card = room.players.player1.hand[0];
  const creature = instantiateCard('empire-servant');
  creature.state = { ...creature.state, zone: 'battlefield', ownerId: 'player2', controllerId: 'player2' };
  room.battlefield = [creature];
  const damage: EffectDefinition = { targetGroup: 'victim', action: 'MODIFY_STATS', params: { damage: 1 }, tags: ['damage'], targeting: { type: 'permanent', cardTypes: ['Creature'], required: true, maxTargets: 1 } };
  card.blueprint = { ...card.blueprint, cardTypes, onCastEffects: [damage,
    { action: 'MODIFY_LIFE', params: { amount: 3 }, targeting: { type: 'self', required: false } }], castRequirements: { allowedZones: ['hand'], speed: 'instant', cost: { mana: { red: 1 } } } };
  const engine = new GameEngine(room); engine.initRoom();
  return { engine, card, creature, damage };
}
function cast(f: ReturnType<typeof fixture>, groups?: unknown) {
  expect(f.engine.executePlayerAction('player1', 'cast_spell', { cardUuid: f.card.uuid, targetGroups: groups ?? [{ id: 'victim', targets: [{ targetType: 'permanent', cardUuid: f.creature.uuid }] }] }).success).toBe(true);
}

describe('whole-object resolution', () => {
  it('executes no effects when all chosen targets are illegal, retaining paid costs', () => {
    const f = fixture(); cast(f);
    f.engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: f.creature.uuid, playerId: 'player2', from: 'battlefield', to: 'hand' }]);
    const result = f.engine.resolveTopOfStack();
    expect(f.engine.roomState.players.player1.life).toBe(20);
    expect(f.engine.roomState.players.player1.mana.red).toBe(4);
    expect(result.success && result.resolution?.stackObj.fizzled).toBe(true);
    expect(f.engine.roomState.players.player1.graveyard.map(c => c.uuid)).toContain(f.card.uuid); f.engine.dispose();
  });
  it('sends a failed targeted permanent spell to the graveyard rather than the battlefield', () => {
    const f = fixture(['Creature']); cast(f);
    f.engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: f.creature.uuid, playerId: 'player2', from: 'battlefield', to: 'hand' }]);
    f.engine.resolveTopOfStack();
    expect(f.engine.roomState.battlefield.map(c => c.uuid)).not.toContain(f.card.uuid);
    expect(f.engine.roomState.players.player1.graveyard.map(c => c.uuid)).toContain(f.card.uuid); f.engine.dispose();
  });
  it('resolves surviving target groups and untargeted effects when some targets remain legal', () => {
    const f = fixture();
    f.card.blueprint = { ...f.card.blueprint, onCastEffects: [f.damage,
      { targetGroup: 'player', action: 'MODIFY_LIFE', params: { amount: -2 }, targeting: { type: 'player', required: true, maxTargets: 1 } },
      f.card.blueprint.onCastEffects![1]] };
    cast(f, [{ id: 'victim', targets: [{ targetType: 'permanent', cardUuid: f.creature.uuid }] }, { id: 'player', targets: [{ targetType: 'player', playerId: 'player2' }] }]);
    f.engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: f.creature.uuid, playerId: 'player2', from: 'battlefield', to: 'hand' }]);
    const result = f.engine.resolveTopOfStack();
    expect(result.success && result.resolution?.stackObj.fizzled).toBe(false);
    expect(result.success && result.resolution?.effects[0]).toMatchObject({ fizzled: false, skipped: 'illegal_targets' });
    expect(f.engine.roomState.players.player2.life).toBe(18);
    expect(f.engine.roomState.players.player1.life).toBe(23); f.engine.dispose();
  });
  it('allows an optional targeting clause with no chosen targets to resolve', () => {
    const f = fixture();
    f.card.blueprint = { ...f.card.blueprint, onCastEffects: [{ ...f.damage, targeting: { ...f.damage.targeting, required: false, minTargets: 0 } }, f.card.blueprint.onCastEffects![1]] };
    cast(f, [{ id: 'victim', targets: [] }]); const result = f.engine.resolveTopOfStack();
    expect(result.success && result.resolution?.effects[0].skipped).toBeUndefined();
    expect(f.engine.roomState.players.player1.life).toBe(23); f.engine.dispose();
  });
  it('checks target legality once and keeps the spell on the stack while instructions execute', () => {
    const f = fixture();
    const observations: boolean[] = [];
    EffectRegistry.TEST_OBSERVE = (room, stack, effect) => {
      observations.push(room.stack.some(s => s.uuid === stack.uuid));
      return effect.targets[0]?.cardUuid ? [{ type: 'TAP_CARD', cardUuid: effect.targets[0].cardUuid }] : [];
    };
    try {
      f.card.blueprint = { ...f.card.blueprint, onCastEffects: [
        { ...f.damage, action: 'TEST_OBSERVE' }, { ...f.damage, action: 'TEST_OBSERVE' },
      ] };
      cast(f); f.engine.resolveTopOfStack();
      expect(observations).toEqual([true, true]); f.engine.dispose();
    } finally { delete EffectRegistry.TEST_OBSERVE; }
  });
  it('does not recheck permissions between instructions in the same resolution', () => {
    const f = fixture(); let allowed = true; let calls = 0;
    const remove = ModifierRegistry.registerTargetRule(() => allowed);
    EffectRegistry.TEST_CHANGE_PERMISSION = () => { allowed = false; calls++; return []; };
    EffectRegistry.TEST_USE_TARGET = (_room, _stack, effect) => { if (effect.targets.length) calls++; return []; };
    try {
      f.card.blueprint = { ...f.card.blueprint, onCastEffects: [{ ...f.damage, action: 'TEST_CHANGE_PERMISSION' }, { ...f.damage, action: 'TEST_USE_TARGET' }] };
      cast(f); f.engine.resolveTopOfStack(); expect(calls).toBe(2);
    } finally { remove(); delete EffectRegistry.TEST_CHANGE_PERMISSION; delete EffectRegistry.TEST_USE_TARGET; f.engine.dispose(); }
  });
  it('does not affect a returned card later in the same resolution', () => {
    const f = fixture();
    EffectRegistry.TEST_RETURN = () => [
      { type: 'MOVE_CARD', cardUuid: f.creature.uuid, playerId: 'player2', from: 'battlefield', to: 'hand' },
      { type: 'MOVE_CARD', cardUuid: f.creature.uuid, playerId: 'player2', from: 'hand', to: 'battlefield' },
    ];
    try {
      f.card.blueprint = { ...f.card.blueprint, onCastEffects: [{ ...f.damage, action: 'TEST_RETURN' }, { ...f.damage, action: 'TAP' }] };
      cast(f); f.engine.resolveTopOfStack();
      const returned = f.engine.roomState.battlefield.find(c => c.uuid === f.creature.uuid)!;
      expect(returned.state.zoneRevision).toBe(2); expect(returned.state.isTapped).toBe(false);
    } finally { delete EffectRegistry.TEST_RETURN; f.engine.dispose(); }
  });
});
