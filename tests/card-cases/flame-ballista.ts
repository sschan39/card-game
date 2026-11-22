import { expect } from 'vitest';
import { act, castWithPayment, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'taps and pays one red to place one Scorch, excluding allies and equipment',
  covers: ['play', 'ability:tap-scorch'],
  prepare(room) {
    room.battlefield = [fixtureCard('ally', 'player1', 'battlefield'),
      fixtureCard('enemy', 'player2', 'battlefield'),
      fixtureCard('gear', 'player2', 'battlefield', { cardTypes: ['Artifact'], subTypes: ['Equipment'] })];
  },
  run(engine, source) {
    castWithPayment(engine, source, { red: 1 });
    resolveByPassing(engine);
    const ability = (id: string) => ({ cardUuid: source.uuid, abilityId: 'tap-scorch', targets: [{ targetType: 'permanent', cardUuid: id }] });
    for (const id of ['ally', 'gear']) {
      expect(engine.executePlayerAction('player1', 'activate_ability', ability(id)).success).toBe(false);
    }
    expect(engine.roomState.players.player1.mana.red).toBe(4);
    act(engine, 'activate_ability', ability('enemy'));
    expect(engine.roomState.players.player1.mana.red).toBe(3);
    expect(engine.roomState.battlefield.find(card => card.uuid === source.uuid)?.state.isTapped).toBe(true);
    resolveByPassing(engine);
    expect(engine.roomState.battlefield.find(card => card.uuid === 'enemy')?.state.counters.scorch).toBe(1);
    expect(engine.executePlayerAction('player1', 'activate_ability', ability('enemy')).success).toBe(false);
  },
}] satisfies CardCase[];
