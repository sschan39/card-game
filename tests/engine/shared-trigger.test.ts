import { describe, expect, it } from 'vitest';
import { discoverTriggers } from '../../src/engine/trigger-manager';
import { normalizeCard } from '../../src/library/card-parser';
import { creature } from '../helpers/combat-fixture';
import { createTestRoom } from '../helpers/test-room-factory';

describe('non-stacking copies of a trigger', () => {
  it('discovers one shared ability per controller for a positive placement, regardless of counter amount', () => {
    const cards = ['one', 'two', 'enemy'].map((id, index) => {
      const card = creature(id, index === 2 ? 'player2' : 'player1', 3, 2);
      card.blueprint = normalizeCard({ id: 'shared-observer', abilities: [{ id: 'scorch-draw', type: 'triggered', sharedPerEvent: true,
        triggerCondition: 'ON_COUNTER_CHANGED', trigger: { subject: 'any', controller: 'self', condition: { all: [
          { op: 'eq', left: { path: 'event.payload.counterType' }, right: 'scorch' },
          { op: 'gt', left: { path: 'event.payload.amount' }, right: 0 },
        ] } }, effectId: 'DRAW', params: { amount: 1 } }] }); return card;
    });
    const room = createTestRoom({ battlefield: cards });
    const event = { eventId: 'COUNTER_CHANGED' as const, payload: { card: cards[2], counterType: 'scorch', oldCount: 0, newCount: 3, amount: 3, targetControllerId: 'player2', controllerId: 'player1' } };
    const context = { room, roomId: room.roomId, battlefield: cards };
    expect(discoverTriggers(event, context)).toHaveLength(1);
    expect(discoverTriggers({ ...event, payload: { ...event.payload, controllerId: 'player2' } }, context)).toHaveLength(1);
    expect(discoverTriggers({ ...event, payload: { ...event.payload, amount: -1 } }, context)).toHaveLength(0);
    expect(discoverTriggers({ ...event, payload: { ...event.payload, counterType: 'charge' } }, context)).toHaveLength(0);
  });
});
