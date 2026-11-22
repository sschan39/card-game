import { expect } from 'vitest';
import { castWithPayment, choose, fixtureCard, passPriorityPair, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [true, false].map(yellowLand => ({
  name: `heals for each yellow card and orders the unclaimed cards (yellow land: ${yellowLand})`,
  covers: ['play', 'ability:beast-reveal'],
  prepare(room) {
    room.players.player1.deck = [
      fixtureCard('deep', 'player1', 'library', { colors: ['yellow'], cardTypes: ['Land'] }),
      fixtureCard('other-land', 'player1', 'library', { colors: ['blue'], cardTypes: ['Land'] }),
      fixtureCard('yellow-creature', 'player1', 'library', { colors: ['yellow'] }),
      fixtureCard('candidate', 'player1', 'library', { colors: [yellowLand ? 'yellow' : 'red'], cardTypes: ['Land'] }),
    ];
  },
  run(engine, source) {
    castWithPayment(engine, source, { yellow: 1, red: 1 });
    resolveByPassing(engine);
    passPriorityPair(engine);
    expect(engine.roomState.players.player1.life).toBe(yellowLand ? 22 : 21);
    if (yellowLand) {
      const choice = engine.roomState.pendingChoice;
      if (choice?.kind !== 'search') throw new Error('Expected the yellow land choice');
      expect(choice.options.map(option => option.id)).toEqual(['candidate']);
      choose(engine, ['candidate']);
    }
    const returned = yellowLand ? ['other-land', 'yellow-creature'] : ['other-land', 'candidate', 'yellow-creature'];
    choose(engine, returned);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(yellowLand ? ['candidate'] : []);
    expect(engine.roomState.players.player1.deck.map(card => card.uuid)).toEqual([...returned.toReversed(), 'deep']);
  },
}) satisfies CardCase);
