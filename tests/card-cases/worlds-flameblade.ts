import { expect } from 'vitest';
import { chooseTarget, resolveByPassing } from '../helpers/card-test-cases';
import { equipmentAttack } from '../helpers/equipment-card-case';

export default [equipmentAttack(undefined, { blue: 1, green: 1 }, 2, engine => {
  chooseTarget(engine, 'equipment-enemy', ['equipment-enemy']);
  resolveByPassing(engine);
  expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['equipment-draw']);
  expect(engine.roomState.battlefield.find(card => card.uuid === 'equipment-enemy')?.state.damageTaken).toBe(2);
  const events = engine.drainEventBatches().flatMap(batch => batch.events).map(event => event.eventId);
  expect(events).toContain('CARD_DRAWN');
  expect(events).toContain('DAMAGE_DEALT');
  expect(events.indexOf('CARD_DRAWN')).toBeLessThan(events.indexOf('DAMAGE_DEALT'));
})];
