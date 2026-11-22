import { expect } from 'vitest';
import { castWithPayment, choose, declareAttack, fixtureCard, passPriorityPair, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [true, false].map(accept => ({
  name: `optionally takes one Giant and one relic, and independently mills twice on entry and attack (reveal: ${accept})`,
  covers: ['play', 'ability:reveal-giant-and-relic', 'ability:summon-mill', 'ability:attack-mill'],
  prepare(room) {
    room.players.player1.deck = [
      fixtureCard('deep', 'player1', 'library', { subTypes: ['蒼巨人'] }),
      fixtureCard('giant', 'player1', 'library', { subTypes: ['蒼巨人'] }),
      fixtureCard('relic', 'player1', 'library', { cardTypes: ['Artifact'] }),
      fixtureCard('gear', 'player1', 'library', { cardTypes: ['Artifact'], subTypes: ['Equipment'] }),
      ...['one', 'two', 'three'].map(id => fixtureCard(id, 'player1', 'library')),
    ];
    room.players.player2.deck = ['deep', 'four', 'three', 'two', 'one'].map(id => fixtureCard('opponent-' + id, 'player2', 'library'));
  },
  run(engine, source) {
    castWithPayment(engine, source, { blue: 3 });
    passPriorityPair(engine);
    const order = engine.roomState.pendingChoice;
    if (!order || order.kind === 'number') throw new Error('Expected simultaneous entry trigger ordering');
    expect(order.options).toHaveLength(2);
    choose(engine, order.options.map(option => option.id));
    passPriorityPair(engine);
    if (!engine.roomState.pendingChoice) passPriorityPair(engine);
    choose(engine, accept ? ['reveal-six'] : []);
    if (accept) {
      for (const id of ['giant', 'relic']) {
        const choice = engine.roomState.pendingChoice;
        if (choice?.kind !== 'search') throw new Error('Expected the revealed card choice');
        expect(choice.options.map(option => option.id)).toEqual([id]);
        choose(engine, [id]);
      }
    }
    if (engine.roomState.stack.length) resolveByPassing(engine);
    const { player1, player2 } = engine.roomState.players;
    expect(player1.hand.map(card => card.uuid)).toEqual(accept ? ['giant', 'relic'] : []);
    expect(player1.graveyard.map(card => card.uuid)).toEqual(accept ? ['three', 'two', 'one', 'gear'] : []);
    expect(player2.graveyard.map(card => card.uuid)).toEqual(['opponent-one', 'opponent-two']);
    declareAttack(engine, source.uuid);
    resolveByPassing(engine);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid))
      .toEqual(['opponent-one', 'opponent-two', 'opponent-three', 'opponent-four']);
  },
}) satisfies CardCase);
