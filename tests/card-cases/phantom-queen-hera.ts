import { expect } from 'vitest';
import { act, fixtureCard, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'makes black, charges on friendly Puppet arrivals, and spends five charge to destroy a tapped enemy once per turn',
  covers: ['play', 'ability:mana', 'ability:puppet-charge', 'ability:charged-destruction'],
  prepare(room) {
    const puppet = { subTypes: ['幻影木偶'] };
    room.players.player1.hand.push(fixtureCard('puppet', 'player1', 'hand', puppet), fixtureCard('ordinary', 'player1', 'hand'));
    room.players.player2.hand = [fixtureCard('enemy-puppet', 'player2', 'hand', puppet)];
    room.battlefield = ['enemy', 'second'].map(id => fixtureCard(id, 'player2', 'battlefield'));
  },
  run(engine, source) {
    const hera = () => permanent(engine, source.uuid);
    const charge = () => hera().state.counters.charge ?? 0;
    act(engine, 'play_land', { cardUuid: source.uuid, zoneRevision: source.state.zoneRevision ?? 0 });
    act(engine, 'tapForMana', { cardUuid: source.uuid, abilityId: 'mana' });
    expect(hera().state.isTapped).toBe(true);
    expect(engine.roomState.players.player1.mana.black).toBe(6);
    expect(engine.roomState.stack).toEqual([]);
    engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: 'enemy-puppet', playerId: 'player2', from: 'hand', to: 'battlefield' },
      { type: 'MOVE_CARD', cardUuid: 'ordinary', playerId: 'player1', from: 'hand', to: 'battlefield' },
    ]);
    expect(engine.roomState.stack).toEqual([]);
    expect(charge()).toBe(0);
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: 'puppet', playerId: 'player1', from: 'hand', to: 'battlefield' }]);
    resolveByPassing(engine);
    expect(charge()).toBe(1);
    const destroy = (cardUuid: string) => ({ cardUuid: source.uuid, abilityId: 'charged-destruction', targets: [{ targetType: 'permanent', cardUuid }] });
    const add = (amount: number) => engine.applyMutations([{ type: 'ADD_COUNTER', cardUuid: source.uuid, counterType: 'charge', amount }]);
    add(4);
    expect(engine.executePlayerAction('player1', 'activate_ability', destroy('enemy')).success).toBe(false);
    expect(charge()).toBe(5);
    engine.applyMutations([{ type: 'TAP_CARD', cardUuid: 'enemy' }, { type: 'TAP_CARD', cardUuid: 'second' }]);
    act(engine, 'activate_ability', destroy('enemy'));
    expect(charge()).toBe(0);
    resolveByPassing(engine);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid)).toEqual(['enemy']);
    add(5);
    expect(engine.executePlayerAction('player1', 'activate_ability', destroy('second')).success).toBe(false);
    expect(charge()).toBe(5);
    engine.applyMutations([{ type: 'SET_TURN', playerId: 'player1', advance: true }]);
    act(engine, 'activate_ability', destroy('second'));
    resolveByPassing(engine);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid)).toEqual(['enemy', 'second']);
  },
}] satisfies CardCase[];
