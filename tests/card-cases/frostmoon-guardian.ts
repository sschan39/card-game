import { expect } from 'vitest';
import { act, castWithPayment, choose, fixtureCard, passPriorityPair, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'offers payment per attacker and cancels only the attack that was paid for',
  covers: ['play', 'ability:cancel-attacking-creature'],
  prepare(room) {
    room.battlefield = ['first', 'second'].map(id => fixtureCard(id, 'player2', 'battlefield'));
  },
  run(engine, source) {
    castWithPayment(engine, source, { white: 2, blue: 1 });
    resolveByPassing(engine);
    Object.assign(engine.roomState, { activeTurnPlayerId: 'player2', phase: 'declareAttackersStep', priorityPlayerId: null });
    act(engine, 'declare_attackers', { attackers: ['first', 'second'].map(cardUuid => ({ cardUuid })) }, 'player2');
    const order = engine.roomState.pendingChoice;
    if (order?.kind !== 'ordering') throw new Error('Expected an order for both triggers');
    choose(engine, order.options.map(option => option.id));
    const ability = engine.roomState.stack.at(-1);
    if (ability?.type !== 'triggered') throw new Error('Expected a trigger for an attacker');
    const cancelled = (ability.triggeringEvent?.payload.card as { uuid: string }).uuid;
    passPriorityPair(engine);
    choose(engine, ['yes']);
    expect(engine.roomState.players.player1.mana.white).toBe(1);
    expect(engine.roomState.combat.map(item => item.attacker.uuid)).toEqual(['first', 'second'].filter(id => id !== cancelled));
    for (const id of ['first', 'second']) {
      expect(engine.roomState.battlefield.find(card => card.uuid === id)?.state).toMatchObject({ isTapped: true, attackedThisTurn: true });
    }
    passPriorityPair(engine);
    const remaining = engine.roomState.pendingChoice;
    if (remaining) choose(engine, ['no']);
    expect(engine.roomState.combat).toHaveLength(1);
  },
}] satisfies CardCase[];
