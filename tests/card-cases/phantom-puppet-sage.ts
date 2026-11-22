import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { instantiateCard } from '@library/card-factory';
import { castWithPayment, fixtureCard, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'adds one attack to friendly Puppets during friendly combat, with three allies and no stacking',
  covers: ['play', 'ability:graveyard-cost', 'ability:sage-attack-anthem'],
  prepare(room) {
    room.players.player1.mana.black = 6;
    const duplicate = instantiateCard('phantom-puppet-sage');
    duplicate.state = { ...duplicate.state, ownerId: 'player1', controllerId: 'player1', zone: 'battlefield' };
    room.battlefield = [
      duplicate,
      fixtureCard('ally-puppet', 'player1', 'battlefield', { subTypes: ['幻影木偶'], colors: ['black'], power: 2 }),
      fixtureCard('ally-other', 'player1', 'battlefield', { colors: ['black'], power: 2 }),
      fixtureCard('enemy-puppet', 'player2', 'battlefield', { subTypes: ['幻影木偶'], colors: ['black'], power: 2 }),
    ];
  },
  run(engine, source) {
    castWithPayment(engine, source, { black: 6 });
    resolveByPassing(engine);
    const power = (id: string) => stats.resolvePower(engine.roomState, permanent(engine, id));
    expect(power('ally-puppet')).toBe(2);
    expect(stats.resolveManaValue(engine.roomState, permanent(engine, source.uuid))).toBe(6);
    engine.applyMutations([{ type: 'SET_PHASE', phase: 'beginCombatStep' }]);
    expect(power('ally-puppet')).toBe(3);
    expect(power(source.uuid)).toBe(6);
    expect(power('ally-other')).toBe(2);
    expect(power('enemy-puppet')).toBe(2);
    const bury = (cardUuid: string) => engine.applyMutations([
      { type: 'MOVE_CARD', playerId: 'player1', cardUuid, from: 'battlefield', to: 'graveyard' },
    ]);
    bury(source.uuid);
    expect(power('ally-puppet')).toBe(3);
    const sage = engine.roomState.players.player1.graveyard.find(card => card.uuid === source.uuid)!;
    expect(stats.resolveManaValue(engine.roomState, sage)).toBe(3);
    bury('ally-other');
    expect(power('ally-puppet')).toBe(2);
  },
}] satisfies CardCase[];
