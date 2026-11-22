import { expect } from 'vitest';
import { castWithPayment, choose, fixtureCard, passPriorityPair, resolveByPassing, type CardCase } from '../helpers/card-test-cases';
import { flameRevealCard, prepareFlameReveal, revealWithFlameBeast } from '../helpers/flame-reveal-card-case';

export default [{
  name: 'offers a draw only on opposing life loss, with a separate choice for each qualifying event',
  covers: ['play', 'ability:opponent-life-loss-draw'],
  prepare(room) {
    room.players.player1.deck = ['second', 'first'].map(id => fixtureCard(id, 'player1', 'library'));
  },
  run(engine, source) {
    castWithPayment(engine, source, { red: 2 });
    resolveByPassing(engine);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 18 }, { type: 'SET_LIFE', playerId: 'player2', amount: 21 }]);
    expect(engine.roomState.stack).toEqual([]);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player2', amount: 20 }]);
    passPriorityPair(engine);
    choose(engine, ['no']);
    expect(engine.roomState.players.player1.hand).toEqual([]);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player2', amount: 18 }]);
    passPriorityPair(engine);
    choose(engine, ['yes']);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['first']);
    expect(engine.roomState.players.player1.deck.map(card => card.uuid)).toEqual(['second']);
  },
}, ...[true, false].map(accept => ({
  name: `may claim itself after a Flame Beast reveal (${accept ? 'accept' : 'decline'})`,
  covers: ['ability:revealed-self-claim'],
  requires: [flameRevealCard],
  prepare: prepareFlameReveal,
  run(engine, source) {
    revealWithFlameBeast(engine, source);
    choose(engine, [accept ? 'yes' : 'no']);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(accept ? [source.uuid] : []);
    expect(engine.roomState.players.player1.deck.map(card => card.uuid)).toEqual(accept ? ['draw'] : ['draw', source.uuid]);
  },
}) satisfies CardCase)] satisfies CardCase[];
