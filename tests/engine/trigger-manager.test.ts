import { describe, it, expect, beforeEach } from 'vitest';
import { TriggerManager } from '../../src/engine/trigger-manager';
import { EventBus } from '../../src/engine/event-bus';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameMutation } from '../../src/types/game-mutation.types';
import type { GameRoom } from '../../src/types/game.room.types';

describe('TriggerManager', () => {
  let room: GameRoom;
  let eventBus: EventBus;
  let collector: GameMutation[];

  beforeEach(() => {
    room = createTestRoom();
    eventBus = new EventBus(room.roomId);
    collector = [];
  });

  it('should push a triggered StackObject when PERMANENT_ENTERED fires with onEnterEffects', () => {
    new TriggerManager(eventBus, collector, () => 'triggered-uuid-1');

    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.controllerId = 'player1';
    // Attach onEnterEffects to the card instance
    card.blueprint.onEnterEffects = [
      { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self', required: false } },
    ];

    eventBus.emit({
      eventId: 'PERMANENT_ENTERED',
      roomId: room.roomId,
      payload: { card, controllerId: 'player1' },
    });

    expect(collector.length).toBe(1);
    const mutation = collector[0];
    expect(mutation.type).toBe('PUSH_STACK');
    if (mutation.type === 'PUSH_STACK') {
      const triggered = mutation.stackObject;
      expect(triggered.type).toBe('triggered');
      expect(triggered.uuid).toBe('triggered-uuid-1');
      expect(triggered.effects.length).toBe(1);
      expect(triggered.effects[0].action).toBe('DRAW');
    }
  });

  it('should not push a StackObject when card has no onEnterEffects', () => {
    new TriggerManager(eventBus, collector, () => 'triggered-uuid-2');

    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.controllerId = 'player1';
    // Reset onEnterEffects from previous test's mutation
    card.blueprint.onEnterEffects = undefined;

    eventBus.emit({
      eventId: 'PERMANENT_ENTERED',
      roomId: room.roomId,
      payload: { card, controllerId: 'player1' },
    });

    expect(collector.length).toBe(0);
  });

  it('should auto-target self for effects with type=self', () => {
    new TriggerManager(eventBus, collector, () => 'triggered-uuid-3');

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

    expect(collector.length).toBe(1);
    const mutation = collector[0];
    expect(mutation.type).toBe('PUSH_STACK');
    if (mutation.type === 'PUSH_STACK') {
      const triggered = mutation.stackObject;
      expect(triggered.controllerId).toBe('player2');
      // Self-targeting auto-fills the controller as target
      expect(triggered.effects[0].targets.length).toBe(1);
      expect(triggered.effects[0].targets[0].targetType).toBe('player');
      expect(triggered.effects[0].targets[0].playerId).toBe('player2');
    }
  });

  it('should push a triggered StackObject when ATTACK_DECLARED fires with ON_ATTACK ability', () => {
    new TriggerManager(eventBus, collector, () => 'triggered-uuid-attack');

    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.controllerId = 'player1';
    // Attach a triggered ability with ON_ATTACK
    card.blueprint.abilities = [{
      type: 'triggered',
      triggerCondition: 'ON_ATTACK',
      effect: { effectId: 'DRAW', params: { amount: 1 } },
      castSpeed: 'instant',
    }];

    eventBus.emit({
      eventId: 'ATTACK_DECLARED',
      roomId: room.roomId,
      payload: { card, controllerId: 'player1' },
    });

    expect(collector.length).toBe(1);
    const mutation = collector[0];
    expect(mutation.type).toBe('PUSH_STACK');
    if (mutation.type === 'PUSH_STACK') {
      expect(mutation.stackObject.type).toBe('triggered');
      expect(mutation.stackObject.effects[0].action).toBe('DRAW');
    }
  });
});