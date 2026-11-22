import { expect } from 'vitest';
import { act, castWithPayment, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'produces green and separately pays one green to tap an enemy only once in a turn',
  covers: ['play', 'ability:produce-green', 'ability:exhaust-enemy'],
  prepare(room) {
    room.battlefield = [
      fixtureCard('ally', 'player1', 'battlefield'),
      fixtureCard('enemy', 'player2', 'battlefield'),
      fixtureCard('second-enemy', 'player2', 'battlefield'),
    ];
  },
  run(engine, source) {
    castWithPayment(engine, source, { green: 1, red: 1 });
    resolveByPassing(engine);
    act(engine, 'tapForMana', { cardUuid: source.uuid, abilityId: 'produce-green', manaColor: 'green' });
    expect(engine.roomState.players.player1.mana.green).toBe(5);
    const ability = (id: string) => ({ cardUuid: source.uuid, abilityId: 'exhaust-enemy', targets: [{ targetType: 'permanent', cardUuid: id }] });
    expect(engine.executePlayerAction('player1', 'activate_ability', ability('ally')).success).toBe(false);
    act(engine, 'activate_ability', ability('enemy'));
    resolveByPassing(engine);
    expect(engine.roomState.battlefield.find(card => card.uuid === 'enemy')?.state.isTapped).toBe(true);
    expect(engine.executePlayerAction('player1', 'activate_ability', ability('second-enemy')).success).toBe(false);
    expect(engine.roomState.players.player1.mana.green).toBe(4);
  },
}] satisfies CardCase[];
