import { expect } from 'vitest';
import { castWithPayment, choose, fixtureCard, passPriorityPair, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'mills only Puppets in the top five once per physical card and otherwise draws normally',
  covers: ['play', 'ability:factory-entry'],
  prepare(room) {
    room.players.player1.deck = [
      fixtureCard('outside-puppet', 'player1', 'library', { subTypes: ['幻影木偶'] }),
      fixtureCard('first', 'player1', 'library'),
      fixtureCard('second', 'player1', 'library'),
      fixtureCard('third', 'player1', 'library'),
      fixtureCard('puppet-1', 'player1', 'library', { subTypes: ['幻影木偶'] }),
      fixtureCard('puppet-2', 'player1', 'library', { subTypes: ['幻影木偶'] }),
    ];
  },
  run(engine, source) {
    const player = () => engine.roomState.players.player1;
    castWithPayment(engine, source, { black: 2 });
    resolveByPassing(engine);
    passPriorityPair(engine);
    choose(engine, ['reveal-and-draw']);
    expect(player().graveyard.map(card => card.uuid)).toEqual(['puppet-2', 'puppet-1']);
    choose(engine, ['first', 'second', 'third']);
    expect(player().hand.map(card => card.uuid)).toEqual(['first']);
    expect(player().deck.map(card => card.uuid)).toEqual(['outside-puppet', 'third', 'second']);
    engine.applyMutations([
      { type: 'MOVE_CARD', playerId: 'player1', cardUuid: source.uuid, from: 'battlefield', to: 'graveyard' },
      { type: 'MOVE_CARD', playerId: 'player1', cardUuid: source.uuid, from: 'graveyard', to: 'battlefield' },
    ]);
    passPriorityPair(engine);
    const choice = engine.roomState.pendingChoice;
    if (choice?.kind !== 'options') throw new Error('Expected the ordinary draw choice');
    expect(choice.options.map(option => option.id)).toEqual(['draw-one']);
    choose(engine, ['draw-one']);
    expect(player().hand.map(card => card.uuid)).toEqual(['first', 'second']);
  },
}] satisfies CardCase[];
