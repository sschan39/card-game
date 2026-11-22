import { expect } from 'vitest';
import { castWithPayment, chooseTarget, declareAttack, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default (['land', 'relic'] as const).map(kind => ({
  name: `attack destroys the selected opposing ${kind} without opening the stack`,
  covers: ['play', 'ability:attack-destroy'],
  prepare(room) {
    room.battlefield = [
      fixtureCard('friendly-relic', 'player1', 'battlefield', { cardTypes: ['Artifact'] }),
      fixtureCard('enemy', 'player2', 'battlefield'),
      fixtureCard('land', 'player2', 'battlefield', { cardTypes: ['Land'] }),
      fixtureCard('relic', 'player2', 'battlefield', { cardTypes: ['Artifact'] }),
    ];
  },
  run(engine, source) {
    castWithPayment(engine, source, { blue: 3 });
    resolveByPassing(engine);
    declareAttack(engine, source.uuid);
    chooseTarget(engine, kind, ['land', 'relic']);
    expect(engine.roomState.stack).toHaveLength(0);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid)).toEqual([kind]);
  },
}) satisfies CardCase);
