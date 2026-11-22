import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { castWithPayment, declareAttack, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'sets life to 30 once and locks a rounded-down attack bonus until combat ends',
  covers: ['play', 'ability:set-life', 'ability:life-attack-bonus'],
  prepare(room) { room.players.player1.life = 35; },
  run(engine, source) {
    castWithPayment(engine, source, { yellow: 4, red: 1 });
    resolveByPassing(engine);
    resolveByPassing(engine);
    expect(engine.roomState.players.player1.life).toBe(30);
    engine.applyMutations([
      { type: 'SET_LIFE', playerId: 'player1', amount: 23 },
      { type: 'MOVE_CARD', playerId: 'player1', cardUuid: source.uuid, from: 'battlefield', to: 'graveyard' },
      { type: 'MOVE_CARD', playerId: 'player1', cardUuid: source.uuid, from: 'graveyard', to: 'battlefield' },
    ]);
    expect(engine.roomState.stack).toEqual([]);
    expect(engine.roomState.players.player1.life).toBe(23);
    const power = () => stats.resolvePower(engine.roomState, permanent(engine, source.uuid));
    expect(power()).toBe(2);
    declareAttack(engine, source.uuid);
    resolveByPassing(engine);
    expect(power()).toBe(10);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 20 }, { type: 'SET_PHASE', phase: 'endCombatStep' }]);
    expect(power()).toBe(10);
    engine.applyMutations([{ type: 'CLEAR_COMBAT' }]);
    expect(power()).toBe(2);
  },
}] satisfies CardCase[];
