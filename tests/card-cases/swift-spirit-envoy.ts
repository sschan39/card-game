import { expect } from 'vitest';
import { castWithPayment, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default (['opposing', 'stays', 'leaves'] as const).map(situation => ({
  name: `casts on the opposing turn and checks the other Swift Spirit again on resolution (${situation})`,
  covers: ['play', 'ability:other-swift-entry-draw'],
  prepare(room) {
    room.activeTurnPlayerId = 'player2';
    room.battlefield = [fixtureCard('other-spirit', situation === 'opposing' ? 'player2' : 'player1', 'battlefield', { subTypes: ['迅靈'] })];
    room.players.player1.deck = [fixtureCard('draw', 'player1', 'library')];
  },
  run(engine, source) {
    castWithPayment(engine, source, { green: 2 });
    resolveByPassing(engine);
    if (situation === 'opposing') {
      expect(engine.roomState.stack).toHaveLength(0);
    } else {
      if (situation === 'leaves') engine.applyMutations([{
        type: 'MOVE_CARD', cardUuid: 'other-spirit', playerId: 'player1', from: 'battlefield', to: 'graveyard',
      }]);
      resolveByPassing(engine);
    }
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(situation === 'stays' ? ['draw'] : []);
  },
}) satisfies CardCase);
