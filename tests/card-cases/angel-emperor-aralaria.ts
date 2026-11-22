import { expect } from 'vitest';
import { act, choose, fixtureCard, passPriorityPair, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [true, false].map(accept => ({
  name: `makes yellow, charges only when its controller heals, and offers an Angel once charge reaches five (${accept})`,
  covers: ['play', 'ability:mana', 'ability:healing-charge', 'ability:heavenly-command'],
  prepare(room) {
    room.players.player1.hand.push(fixtureCard('angel', 'player1', 'hand', { subTypes: ['上使'] }), fixtureCard('ordinary', 'player1', 'hand'));
  },
  run(engine, source) {
    const aralaria = () => permanent(engine, source.uuid);
    const charge = () => aralaria().state.counters.charge ?? 0;
    act(engine, 'play_land', { cardUuid: source.uuid, zoneRevision: source.state.zoneRevision ?? 0 });
    act(engine, 'tapForMana', { cardUuid: source.uuid, abilityId: 'mana' });
    expect(aralaria().state.isTapped).toBe(true);
    expect(engine.roomState.players.player1.mana.yellow).toBe(6);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player2', amount: 21 }, { type: 'SET_LIFE', playerId: 'player1', amount: 19 }]);
    expect(engine.roomState.stack).toEqual([]);
    expect(charge()).toBe(0);
    for (const life of [20, 21, 22, 23, 24]) {
      engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: life }]);
      resolveByPassing(engine);
      expect(charge()).toBe(life - 19);
      if (life < 24) expect(engine.roomState.stack).toEqual([]);
    }
    passPriorityPair(engine);
    expect(engine.roomState.pendingChoice?.kind).toBe('optional');
    expect(charge()).toBe(5);
    choose(engine, [accept ? 'yes' : 'no']);
    expect(charge()).toBe(accept ? 0 : 5);
    if (accept) {
      const choice = engine.roomState.pendingChoice;
      if (choice?.kind !== 'search') throw new Error('Expected the Angel choice');
      expect(choice.options.map(option => option.id)).toEqual(['angel']);
      choose(engine, ['angel']);
      expect(permanent(engine, 'angel').state.summonKind).toBe('effect');
    }
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(accept ? ['ordinary'] : ['angel', 'ordinary']);
  },
}) satisfies CardCase);
