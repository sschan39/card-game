import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveEffects, revalidateTargets, buildDynamicParams } from '../../src/engine/effect-resolver';
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

describe('revalidateTargets', () => {
  let room: GameRoom;

  beforeEach(() => {
    room = createTestRoom();
  });

  it('should keep valid targets that are still on the battlefield', () => {
    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.controllerId = 'player2';
    room.battlefield.push(card);

    const effect: StackEffect = {
      action: 'MODIFY_STATS',
      params: { damage: 3 },
      tags: ['damage'],
      targets: [{ targetType: 'permanent', cardUuid: card.uuid }],
    };

    const result = revalidateTargets(room, effect);
    expect(result.targets.length).toBe(1);
    expect(result.targets[0].cardUuid).toBe(card.uuid);
  });

  it('should remove targets that have left the battlefield', () => {
    const effect: StackEffect = {
      action: 'MODIFY_STATS',
      params: { damage: 3 },
      tags: ['damage'],
      targets: [{ targetType: 'permanent', cardUuid: 'nonexistent-uuid' }],
    };

    const result = revalidateTargets(room, effect);
    expect(result.targets.length).toBe(0);
  });

  it('should keep player targets that still exist', () => {
    const effect: StackEffect = {
      action: 'MODIFY_LIFE',
      params: { amount: -3 },
      tags: ['damage'],
      targets: [{ targetType: 'player', playerId: 'player2' }],
    };

    const result = revalidateTargets(room, effect);
    expect(result.targets.length).toBe(1);
  });

  it('should remove player targets for nonexistent players', () => {
    const effect: StackEffect = {
      action: 'MODIFY_LIFE',
      params: { amount: -3 },
      tags: ['damage'],
      targets: [{ targetType: 'player', playerId: 'nonexistent' }],
    };

    const result = revalidateTargets(room, effect);
    expect(result.targets.length).toBe(0);
  });

  it('should keep stack targets that are still on the stack', () => {
    const stackObj = {
      uuid: 'stack-uuid-1',
      type: 'spell' as const,
      controllerId: 'player2',
      source: {} as any,
      effects: [],
      countered: false,
    };
    room.stack.push(stackObj);

    const effect: StackEffect = {
      action: 'MOVE_ZONE',
      params: { origin: 'stack', destination: 'graveyard' },
      tags: ['counter'],
      targets: [{ targetType: 'stack', stackUuid: 'stack-uuid-1' }],
    };

    const result = revalidateTargets(room, effect);
    expect(result.targets.length).toBe(1);
  });

  it('should remove stack targets that have already resolved', () => {
    const effect: StackEffect = {
      action: 'MOVE_ZONE',
      params: { origin: 'stack', destination: 'graveyard' },
      tags: ['counter'],
      targets: [{ targetType: 'stack', stackUuid: 'already-resolved-uuid' }],
    };

    const result = revalidateTargets(room, effect);
    expect(result.targets.length).toBe(0);
  });
});

describe('buildDynamicParams', () => {
  let room: GameRoom;

  beforeEach(() => {
    room = createTestRoom();
  });

  it('should compute current power for a creature on the battlefield', () => {
    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.controllerId = 'player1';
    card.power = 1;
    room.battlefield.push(card);

    const effect: StackEffect = {
      action: 'MODIFY_STATS',
      params: { power: 'DYNAMIC:source.power' },
      tags: [],
      targets: [{ targetType: 'permanent', cardUuid: card.uuid }],
    };

    const stackObj = {
      uuid: 'test-uuid',
      type: 'spell' as const,
      controllerId: 'player1',
      source: card,
      effects: [effect],
      countered: false,
    };

    const dynamic = buildDynamicParams(room, stackObj, effect);
    expect(dynamic.power).toBe(1);
  });

  it('should return empty object when no dynamic markers present', () => {
    const effect: StackEffect = {
      action: 'DRAW',
      params: { amount: 1 },
      tags: [],
      targets: [],
    };

    const stackObj = {
      uuid: 'test-uuid',
      type: 'spell' as const,
      controllerId: 'player1',
      source: {} as any,
      effects: [effect],
      countered: false,
    };

    const dynamic = buildDynamicParams(room, stackObj, effect);
    expect(dynamic).toEqual({});
  });
});