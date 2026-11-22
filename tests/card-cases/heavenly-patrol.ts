import { expect } from 'vitest';
import { castWithPayment, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'draws for positive charge on the named Emperor once per turn',
  covers: ['play', 'ability:emperor-charge-draw'],
  prepare(room) {
    room.battlefield = [
      fixtureCard('emperor', 'player1', 'battlefield', { name: '天使皇 亞拉里亞', cardTypes: ['Land'] }),
      fixtureCard('wrong-name', 'player1', 'battlefield', { cardTypes: ['Land'] }),
    ];
    room.players.player1.deck = ['second', 'first'].map(id => fixtureCard(id, 'player1', 'library'));
  },
  run(engine, source) {
    castWithPayment(engine, source, { yellow: 2 });
    resolveByPassing(engine);
    const change = (cardUuid: string, counterType: string, amount = 1) => engine.applyMutations([
      { type: 'ADD_COUNTER', cardUuid, counterType, amount },
    ]);
    change('wrong-name', 'charge');
    change('emperor', 'other');
    expect(engine.roomState.stack).toHaveLength(0);
    change('emperor', 'charge', 2);
    resolveByPassing(engine);
    change('emperor', 'charge');
    expect(engine.roomState.stack).toHaveLength(0);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['first']);
    engine.applyMutations([{ type: 'SET_TURN', playerId: 'player2', advance: true },
      { type: 'REMOVE_COUNTER', cardUuid: 'emperor', counterType: 'charge', amount: 1 }]);
    expect(engine.roomState.stack).toHaveLength(0);
    change('emperor', 'charge');
    resolveByPassing(engine);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['first', 'second']);
  },
}] satisfies CardCase[];
