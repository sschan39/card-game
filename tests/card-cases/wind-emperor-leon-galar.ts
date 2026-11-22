import { expect } from 'vitest';
import { act, castWithPayment, choose, declareAttack, fixtureCard, passPriorityPair, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';
import { freezeBoard, freezeThree } from '../helpers/wind-freeze-card-case';

export default [{
  name: 'marks the friendly Wind Beast that entered and freezes three enemies once per turn on attack',
  covers: ['play', 'ability:mark-entering-beast', 'ability:freeze-on-attack'],
  prepare(room) {
    room.battlefield = freezeBoard();
    room.players.player1.hand.push(fixtureCard('entrant', 'player1', 'hand', { subTypes: ['風獸'] }));
    room.players.player2.hand = [fixtureCard('enemy-beast', 'player2', 'hand', { subTypes: ['風獸'] })];
  },
  run(engine, source) {
    castWithPayment(engine, source, { green: 4, red: 1 });
    resolveByPassing(engine);
    passPriorityPair(engine);
    choose(engine, ['no']);
    act(engine, 'cast_spell', { cardUuid: 'entrant' });
    resolveByPassing(engine);
    passPriorityPair(engine);
    choose(engine, ['yes']);
    expect(permanent(engine, 'entrant').state.counters['+1/+1']).toBe(1);
    expect(permanent(engine, source.uuid).state.counters['+1/+1'] ?? 0).toBe(0);
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: 'enemy-beast', playerId: 'player2', from: 'hand', to: 'battlefield' }]);
    expect(engine.roomState.stack).toEqual([]);
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: 'enemy-beast', playerId: 'player2', from: 'battlefield', to: 'exile' }]);
    declareAttack(engine, source.uuid);
    freezeThree(engine);
    const clearAttack = () => engine.applyMutations([
      { type: 'CLEAR_COMBAT' }, { type: 'UNTAP_CARD', cardUuid: source.uuid },
      { type: 'SET_ATTACKED_THIS_TURN', cardUuid: source.uuid, value: false },
    ]);
    clearAttack();
    declareAttack(engine, source.uuid);
    expect(engine.roomState.pendingChoice).toBeFalsy();
    expect(engine.roomState.stack).toEqual([]);
    clearAttack();
    engine.applyMutations([{ type: 'SET_TURN', playerId: 'player1', advance: true }]);
    declareAttack(engine, source.uuid);
    expect(engine.roomState.pendingChoice?.kind).toBe('targets');
  },
}] satisfies CardCase[];
