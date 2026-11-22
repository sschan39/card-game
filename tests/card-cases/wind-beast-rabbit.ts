import { expect } from 'vitest';
import { act, castWithPayment, choose, fixtureCard, passPriorityPair, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [true, false].map(accept => ({
  name: accept ? 'can place a land from hand for free and still use the normal land play' : 'can decline placing a land from hand',
  covers: ['play', 'ability:place-hand-land'],
  prepare(room) {
    room.players.player1.hand.push(
      fixtureCard('free-land', 'player1', 'hand', { cardTypes: ['Land'] }),
      fixtureCard('normal-land', 'player1', 'hand', { cardTypes: ['Land'] }),
      fixtureCard('not-land', 'player1', 'hand'),
    );
  },
  run(engine, source) {
    castWithPayment(engine, source, { green: 1 });
    resolveByPassing(engine);
    passPriorityPair(engine);
    const choice = engine.roomState.pendingChoice;
    if (choice?.kind !== 'search') throw new Error('Expected a choice of lands in hand');
    expect(choice.options.map(option => option.id).sort()).toEqual(['free-land', 'normal-land']);
    choose(engine, accept ? ['free-land'] : []);
    expect(engine.roomState.battlefield.some(card => card.uuid === 'free-land')).toBe(accept);
    act(engine, 'play_land', { cardUuid: 'normal-land', zoneRevision: 0 });
    expect(engine.roomState.turnHistory?.landPlays.player1).toBe(1);
    expect(engine.roomState.players.player1.mana.green).toBe(4);
  },
}) satisfies CardCase);
