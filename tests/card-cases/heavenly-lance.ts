import { expect } from 'vitest';
import { resolveByPassing } from '../helpers/card-test-cases';
import { equipmentAttack } from '../helpers/equipment-card-case';

export default [equipmentAttack(undefined, 'yellow', 1, engine => {
  resolveByPassing(engine);
  expect(engine.roomState.players.player1.life).toBe(21);
  expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['equipment-draw']);
})];
