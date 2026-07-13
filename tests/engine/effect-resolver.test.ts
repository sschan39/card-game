import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveEffects } from '../../src/engine/effect-resolver';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import { EventBus } from '../../src/engine/event-bus';
import type { GameRoom } from '../../src/types/game.room.types';
import type { StackObject, StackEffect } from '../../src/types/effect.types';
import { v4 as uuidv4 } from 'uuid';

function makeStackObj(room: GameRoom, effects: StackEffect[]): StackObject {
  return {
    uuid: uuidv4(),
    type: 'spell',
    controllerId: 'player1',
    source: {} as any,
    effects,
    timestamp: Date.now(),
    countered: false,
  };
}

describe('resolveEffects', () => {
  let room: GameRoom;
  let eventBus: EventBus;

  beforeEach(() => {
    room = createTestRoom();
    eventBus = new EventBus(room.roomId);
  });

  it('should resolve a single DRAW effect', () => {
    const card = instantiateCard('empire-servant');
    room.players['player1'].deck = [card];
    const initialHand = room.players['player1'].hand.length;

    const effect: StackEffect = { action: 'DRAW', params: { amount: 1 }, tags: [], targets: [] };
    const stackObj = makeStackObj(room, [effect]);

    resolveEffects(room, stackObj, eventBus);

    expect(room.players['player1'].hand.length).toBe(initialHand + 1);
  });

  it('should resolve multiple effects in order', () => {
    const card1 = instantiateCard('empire-servant');
    const card2 = instantiateCard('empire-servant');
    room.players['player1'].deck = [card1, card2];

    const effect1: StackEffect = { action: 'DRAW', params: { amount: 1 }, tags: [], targets: [] };
    const effect2: StackEffect = { action: 'DRAW', params: { amount: 1 }, tags: [], targets: [] };
    const stackObj = makeStackObj(room, [effect1, effect2]);

    const initialHand = room.players['player1'].hand.length;
    resolveEffects(room, stackObj, eventBus);

    expect(room.players['player1'].hand.length).toBe(initialHand + 2);
  });

  it('should emit STACK_ITEM_RESOLVED after resolving', () => {
    const listener = vi.fn();
    eventBus.on('STACK_ITEM_RESOLVED', listener);

    const effect: StackEffect = { action: 'DRAW', params: { amount: 0 }, tags: [], targets: [] };
    const stackObj = makeStackObj(room, [effect]);

    resolveEffects(room, stackObj, eventBus);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'STACK_ITEM_RESOLVED' })
    );
  });

  it('should skip effects when stackObj is countered', () => {
    const card = instantiateCard('empire-servant');
    room.players['player1'].deck = [card];
    const initialHand = room.players['player1'].hand.length;

    const effect: StackEffect = { action: 'DRAW', params: { amount: 1 }, tags: [], targets: [] };
    const stackObj = makeStackObj(room, [effect]);
    stackObj.countered = true;

    resolveEffects(room, stackObj, eventBus);

    // No draw happened
    expect(room.players['player1'].hand.length).toBe(initialHand);
  });
});