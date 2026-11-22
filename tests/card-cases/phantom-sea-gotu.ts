import { expect } from 'vitest';
import { castWithPayment, choose, declareAttack, fixtureCard, passPriorityPair, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [true, false].map(accept => ({
  name: `may draw two and discard one on entry, then mills only the opponent’s top two on attack (draw: ${accept})`,
  covers: ['play', 'ability:entry-draw-discard', 'ability:attack-library-discard'],
  prepare(room) {
    const { player1, player2 } = room.players;
    player1.hand.push(fixtureCard('old', 'player1', 'hand'));
    player1.deck = ['bottom', 'second', 'top'].map(id => fixtureCard(id, 'player1', 'library'));
    player2.deck = ['enemy-bottom', 'enemy-second', 'enemy-top'].map(id => fixtureCard(id, 'player2', 'library'));
  },
  run(engine, source) {
    castWithPayment(engine, source, { blue: 2 });
    resolveByPassing(engine);
    passPriorityPair(engine);
    choose(engine, [accept ? 'accept' : 'decline']);
    if (accept) {
      const choice = engine.roomState.pendingChoice;
      if (choice?.kind !== 'discard') throw new Error('Expected a discard choice');
      expect(choice.options.map(option => option.id).sort()).toEqual(['old', 'second', 'top']);
      choose(engine, ['old']);
    }
    declareAttack(engine, source.uuid);
    resolveByPassing(engine);
    const { player1, player2 } = engine.roomState.players;
    expect(player1.hand.map(card => card.uuid)).toEqual(accept ? ['top', 'second'] : ['old']);
    expect(player1.deck.map(card => card.uuid)).toEqual(accept ? ['bottom'] : ['bottom', 'second', 'top']);
    expect(player1.graveyard.map(card => card.uuid)).toEqual(accept ? ['old'] : []);
    expect(player2.deck.map(card => card.uuid)).toEqual(['enemy-bottom']);
    expect(player2.graveyard.map(card => card.uuid)).toEqual(['enemy-top', 'enemy-second']);
  },
}) satisfies CardCase);
