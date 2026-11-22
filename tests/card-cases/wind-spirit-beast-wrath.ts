import { expect } from 'vitest';
import { castWithPayment, fixtureCard, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';
import { windRevealClaim } from '../helpers/wind-reveal-card-case';

export default [...windRevealClaim(), {
  name: 'can respond on the opponent’s turn and taps exactly two opposing creatures',
  covers: ['play', 'cast effects'],
  prepare(room) {
    room.activeTurnPlayerId = 'player2';
    room.battlefield = ['one', 'two', 'three'].map(id => fixtureCard(id, 'player2', 'battlefield'));
    room.battlefield.push(fixtureCard('ally', 'player1', 'battlefield'));
  },
  run(engine, source) {
    const targets = (...ids: string[]) => ids.map(cardUuid => ({ targetType: 'permanent', cardUuid }));
    for (const invalid of [targets('one'), targets('one', 'ally')]) {
      expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid, targets: invalid }).success).toBe(false);
    }
    castWithPayment(engine, source, { green: 1, red: 1 }, { targets: targets('one', 'two') });
    resolveByPassing(engine);
    expect(['one', 'two', 'three', 'ally'].map(id => permanent(engine, id).state.isTapped)).toEqual([true, true, false, false]);
  },
}] satisfies CardCase[];
