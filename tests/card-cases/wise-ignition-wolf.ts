import { expect } from 'vitest';
import { act, castWithPayment, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [
  {
    name: 'discards itself from hand to place two Scorch without mana',
    covers: ['ability:discard-scorch'],
    prepare(room) {
      room.activeTurnPlayerId = 'player2';
      room.battlefield = [fixtureCard('enemy', 'player2', 'battlefield'), fixtureCard('ally', 'player1', 'battlefield')];
    },
    run(engine, source) {
      const activate = (id: string) => ({ cardUuid: source.uuid, abilityId: 'discard-scorch',
        targets: [{ targetType: 'permanent', cardUuid: id }] });
      expect(engine.executePlayerAction('player1', 'activate_ability', activate('ally')).success).toBe(false);
      expect(engine.roomState.players.player1.hand[0].uuid).toBe(source.uuid);
      act(engine, 'activate_ability', activate('enemy'));
      expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual([source.uuid]);
      resolveByPassing(engine);
      expect(engine.roomState.battlefield.find(card => card.uuid === 'enemy')?.state.counters.scorch).toBe(2);
      expect(engine.roomState.players.player1.mana.red).toBe(5);
    },
  },
  {
    name: 'enters for three red and resolves later friendly creature casts immediately',
    covers: ['play'],
    prepare(room) {
      room.players.player1.hand.push(fixtureCard('friendly', 'player1', 'hand'));
    },
    run(engine, source) {
      castWithPayment(engine, source, { red: 3 });
      resolveByPassing(engine);
      act(engine, 'cast_spell', { cardUuid: 'friendly' });
      expect(engine.roomState.stack).toHaveLength(0);
      expect(engine.roomState.battlefield.some(card => card.uuid === 'friendly')).toBe(true);
    },
  },
] satisfies CardCase[];
