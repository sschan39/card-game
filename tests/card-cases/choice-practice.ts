import { expect } from 'vitest';
import { act, choose, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default ([
  { route: 'base', x: 0, mana: 1, life: 20 },
  { route: 'base', x: 2, mana: 3, life: 20 },
  { route: 'alternative', x: 4, mana: 1, life: 18 },
] as const).map(({ route, x, mana, life }) => ({
  name: `chooses X=${x}, pays the ${route} route and mandatory extra cost, then makes the opponent lose X life`,
  covers: ['play', 'number:X', 'additional cost', 'cast effects', ...(route === 'alternative' ? ['cost route:life'] : [])],
  prepare(room) {
    room.players.player1.hand.push(fixtureCard('discard', 'player1', 'hand'));
  },
  run(engine, source) {
    act(engine, 'cast_spell', { cardUuid: source.uuid, choosePayment: true });
    const number = engine.roomState.pendingChoice;
    expect(number).toMatchObject({ kind: 'number', range: { min: 0, max: 4 } });
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: number?.id, number: 5 }).success).toBe(false);
    act(engine, 'choose', { choiceId: number?.id, number: x });
    const costs = engine.roomState.pendingChoice;
    if (costs?.kind !== 'options') throw new Error('Expected a cost route choice');
    const selected = costs.options.find(option => (option.value as { kind?: string }).kind === route);
    if (!selected) throw new Error(`Expected the ${route} cost route`);
    choose(engine, [selected.id]);
    const targets = engine.roomState.pendingChoice;
    if (targets?.kind !== 'targets') throw new Error('Expected the opponent target');
    expect(targets.options.map(option => option.label)).toEqual(['Opponent']);
    choose(engine, targets.options.map(option => option.id));
    expect(engine.roomState.pendingChoice?.kind).toBe('discard');
    choose(engine, ['discard']);
    const payment = engine.roomState.pendingChoice;
    expect(payment?.kind).toBe('payment');
    const player = () => engine.roomState.players.player1;
    expect(player().mana.red).toBe(5);
    expect(player().life).toBe(20);
    expect(player().graveyard).toEqual([]);
    act(engine, 'choose', { choiceId: payment?.id, allocations: { red: mana } });
    expect(player().mana.red).toBe(5 - mana);
    expect(player().life).toBe(life);
    expect(player().graveyard.map(card => card.uuid)).toEqual(['discard']);
    expect(engine.roomState.stack.at(-1)?.numericBindings).toEqual({ X: x });
    resolveByPassing(engine);
    expect(engine.roomState.players.player2.life).toBe(20 - x);
  },
}) satisfies CardCase);
