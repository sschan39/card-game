import { expect } from 'vitest';
import { castWithPayment, chooseTarget, declareAttack, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'entry and attack independently deal three damage to the chosen enemy',
  covers: ['play', 'ability:entry-damage', 'ability:attack-damage'],
  prepare(room) {
    room.battlefield = [
      fixtureCard('ally', 'player1', 'battlefield'),
      fixtureCard('entry-target', 'player2', 'battlefield', { toughness: 6 }),
      fixtureCard('attack-target', 'player2', 'battlefield', { toughness: 6 }),
    ];
  },
  run(engine, source) {
    castWithPayment(engine, source, { red: 2 });
    resolveByPassing(engine);
    const targets = ['entry-target', 'attack-target'];
    chooseTarget(engine, 'entry-target', targets);
    resolveByPassing(engine);
    const damage = () => engine.roomState.battlefield.slice(0, 3).map(card => card.state.damageTaken);
    expect(damage()).toEqual([0, 3, 0]);
    declareAttack(engine, source.uuid);
    chooseTarget(engine, 'attack-target', targets);
    resolveByPassing(engine);
    expect(damage()).toEqual([0, 3, 3]);
  },
}] satisfies CardCase[];
