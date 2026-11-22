import { expect } from 'vitest';
import { act, castWithPayment, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'enters as a 0/4, gives itself Aurora and can tap for cold after summoning sickness',
  covers: ['play', 'ability:summon-aurora', 'ability:produce-white'],
  run(engine, source) {
    castWithPayment(engine, source, { white: 2 });
    resolveByPassing(engine);
    resolveByPassing(engine);
    const dragon = () => engine.roomState.battlefield.find(card => card.uuid === source.uuid);
    expect(dragon()).toMatchObject({ blueprint: { power: 0, toughness: 4 }, state: { counters: { aurora: 1 } } });
    const ability = { cardUuid: source.uuid, abilityId: 'produce-white', manaColor: 'white' };
    expect(engine.executePlayerAction('player1', 'tapForMana', ability).success).toBe(false);
    engine.applyMutations([{ type: 'SET_SUMMONING_SICKNESS', cardUuid: source.uuid, value: false }]);
    act(engine, 'tapForMana', ability);
    expect(engine.roomState.players.player1.mana.white).toBe(4);
    expect(dragon()?.state.isTapped).toBe(true);
  },
}] satisfies CardCase[];
