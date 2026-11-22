import { expect } from 'vitest';
import { castWithPayment, fixtureCard, resolveByPassing, type CardCase } from './card-test-cases';

export function bonusDraw(tribe: string, friendlyOnly: boolean): CardCase[] {
  return (['none', 'friendly', 'opposing', 'leaves'] as const).map(situation => ({
    name: `draws two or three according to the live matching creatures (${situation})`,
    covers: ['play', 'cast effects'],
    prepare(room) {
      room.players.player1.deck = ['bottom', 'third', 'second', 'first'].map(id => fixtureCard(id, 'player1', 'library'));
      if (situation !== 'none') {
        room.battlefield.push(fixtureCard('matching', situation === 'opposing' ? 'player2' : 'player1', 'battlefield', { subTypes: [tribe] }));
      }
      room.battlefield.push(fixtureCard('wrong-type', 'player1', 'battlefield', { subTypes: [tribe], cardTypes: ['Artifact'] }));
    },
    run(engine, source) {
      castWithPayment(engine, source, { red: 2 });
      if (situation === 'leaves') engine.applyMutations([{
        type: 'MOVE_CARD', cardUuid: 'matching', playerId: 'player1', from: 'battlefield', to: 'graveyard',
      }]);
      resolveByPassing(engine);
      const bonus = situation === 'friendly' || situation === 'opposing' && !friendlyOnly;
      expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(bonus ? ['first', 'second', 'third'] : ['first', 'second']);
      expect(engine.roomState.players.player2.hand).toHaveLength(0);
    },
  }));
}
