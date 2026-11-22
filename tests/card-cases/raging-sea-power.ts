import { expect } from 'vitest';
import { castWithPayment, choose, passPriorityPair, type CardCase } from '../helpers/card-test-cases';
import { creature } from '../helpers/combat-fixture';

export default [{
  name: 'draws three before asking the caster to discard exactly two',
  covers: ['play', 'cast effects'],
  prepare(room) {
    room.players.player1.deck = ['left', 'first', 'second', 'third'].map(id => {
      const card = creature(id, 'player1');
      card.state.zone = 'library';
      return card;
    });
  },
  run(engine, source) {
    castWithPayment(engine, source, { blue: 2 });
    passPriorityPair(engine);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['third', 'second', 'first']);
    expect(engine.roomState.pendingChoice?.playerId).toBe('player1');
    choose(engine, ['first', 'third']);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['second']);
    expect(engine.roomState.players.player1.deck.map(card => card.uuid)).toEqual(['left']);
    expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual(expect.arrayContaining(['first', 'third', source.uuid]));
    expect(engine.roomState.players.player1.graveyard).toHaveLength(3);
  },
}] satisfies CardCase[];
