import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { castWithPayment, declareAttack, fixtureCard, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'boosts only friendly Giant mill until cleanup, and mills two when attacking with its own bonus',
  covers: ['play', 'ability:summon-mill-bonus', 'ability:attack-mill'],
  prepare(room) {
    room.battlefield = [
      fixtureCard('friendly-giant', 'player1', 'battlefield', { subTypes: ['蒼巨人'] }),
      fixtureCard('friendly-other', 'player1', 'battlefield'),
      fixtureCard('opposing-giant', 'player2', 'battlefield', { subTypes: ['蒼巨人'] }),
    ];
    room.players.player2.deck = ['bottom', 'second', 'first'].map(id => fixtureCard(id, 'player2', 'library'));
  },
  run(engine, source) {
    castWithPayment(engine, source, { blue: 3 });
    resolveByPassing(engine);
    resolveByPassing(engine);
    const bonus = (uuid: string) => stats.resolve(engine.roomState, permanent(engine, uuid)).millBonus;
    expect(bonus('friendly-giant')).toBe(1);
    expect(bonus('friendly-other')).toBeUndefined();
    expect(bonus('opposing-giant')).toBeUndefined();
    declareAttack(engine, source.uuid);
    resolveByPassing(engine);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid)).toEqual(['first', 'second']);
    engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }]);
    expect(bonus('friendly-giant')).toBeUndefined();
  },
}] satisfies CardCase[];
