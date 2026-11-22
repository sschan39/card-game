import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { castWithPayment, chooseTarget, declareAttack, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'counts only friendly Yoel for entry draw and temporarily weakens an opposing creature on a friendly attack',
  covers: ['play', 'ability:entry-draw-per-yoel', 'ability:friendly-attack-weaken'],
  prepare(room) {
    room.battlefield = [
      fixtureCard('yoel', 'player1', 'battlefield', { subTypes: ['幽爾'] }),
      fixtureCard('wrong-tribe', 'player1', 'battlefield'),
      fixtureCard('enemy', 'player2', 'battlefield', { subTypes: ['幽爾'], toughness: 5 }),
    ];
    room.players.player1.deck = ['bottom', 'second', 'first'].map(id => fixtureCard(id, 'player1', 'library'));
  },
  run(engine, source) {
    castWithPayment(engine, source, { black: 4 });
    resolveByPassing(engine);
    resolveByPassing(engine);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['first', 'second']);
    declareAttack(engine, 'yoel');
    chooseTarget(engine, 'enemy', ['enemy']);
    resolveByPassing(engine);
    const enemy = () => engine.roomState.battlefield.find(card => card.uuid === 'enemy')!;
    expect(stats.resolveToughness(engine.roomState, enemy())).toBe(3);
    expect(enemy().state.damageTaken).toBe(0);
    engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }]);
    expect(stats.resolveToughness(engine.roomState, enemy())).toBe(5);
  },
}] satisfies CardCase[];
