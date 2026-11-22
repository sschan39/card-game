import { expect } from 'vitest';
import { castWithPayment, resolveByPassing, type CardCase } from '../helpers/card-test-cases';
import { creature } from '../helpers/combat-fixture';

export default [{
  name: 'pays one generic and taps only an opposing creature during the opponent’s turn',
  covers: ['play', 'cast effects'],
  prepare(room) {
    room.activeTurnPlayerId = 'player2';
    room.battlefield = [creature('ally', 'player1'), creature('enemy', 'player2')];
  },
  run(engine, source) {
    const targets = (cardUuid: string) => [{ targetType: 'permanent', cardUuid }];
    expect(engine.executePlayerAction('player1', 'cast_spell', {
      cardUuid: source.uuid, payment: { red: 1 }, targets: targets('ally'),
    }).success).toBe(false);
    castWithPayment(engine, source, { red: 1 }, { targets: targets('enemy') });
    resolveByPassing(engine);
    expect(engine.roomState.battlefield.map(card => [card.uuid, card.state.isTapped])).toEqual([['ally', false], ['enemy', true]]);
  },
}] satisfies CardCase[];
