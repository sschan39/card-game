import { expect } from 'vitest';
import { castWithPayment, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [9, 4].map(life => ({
  name: `caps only the caster’s loss for the turn without healing them (starts at ${life})`,
  covers: ['play', 'cast effects'],
  prepare(room) {
    room.activeTurnPlayerId = 'player2';
    room.players.player1.life = life;
  },
  run(engine, source) {
    castWithPayment(engine, source, { white: 2 });
    resolveByPassing(engine);
    engine.applyMutations([
      { type: 'CHANGE_LIFE', playerId: 'player1', amount: -3 },
      { type: 'CHANGE_LIFE', playerId: 'player1', amount: -3 },
      { type: 'CHANGE_LIFE', playerId: 'player2', amount: -3 },
    ]);
    const floor = Math.min(life, 5);
    expect(engine.roomState.players.player1.life).toBe(floor);
    expect(engine.roomState.players.player2.life).toBe(17);
    engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }, { type: 'CHANGE_LIFE', playerId: 'player1', amount: -1 }]);
    expect(engine.roomState.players.player1.life).toBe(floor - 1);
  },
}) satisfies CardCase);
