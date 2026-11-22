import { expect } from 'vitest';
import { castWithPayment, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'requires three white and two generic, then enters as an 8/8',
  covers: ['play'],
  run(engine, source) {
    const play = { cardUuid: source.uuid };
    expect(engine.executePlayerAction('player1', 'cast_spell', { ...play, payment: { white: 2, red: 3 } }).success).toBe(false);
    expect(engine.executePlayerAction('player1', 'cast_spell', { ...play, payment: { white: 3, red: 1 } }).success).toBe(false);
    expect(engine.roomState.players.player1.hand[0].uuid).toBe(source.uuid);
    castWithPayment(engine, source, { white: 3, red: 2 });
    resolveByPassing(engine);
    expect(engine.roomState.battlefield.find(card => card.uuid === source.uuid)?.blueprint).toMatchObject({ power: 8, toughness: 8 });
  },
}] satisfies CardCase[];
