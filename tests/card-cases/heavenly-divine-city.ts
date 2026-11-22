import { expect } from 'vitest';
import { castWithPayment, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'summons an 8/5 and creates exactly one 1/1 Angel token on entry',
  covers: ['play', 'ability:create-angel'],
  requires: ['token-angel-1-1'],
  run(engine, source) {
    castWithPayment(engine, source, { yellow: 3, blue: 3 });
    resolveByPassing(engine);
    expect(engine.roomState.battlefield.find(card => card.uuid === source.uuid)?.blueprint).toMatchObject({ power: 8, toughness: 5 });
    expect(engine.roomState.battlefield.filter(card => card.isToken)).toHaveLength(0);
    resolveByPassing(engine);
    const tokens = engine.roomState.battlefield.filter(card => card.isToken);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ blueprint: { id: 'token-angel-1-1', power: 1, toughness: 1, abilities: [] },
      state: { ownerId: 'player1', controllerId: 'player1' } });
  },
}] satisfies CardCase[];
