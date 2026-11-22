import { expect } from 'vitest';
import { castWithPayment, resolveByPassing, type CardCase } from '../helpers/card-test-cases';
import { creature } from '../helpers/combat-fixture';

export default [{
  name: 'puts one Aurora on each friendly Ice Dragon and leaves other creatures alone',
  covers: ['play', 'cast effects'],
  prepare(room) {
    const dragon = (uuid: string, owner: string) => {
      const card = creature(uuid, owner);
      card.blueprint = { ...card.blueprint, subTypes: ['冰龍'] };
      return card;
    };
    room.battlefield = [dragon('first', 'player1'), creature('ordinary', 'player1'), dragon('second', 'player1'), dragon('opposing', 'player2')];
  },
  run(engine, source) {
    castWithPayment(engine, source, { white: 2, red: 1 });
    resolveByPassing(engine);
    expect(engine.roomState.battlefield.map(card => [card.uuid, card.state.counters.aurora ?? 0]))
      .toEqual([['first', 1], ['ordinary', 0], ['second', 1], ['opposing', 0]]);
  },
}] satisfies CardCase[];
