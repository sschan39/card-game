import { expect } from 'vitest';
import { resolveByPassing } from '../helpers/card-test-cases';
import { equipmentAttack } from '../helpers/equipment-card-case';

export default [equipmentAttack('上使', 'yellow', 2, engine => {
  resolveByPassing(engine);
  expect(engine.roomState.players.player1.life).toBe(23);
  expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['equipment-draw']);
  expect(engine.roomState.players.player2.life).toBe(20);
})];
