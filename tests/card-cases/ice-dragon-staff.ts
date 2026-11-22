import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { act, castWithPayment, declareAttack, fixtureCard, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'equips friendly Ice Dragons, adds attack and crystals, and pays for bounce from the current host only',
  covers: ['play', 'ability:attach', 'ability:equipment-effects', 'ability:ice-crystal-bounce'],
  prepare(room) {
    room.battlefield = [
      fixtureCard('first', 'player1', 'battlefield', { subTypes: ['冰龍'] }),
      fixtureCard('second', 'player1', 'battlefield', { subTypes: ['冰龍'] }),
      fixtureCard('enemy', 'player2', 'battlefield', { subTypes: ['冰龍'] }),
      fixtureCard('ordinary', 'player1', 'battlefield'),
    ];
  },
  run(engine, source) {
    castWithPayment(engine, source, { white: 1 });
    resolveByPassing(engine);
    const activate = (abilityId: string, cardUuid: string) => ({
      cardUuid: source.uuid, abilityId, targets: [{ targetType: 'permanent', cardUuid }],
    });
    const crystals = (uuid: string) => permanent(engine, uuid).state.counters['ice-crystal'] ?? 0;
    const power = (uuid: string) => stats.resolvePower(engine.roomState, permanent(engine, uuid));
    const add = (cardUuid: string, amount: number) => engine.applyMutations([{ type: 'ADD_COUNTER', cardUuid, counterType: 'ice-crystal', amount }]);
    const bounce = activate('ice-crystal-bounce', 'enemy');
    add('first', 1);
    expect(engine.executePlayerAction('player1', 'activate_ability', bounce).success).toBe(false);
    for (const invalid of ['ordinary', 'enemy']) {
      expect(engine.executePlayerAction('player1', 'activate_ability', activate('attach', invalid)).success).toBe(false);
    }
    act(engine, 'activate_ability', activate('attach', 'first'));
    resolveByPassing(engine);
    expect(power('first')).toBe(3);
    declareAttack(engine, 'first');
    resolveByPassing(engine);
    expect([crystals('first'), crystals(source.uuid)]).toEqual([2, 0]);
    engine.roomState.phase = 'stateMainPhase';
    engine.roomState.priorityPlayerId = 'player1';
    act(engine, 'activate_ability', activate('attach', 'second'));
    resolveByPassing(engine);
    expect([power('first'), power('second')]).toEqual([2, 3]);
    expect(engine.executePlayerAction('player1', 'activate_ability', bounce).success).toBe(false);
    add('second', 2);
    act(engine, 'activate_ability', bounce);
    expect([crystals('first'), crystals('second')]).toEqual([2, 0]);
    resolveByPassing(engine);
    expect(engine.roomState.players.player2.hand.map(card => card.uuid)).toEqual(['enemy']);
  },
}] satisfies CardCase[];
