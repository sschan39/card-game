import { describe, it, expect, beforeEach } from 'vitest';
import { TriggerManager } from '../../src/engine/trigger-manager';
import { EventBus } from '../../src/engine/event-bus';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';

describe('TriggerManager', () => {
  let room: GameRoom;
  let eventBus: EventBus;

  beforeEach(() => {
    room = createTestRoom();
    eventBus = new EventBus(room.roomId);
  });

  it('should push a triggered StackObject when PERMANENT_ENTERED fires with onEnterEffects', () => {
    new TriggerManager(eventBus, room);

    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.controllerId = 'player1';
    // Attach onEnterEffects to the card instance
    card.blueprint.onEnterEffects = [
      { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self', required: false } },
    ];

    const initialStackSize = room.stack.length;

    eventBus.emit({
      eventId: 'PERMANENT_ENTERED',
      roomId: room.roomId,
      payload: { card, controllerId: 'player1' },
    });

    expect(room.stack.length).toBe(initialStackSize + 1);
    const triggered = room.stack[room.stack.length - 1];
    expect(triggered.type).toBe('triggered');
    expect(triggered.effects.length).toBe(1);
    expect(triggered.effects[0].action).toBe('DRAW');
  });

  it('should not push a StackObject when card has no onEnterEffects', () => {
    new TriggerManager(eventBus, room);

    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.controllerId = 'player1';
    // Reset onEnterEffects from previous test's mutation
    card.blueprint.onEnterEffects = undefined;

    const initialStackSize = room.stack.length;

    eventBus.emit({
      eventId: 'PERMANENT_ENTERED',
      roomId: room.roomId,
      payload: { card, controllerId: 'player1' },
    });

    expect(room.stack.length).toBe(initialStackSize);
  });

  it('should auto-target self for effects with type=self', () => {
    new TriggerManager(eventBus, room);

    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.controllerId = 'player2';
    card.blueprint.onEnterEffects = [
      { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self', required: false } },
    ];

    eventBus.emit({
      eventId: 'PERMANENT_ENTERED',
      roomId: room.roomId,
      payload: { card, controllerId: 'player2' },
    });

    const triggered = room.stack[room.stack.length - 1];
    expect(triggered.controllerId).toBe('player2');
    // Self-targeting auto-fills the controller as target
    expect(triggered.effects[0].targets.length).toBe(1);
    expect(triggered.effects[0].targets[0].targetType).toBe('player');
    expect(triggered.effects[0].targets[0].playerId).toBe('player2');
  });
});