import { expect } from 'vitest';
import { parseCardDefinition } from '@library/card-parser';
import { act, castWithPayment, fixtureCard, resolveByPassing, type CardCase } from './card-test-cases';

export function sourceCounter(mode: 'bottom' | 'discard' | 'destroy' | 'returned'): CardCase {
  const zone = mode === 'discard' ? 'hand' : 'battlefield';
  return {
    name: `counters the effect and handles its source (${mode})`,
    covers: ['play', 'cast effects'],
    prepare(room) {
      room.activeTurnPlayerId = 'player2';
      room.priorityPlayerId = 'player2';
      const source = fixtureCard('ability-source', 'player2', zone, parseCardDefinition({
        schemaVersion: 1, id: 'ability-source', cardTypes: ['Creature'], power: 2, toughness: 3,
        abilities: [{ id: 'heal', type: 'activated', allowedZones: [zone], effect: {
          family: 'resources', operation: 'adjust_life', params: { amount: 3 },
        } }],
      }));
      if (zone === 'hand') room.players.player2.hand.push(source);
      else room.battlefield.push(source);
      room.players.player2.deck.push(fixtureCard('original-bottom', 'player2', 'library'));
    },
    run(engine, source) {
      act(engine, 'activate_ability', { cardUuid: 'ability-source', abilityId: 'heal' }, 'player2');
      if (mode === 'returned') {
        engine.applyMutations([
          { type: 'MOVE_CARD', cardUuid: 'ability-source', playerId: 'player2', from: 'battlefield', to: 'exile' },
          { type: 'MOVE_CARD', cardUuid: 'ability-source', playerId: 'player2', from: 'exile', to: 'battlefield' },
        ]);
      }
      act(engine, 'pass_priority', {}, 'player2');
      const pending = engine.roomState.stack[0].uuid;
      castWithPayment(engine, source, mode === 'bottom' || mode === 'returned' ? { white: 2 } : { yellow: 2 },
        { targets: [{ targetType: 'stack', stackUuid: pending }] });
      resolveByPassing(engine);
      expect(engine.roomState.stack).toHaveLength(0);
      expect(engine.roomState.players.player2.life).toBe(20);
      expect(engine.roomState.battlefield.some(card => card.uuid === 'ability-source')).toBe(mode === 'returned');
      expect(engine.roomState.players.player2.deck.map(card => card.uuid))
        .toEqual(mode === 'bottom' ? ['ability-source', 'original-bottom'] : ['original-bottom']);
      expect(engine.roomState.players.player2.graveyard.map(card => card.uuid))
        .toEqual(mode === 'destroy' || mode === 'discard' ? ['ability-source'] : []);
      const events = engine.drainEventBatches().flatMap(batch => batch.events).map(event => event.eventId);
      expect(events).toContain('STACK_COUNTERED');
      if (mode === 'discard') expect(events).toContain('CARD_DISCARDED_FROM_HAND');
      if (mode === 'destroy') expect(events).toContain('PERMANENT_DESTROYED');
    },
  };
}
