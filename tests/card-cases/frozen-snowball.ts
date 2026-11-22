import { expect } from 'vitest';
import { act, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'casts for zero and enters as a 2/2',
  covers: ['play'],
  run(engine, source) {
    const before = { ...engine.roomState.players.player1.mana };
    act(engine, 'cast_spell', { cardUuid: source.uuid });
    expect(engine.roomState.players.player1.mana).toEqual(before);
    resolveByPassing(engine);
    expect(engine.roomState.battlefield.find(card => card.uuid === source.uuid)?.blueprint).toMatchObject({ power: 2, toughness: 2 });
  },
}] satisfies CardCase[];
