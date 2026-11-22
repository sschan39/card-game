import { expect } from 'vitest';
import { castWithPayment, choose, fixtureCard, passPriorityPair, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [true, false].map(hasLand => ({
  name: hasLand ? 'returns a land before drawing' : 'still draws when there is no land to recover',
  covers: ['play', 'entry effects'],
  prepare(room) {
    room.players.player1.deck = [fixtureCard('draw', 'player1', 'library')];
    room.players.player1.graveyard = [fixtureCard('ordinary', 'player1', 'graveyard')];
    if (hasLand) room.players.player1.graveyard.push(fixtureCard('recover', 'player1', 'graveyard', { cardTypes: ['Land'] }));
  },
  run(engine, source) {
    castWithPayment(engine, source, { blue: 2, red: 1 });
    resolveByPassing(engine);
    passPriorityPair(engine);
    if (hasLand) {
      expect(engine.roomState.players.player1.hand).toHaveLength(0);
      const choice = engine.roomState.pendingChoice;
      if (choice?.kind !== 'search') throw new Error('Expected a land choice');
      expect(choice.options.map(option => option.id)).toEqual(['recover']);
      choose(engine, ['recover']);
      expect(engine.roomState.battlefield.find(card => card.uuid === 'recover')?.state.zoneRevision).toBe(1);
    }
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['draw']);
  },
}) satisfies CardCase);
