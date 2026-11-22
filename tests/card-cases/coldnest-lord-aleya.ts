import { expect } from 'vitest';
import { StateMachine } from '@engine/state-machine';
import { act, fixtureCard, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'makes cold, charges only from friendly Ice Dragons and protects both players through the end of combat',
  covers: ['play', 'ability:mana', 'ability:ice-dragon-entry-charge', 'ability:guard-both-players'],
  prepare(room) {
    room.players.player1.hand.push(fixtureCard('ally', 'player1', 'hand', { subTypes: ['冰龍'] }), fixtureCard('ordinary', 'player1', 'hand'));
    room.players.player2.hand.push(fixtureCard('enemy', 'player2', 'hand', { subTypes: ['冰龍'] }));
  },
  run(engine, source) {
    const aleya = () => permanent(engine, source.uuid);
    const charge = () => aleya().state.counters.charge ?? 0;
    act(engine, 'play_land', { cardUuid: source.uuid, zoneRevision: source.state.zoneRevision ?? 0 });
    act(engine, 'tapForMana', { cardUuid: source.uuid, abilityId: 'mana' });
    expect(engine.roomState.players.player1.mana.white).toBe(6);
    expect(aleya().state.isTapped).toBe(true);
    expect(engine.roomState.stack).toEqual([]);
    engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: 'enemy', playerId: 'player2', from: 'hand', to: 'battlefield' },
      { type: 'MOVE_CARD', cardUuid: 'ordinary', playerId: 'player1', from: 'hand', to: 'battlefield' },
    ]);
    expect(engine.roomState.stack).toEqual([]);
    act(engine, 'cast_spell', { cardUuid: 'ally' });
    resolveByPassing(engine);
    resolveByPassing(engine);
    expect(charge()).toBe(1);
    engine.applyMutations([{ type: 'ADD_COUNTER', cardUuid: source.uuid, counterType: 'charge', amount: 3 }]);
    const protect = { cardUuid: source.uuid, abilityId: 'guard-both-players' };
    expect(engine.executePlayerAction('player1', 'activate_ability', protect).success).toBe(false);
    expect(charge()).toBe(4);
    engine.applyMutations([{ type: 'SET_PHASE', phase: 'beginCombatStep' }]);
    act(engine, 'activate_ability', protect);
    expect(charge()).toBe(0);
    resolveByPassing(engine);
    const loss = ['player1', 'player2'].map(playerId => ({ type: 'CHANGE_LIFE' as const, playerId, amount: -2 }));
    engine.applyMutations([{ type: 'SET_PHASE', phase: 'endCombatStep' }, ...loss]);
    expect(Object.values(engine.roomState.players).map(player => player.life)).toEqual([20, 20]);
    engine.applyMutations(new StateMachine(engine.roomState).transition(engine.roomState, 'postcombatMainPhase'));
    engine.applyMutations(loss);
    expect(Object.values(engine.roomState.players).map(player => player.life)).toEqual([18, 18]);
  },
}] satisfies CardCase[];
