import { expect } from 'vitest';
import { castWithPayment, choose, fixtureCard, passPriorityPair, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [true, false].map(reveal => ({
  name: `may arrange the top three, keeping a Dragon card on top, and draws only if destroyed (reveal: ${reveal})`,
  covers: ['play', 'ability:frost-reveal', 'ability:frost-destroyed'],
  prepare(room) {
    room.players.player1.deck = [
      fixtureCard('deep', 'player1', 'library', { subTypes: ['冰龍'] }),
      fixtureCard('plain', 'player1', 'library'),
      fixtureCard('dragon-gear', 'player1', 'library', { cardTypes: ['Artifact'], subTypes: ['Equipment', '冰龍'] }),
      fixtureCard('top', 'player1', 'library'),
    ];
  },
  run(engine, source) {
    castWithPayment(engine, source, { white: 1 });
    resolveByPassing(engine);
    passPriorityPair(engine);
    choose(engine, [reveal ? 'reveal' : 'skip']);
    if (reveal) {
      const choice = engine.roomState.pendingChoice;
      if (choice?.kind !== 'search') throw new Error('Expected the Dragon card choice');
      expect(choice.options.map(option => option.id)).toEqual(['dragon-gear']);
      choose(engine, ['dragon-gear']);
      choose(engine, ['plain', 'top']);
    }
    const player = () => engine.roomState.players.player1;
    expect(player().deck.map(card => card.uuid)).toEqual(reveal ? ['top', 'plain', 'deep', 'dragon-gear'] : ['deep', 'plain', 'dragon-gear', 'top']);
    engine.applyMutations(reveal
      ? [{ type: 'DESTROY_CARD', cardUuid: source.uuid, zoneRevision: permanent(engine, source.uuid).state.zoneRevision ?? 0 }]
      : [{ type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard', reason: 'sacrifice' }]);
    if (reveal) resolveByPassing(engine);
    expect(engine.roomState.stack).toEqual([]);
    expect(player().graveyard.map(card => card.uuid)).toEqual([source.uuid]);
    expect(player().hand.map(card => card.uuid)).toEqual(reveal ? ['dragon-gear'] : []);
  },
}) satisfies CardCase);
