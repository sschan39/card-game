import { expect } from 'vitest';
import { act, castWithPayment, choose, declareAttack, fixtureCard, passPriorityPair, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [true, false].map(accept => ({
  name: `borrows a creature from the opponent’s top six without changing ownership, and offers attack mill (${accept ? 'accept' : 'decline'})`,
  covers: ['play', 'ability:reveal-opponent-library', 'ability:mill-per-opposing-creature'],
  prepare(room) {
    room.battlefield = [
      fixtureCard('creature-1', 'player2', 'battlefield'),
      fixtureCard('creature-2', 'player2', 'battlefield'),
      fixtureCard('land', 'player2', 'battlefield', { cardTypes: ['Land'] }),
      fixtureCard('your-creature', 'player1', 'battlefield'),
    ];
    room.players.player2.deck = [
      ...['deep', 'middle', 'outside', 'borrowed'].map(id => fixtureCard(id, 'player2', 'library')),
      ...Array.from({ length: 5 }, (_, i) => fixtureCard(`land-${i}`, 'player2', 'library', { cardTypes: ['Land'] })),
    ];
  },
  run(engine, source) {
    const player = () => engine.roomState.players.player1;
    const opponent = () => engine.roomState.players.player2;
    castWithPayment(engine, source, { blue: 5 });
    resolveByPassing(engine);
    passPriorityPair(engine);
    choose(engine, accept ? ['reveal-six'] : []);
    if (accept) {
      const choice = engine.roomState.pendingChoice;
      if (choice?.kind !== 'search') throw new Error('Expected the opposing creature choice');
      expect(choice.options.map(option => option.id)).toEqual(['borrowed']);
      choose(engine, ['borrowed']);
      expect(player().hand[0]?.state).toMatchObject({ ownerId: 'player2', handHolderId: 'player1', controllerId: 'player1' });
      expect(opponent().deck.map(card => card.uuid)).toEqual(['deep', 'middle', 'outside']);
      expect(opponent().graveyard.map(card => card.uuid)).toEqual(['land-4', 'land-3', 'land-2', 'land-1', 'land-0']);
      act(engine, 'cast_spell', { cardUuid: 'borrowed' });
      resolveByPassing(engine);
      expect(permanent(engine, 'borrowed').state).toMatchObject({ ownerId: 'player2', controllerId: 'player1' });
    }
    declareAttack(engine, source.uuid);
    passPriorityPair(engine);
    choose(engine, [accept ? 'yes' : 'no']);
    expect(opponent().deck).toHaveLength(accept ? 1 : 9);
    expect(opponent().graveyard.map(card => card.uuid).slice(-2)).toEqual(accept ? ['outside', 'middle'] : []);
  },
}) satisfies CardCase);
