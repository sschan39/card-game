import { expect } from 'vitest';
import { castWithPayment, declareAttack, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [true, false].map(allyStays => ({
  name: `mills twice the live friendly Yoel count when its attack resolves (${allyStays ? 'ally remains' : 'ally leaves'})`,
  covers: ['play', 'ability:attack-library-discard'],
  prepare(room) {
    room.battlefield = [fixtureCard('ally', 'player1', 'battlefield', { subTypes: ['幽爾'] }),
      fixtureCard('opposing-yoel', 'player2', 'battlefield', { subTypes: ['幽爾'] }),
      fixtureCard('other', 'player1', 'battlefield')];
    room.players.player2.deck = Array.from({ length: 6 }, (_, index) => fixtureCard('opposing-' + index, 'player2', 'library'));
  },
  run(engine, source) {
    castWithPayment(engine, source, { blue: 2 });
    resolveByPassing(engine);
    declareAttack(engine, source.uuid);
    if (!allyStays) engine.applyMutations([{
      type: 'MOVE_CARD', cardUuid: 'ally', playerId: 'player1', from: 'battlefield', to: 'graveyard',
    }]);
    resolveByPassing(engine);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid))
      .toEqual(allyStays ? ['opposing-5', 'opposing-4', 'opposing-3', 'opposing-2'] : ['opposing-5', 'opposing-4']);
  },
}) satisfies CardCase);
