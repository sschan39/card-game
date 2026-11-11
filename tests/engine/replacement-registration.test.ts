import { describe, expect, it } from 'vitest';
import { EffectRegistry } from '@engine/effect-registry';
import { GameEngine } from '@engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import { captureSourceInformation } from '@engine/source-information';
import { planDamage } from '@engine/damage-service';
import { parseCardDefinition } from '@library/card-parser';
import { buildStackEffects } from '@engine/effect-resolver';
import { CardCharacteristicService } from '@engine/card-characteristic-service';

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

  it('grants each selected Ice Dragon a separate shield that refreshes each turn', () => {
    const source = creature('shield-source', 'player1');
    const first = creature('friendly-first', 'player1', 3, 20);
    const second = creature('friendly-second', 'player1', 3, 20);
    const enemy = creature('enemy-dragon', 'player2', 3, 20);
    for (const card of [first, second, enemy]) card.blueprint.subTypes = ['冰龍'];
    const targeting = { type: 'permanent', all: true, controller: 'self', cardTypes: ['Creature'], subTypes: ['冰龍'], required: false };
    source.blueprint = parseCardDefinition({
      schemaVersion: 1, id: 'shield-source', name: 'Shield source', cardTypes: ['Artifact'],
      onCastEffects: [
        { family: 'characteristics', operation: 'create_effect',
          params: { effect: { type: 'STAT_DELTA', power: 2, toughness: 2 }, duration: 'PERMANENT' }, targeting },
        { family: 'characteristics', operation: 'create_effect', targeting, params: {
          duration: 'PERMANENT',
          effect: { type: 'ABILITY', add: [{
            id: 'ice-cover', type: 'static', rules: [{
              id: 'prevent-three', family: 'event-replacements', events: ['damage'],
              scope: { type: 'card', filter: { self: true } },
              operation: { type: 'prevent_damage', amount: 3 },
              usage: { period: 'turn', limit: 1, identity: 'source_incarnation', consume: 'on_change' },
            }],
          }] },
        } },
      ],
    });
    const room = createTestRoom({ battlefield: [source, first, second, enemy] });
    const engine = new GameEngine(room);
    try {
      engine.applyMutations([{ type: 'PUSH_STACK', stackObject: {
        type: 'triggered', uuid: 'shield-grant', source, controllerId: 'player1', countered: false,
        effects: buildStackEffects(source.blueprint.onCastEffects, 'player1', source),
      } }]);
      expect(engine.resolveTopOfStack().success).toBe(true);
      const live = (card: typeof first) => engine.roomState.battlefield.find(item => item.uuid === card.uuid)!;
      expect([first, second, enemy].map(card => CardCharacteristicService.resolve(engine.roomState, live(card)).toughness))
        .toEqual([22, 22, 20]);
      const damage = (card: typeof first, amount: number, preventable = true) => ({
        source: captureSourceInformation(engine.roomState, live(enemy)),
        recipient: { kind: 'permanent' as const, cardUuid: card.uuid, zoneRevision: 0 },
        amount, combat: false, preventable,
      });

      engine.applyMutations(planDamage(engine.roomState, [
        damage(first, 2, false), damage(first, 4), damage(first, 2), damage(second, 4), damage(enemy, 4),
      ]));
      expect([first, second, enemy].map(card => live(card).state.damageTaken)).toEqual([5, 1, 4]);

      engine.applyMutations([{ type: 'SET_TURN', playerId: 'player2', advance: true }]);
      engine.applyMutations(planDamage(engine.roomState, [damage(first, 4), damage(second, 4)]));
      expect([first, second].map(card => live(card).state.damageTaken)).toEqual([6, 2]);
    } finally {
      engine.dispose();
    }
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
