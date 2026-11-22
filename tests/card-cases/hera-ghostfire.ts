import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { castWithPayment, fixtureCard, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'can respond on the enemy turn, permanently weakens opposing creatures and exiles only those it kills',
  covers: ['play', 'cast effects'],
  prepare(room) {
    room.activeTurnPlayerId = 'player2';
    room.battlefield = [
      fixtureCard('victim', 'player2', 'battlefield', { power: 2, toughness: 2 }),
      fixtureCard('survivor', 'player2', 'battlefield', { power: 4, toughness: 4 }),
      fixtureCard('ally', 'player1', 'battlefield', { power: 2, toughness: 2 }),
    ];
  },
  run(engine, source) {
    castWithPayment(engine, source, { black: 2, red: 2 });
    resolveByPassing(engine);
    const room = engine.roomState;
    expect(room.players.player2.exile?.map(card => card.uuid)).toEqual(['victim']);
    expect(room.players.player2.graveyard).toEqual([]);
    expect(room.players.player1.graveyard.map(card => card.uuid)).toEqual([source.uuid]);
    engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }]);
    const values = (uuid: string) => {
      const card = permanent(engine, uuid);
      return [stats.resolvePower(engine.roomState, card), stats.resolveToughness(engine.roomState, card)];
    };
    expect(values('survivor')).toEqual([2, 2]);
    expect(values('ally')).toEqual([2, 2]);
  },
}] satisfies CardCase[];
