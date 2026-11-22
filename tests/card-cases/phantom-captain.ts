import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { castWithPayment, chooseTarget, declareAttack, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'an attack gives one friendly Puppet +1 power until cleanup',
  covers: ['play', 'ability:attack-empower'],
  prepare(room) {
    room.battlefield = [
      fixtureCard('puppet', 'player1', 'battlefield', { subTypes: ['幻影木偶'] }),
      fixtureCard('enemy-puppet', 'player2', 'battlefield', { subTypes: ['幻影木偶'] }),
      fixtureCard('ally', 'player1', 'battlefield'),
    ];
  },
  run(engine, source) {
    castWithPayment(engine, source, { black: 2, red: 1 });
    resolveByPassing(engine);
    declareAttack(engine, source.uuid);
    chooseTarget(engine, 'puppet', ['puppet', source.uuid]);
    resolveByPassing(engine);
    const puppet = engine.roomState.battlefield.find(card => card.uuid === 'puppet')!;
    expect(stats.resolvePower(engine.roomState, puppet)).toBe(3);
    engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }]);
    expect(stats.resolvePower(engine.roomState, puppet)).toBe(2);
  },
}] satisfies CardCase[];
