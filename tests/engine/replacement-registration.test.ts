import { describe, expect, it } from 'vitest';
import { EffectRegistry } from '../../src/engine/effect-registry';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import { captureSourceInformation } from '../../src/engine/source-information';
import { planDamage } from '../../src/engine/damage-service';

describe('serializable replacement registration lifecycle', () => {
  it('creates independent targeted shields with monotonic IDs and expires them at cleanup', () => {
    const source = creature('source', 'player1');
    const room = createTestRoom({ battlefield: [source] });
    const engine = new GameEngine(room);
    const stack = { type: 'activated' as const, uuid: 's', source, controllerId: 'player1', effects: [], countered: false };
    const effect = { action: 'CREATE_REPLACEMENT_EFFECT', params: { definition: { label: 'Prevent next three', operation: { type: 'prevent_damage' }, match: { kinds: ['damage'] }, remaining: 3, duration: 'end_of_turn' } },
      tags: [], targeting: { type: 'player' as const }, targets: [{ targetType: 'player' as const, playerId: 'player1' }, { targetType: 'player' as const, playerId: 'player2' }] };
    engine.applyMutations(EffectRegistry.CREATE_REPLACEMENT_EFFECT(room, stack, effect));
    const effects = engine.roomState.replacementEffects!;
    expect(effects).toHaveLength(2);
    expect(new Set(effects.map(e => e.id)).size).toBe(2);
    expect(effects.map(e => e.match?.playerId)).toEqual(['player1', 'player2']);
    engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }]);
    expect(engine.roomState.replacementEffects).toEqual([]);
    engine.applyMutations(EffectRegistry.CREATE_REPLACEMENT_EFFECT(engine.roomState, stack, effect));
    expect(engine.roomState.replacementEffects!.every(e => !effects.some(old => old.id === e.id))).toBe(true);
    engine.dispose();
  });

  it('creates a generic regeneration shield that survives the source leaving', () => {
    const source = creature('source', 'player1'); const target = creature('target', 'player1');
    const room = createTestRoom({ battlefield: [source, target] });
    const engine = new GameEngine(room);
    const stack = { type: 'activated' as const, uuid: 's', source, controllerId: 'player1', effects: [], countered: false };
    const effect = { action: 'REGENERATE', params: {}, tags: [], targeting: { type: 'permanent' as const }, targets: [{ targetType: 'permanent' as const, cardUuid: 'target', zoneRevision: 0 }] };
    engine.applyMutations(EffectRegistry.REGENERATE(room, stack, effect));
    engine.applyMutations([{ type: 'SACRIFICE_CARD', cardUuid: 'source', zoneRevision: 0 }, { type: 'DESTROY_CARD', cardUuid: 'target', zoneRevision: 0 }]);
    expect(engine.roomState.battlefield.map(c => c.uuid)).toEqual(['target']);
    expect(engine.roomState.battlefield[0].state.isTapped).toBe(true);
    expect(engine.roomState.replacementEffects).toEqual([]); engine.dispose();
  });

  it('does not consume prevention shields on damage that cannot be prevented', () => {
    const source = creature('source', 'player1');
    const room = createTestRoom({ battlefield: [source], replacementEffects: [{ id: 'shield', label: 'Shield', remaining: 3, operation: { type: 'prevent_damage' }, match: { kinds: ['damage'] } }] });
    const engine = new GameEngine(room);
    engine.applyMutations(planDamage(room, [{ source: captureSourceInformation(room, source), recipient: { kind: 'player', playerId: 'player2' }, amount: 2, combat: false, preventable: false }]));
    expect(engine.roomState.players.player2.life).toBe(18);
    expect(engine.roomState.replacementEffects?.[0].remaining).toBe(3); engine.dispose();
  });
});
