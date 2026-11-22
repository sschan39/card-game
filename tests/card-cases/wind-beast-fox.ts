import { expect } from 'vitest';
import { castWithPayment, chooseTarget, declareAttack, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'attacks as a 3/3 and taps a chosen opposing creature',
  covers: ['play', 'ability:attack-tap'],
  prepare(room) {
    room.battlefield = [fixtureCard('ally', 'player1', 'battlefield'), fixtureCard('target', 'player2', 'battlefield')];
  },
  run(engine, source) {
    castWithPayment(engine, source, { green: 2 });
    resolveByPassing(engine);
    expect(engine.roomState.battlefield.find(card => card.uuid === source.uuid)?.blueprint).toMatchObject({ power: 3, toughness: 3 });
    declareAttack(engine, source.uuid);
    chooseTarget(engine, 'target', ['target']);
    resolveByPassing(engine);
    expect(engine.roomState.battlefield.find(card => card.uuid === 'target')?.state.isTapped).toBe(true);
    expect(engine.roomState.battlefield.find(card => card.uuid === 'ally')?.state.isTapped).toBe(false);
  },
}] satisfies CardCase[];
