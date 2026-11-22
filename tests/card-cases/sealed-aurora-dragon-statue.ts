import { expect } from 'vitest';
import { buildCardView } from '@server/projection/card-view';
import { act, castWithPayment, declareAttack, fixtureCard, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'cannot attack or block below three crystals and gains one crystal per friendly Aurora placement',
  covers: ['play', 'ability:sealed', 'ability:build-ice-crystal'],
  prepare(room) {
    room.battlefield = [fixtureCard('enemy', 'player2', 'battlefield', { toughness: 7 })];
  },
  run(engine, source) {
    castWithPayment(engine, source, { white: 2 });
    resolveByPassing(engine);
    engine.applyMutations([{ type: 'SET_SUMMONING_SICKNESS', cardUuid: source.uuid, value: false }]);
    const statue = () => permanent(engine, source.uuid);
    const flags = () => buildCardView(engine.roomState, 'player1', statue());
    const add = (id: string, amount: number) => engine.applyMutations([
      { type: 'ADD_COUNTER', cardUuid: 'enemy', counterType: 'aurora', amount, sourceControllerId: id },
    ]);
    expect(flags()).toMatchObject({ canAttack: false, canBlock: false });
    add('player2', 1);
    expect(engine.roomState.stack).toEqual([]);
    for (const [index, amount] of [2, 1, 1].entries()) {
      add('player1', amount);
      resolveByPassing(engine);
      expect(statue().state.counters['ice-crystal']).toBe(index + 1);
    }
    expect(flags()).toMatchObject({ canAttack: true, canBlock: true });
    engine.applyMutations([{ type: 'REMOVE_COUNTER', cardUuid: source.uuid, counterType: 'ice-crystal', amount: 1 }]);
    expect(flags()).toMatchObject({ canAttack: false, canBlock: false });
    engine.roomState.phase = 'declareAttackersStep';
    engine.roomState.priorityPlayerId = null;
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: source.uuid }] }).success).toBe(false);
    engine.roomState.activeTurnPlayerId = 'player2';
    declareAttack(engine, 'enemy', 'player2');
    engine.roomState.phase = 'declareBlockersStep';
    engine.roomState.priorityPlayerId = null;
    const blocks = { assignments: [{ attackerUuid: 'enemy', blockerUuids: [source.uuid] }] };
    expect(engine.executePlayerAction('player1', 'declare_blockers', blocks).success).toBe(false);
    engine.applyMutations([{ type: 'ADD_COUNTER', cardUuid: source.uuid, counterType: 'ice-crystal', amount: 1 }]);
    act(engine, 'declare_blockers', blocks);
  },
}] satisfies CardCase[];
