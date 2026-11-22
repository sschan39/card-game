import { expect } from 'vitest';
import { parseCardDefinition } from '@library/card-parser';
import { act, castWithPayment, fixtureCard, resolveByPassing, type CardCase } from './card-test-cases';

const gainLife = { family: 'resources', operation: 'adjust_life', params: { amount: 3 } };

export function counterCard(kind: 'spell' | 'ability'): CardCase {
  const counterType = kind === 'spell' ? 'spell' : 'stack';
  const mana = kind === 'spell' ? 2 : 1;
  return {
    name: `counters the selected ${kind} without undoing any paid costs`,
    covers: ['play', 'cast effects'],
    prepare(room) {
      room.activeTurnPlayerId = 'player2';
      room.priorityPlayerId = 'player2';
      const spell = fixtureCard('opposing-spell', 'player2', 'hand', parseCardDefinition({
        schemaVersion: 1, id: 'opposing-spell', cardTypes: ['Spell'], manaCost: '{R}', onCastEffects: [gainLife],
      }));
      const source = fixtureCard('opposing-source', 'player2', 'battlefield', parseCardDefinition({
        schemaVersion: 1, id: 'opposing-source', cardTypes: ['Creature'], power: 2, toughness: 3,
        abilities: [{ id: 'pay-to-heal', type: 'activated', cost: { mana: { green: 1 } }, effect: gainLife }],
      }));
      room.players.player2.hand = [spell];
      room.battlefield = [source];
    },
    run(engine, source) {
      act(engine, 'cast_spell', { cardUuid: 'opposing-spell' }, 'player2');
      act(engine, 'activate_ability', { cardUuid: 'opposing-source', abilityId: 'pay-to-heal' }, 'player2');
      act(engine, 'pass_priority', {}, 'player2');
      const [spell, ability] = engine.roomState.stack;
      const target = kind === 'spell' ? spell : ability;
      const other = kind === 'spell' ? ability : spell;
      expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid,
        targets: [{ targetType: counterType, stackUuid: other.uuid }] }).success).toBe(false);
      castWithPayment(engine, source, { blue: mana }, { targets: [{ targetType: counterType, stackUuid: target.uuid }] });
      resolveByPassing(engine);
      expect(engine.roomState.stack.map(item => item.uuid)).toEqual([other.uuid]);
      expect(engine.roomState.players.player2.life).toBe(20);
      expect(engine.roomState.players.player2.mana).toMatchObject({ red: 4, green: 4 });
      expect(engine.roomState.battlefield).toContainEqual(expect.objectContaining({ uuid: 'opposing-source' }));
      resolveByPassing(engine);
      expect(engine.roomState.players.player2.life).toBe(23);
      expect(engine.drainEventBatches().flatMap(batch => batch.events).filter(event => event.eventId === 'STACK_COUNTERED')).toHaveLength(1);
    },
  };
}
