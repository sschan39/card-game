import { expect } from 'vitest';
import { castWithPayment, choose, fixtureCard, passPriorityPair, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'mills exactly three of its own cards before choosing a black creature to recover',
  covers: ['play', 'entry effects'],
  prepare(room) {
    room.players.player1.deck = [
      fixtureCard('unmilled', 'player1', 'library', { colors: ['black'] }),
      fixtureCard('wrong-color', 'player1', 'library', { colors: ['red'] }),
      fixtureCard('black-artifact', 'player1', 'library', { colors: ['black'], cardTypes: ['Artifact'] }),
      fixtureCard('recover-me', 'player1', 'library', { colors: ['black'] }),
    ];
    room.players.player2.graveyard = [fixtureCard('opposing', 'player2', 'graveyard', { colors: ['black'] })];
  },
  run(engine, source) {
    castWithPayment(engine, source, { black: 2 });
    resolveByPassing(engine);
    passPriorityPair(engine);
    expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual(['recover-me', 'black-artifact', 'wrong-color']);
    const choice = engine.roomState.pendingChoice;
    if (choice?.kind !== 'search') throw new Error('Expected a black creature search');
    expect(choice.options.map(option => option.id)).toEqual(['recover-me']);
    choose(engine, ['recover-me']);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['recover-me']);
    expect(engine.roomState.players.player1.deck.map(card => card.uuid)).toEqual(['unmilled']);
  },
}] satisfies CardCase[];
