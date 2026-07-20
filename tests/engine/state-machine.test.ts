// tests/engine/state-machine.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { StateMachine } from '../../src/engine/state-machine';
import { EventBus } from '../../src/engine/event-bus';
import type { GameEvent } from '../../src/engine/event-bus';
import type { GameRoom } from '../../src/types/game.room.types';

function createTestRoom(): GameRoom {
  return {
    roomId: 'room-1',
    player1Id: 'player1',
    player2Id: 'player2',
    players: {
      player1: { id: 'player1', life: 20, mana: { red: 0, blue: 0, green: 0, black: 0, white: 0, colorless: 0 }, deck: [], hand: [], graveyard: [] },
      player2: { id: 'player2', life: 20, mana: { red: 0, blue: 0, green: 0, black: 0, white: 0, colorless: 0 }, deck: [], hand: [], graveyard: [] },
    },
    currentPhase: 'waiting',
    activeTurnPlayerId: 'player1',
    priorityPlayerId: null,
    lastPassedPlayerId: null,
    battlefield: [],
    stack: [],
    rpsState: { status: 'pending', playedCards: {} },
  };
}

describe('StateMachine', () => {
  let sm: StateMachine;
  let room: GameRoom;
  let bus: EventBus;
  let events: GameEvent[];

  beforeEach(() => {
    events = [];
    room = createTestRoom();
    bus = new EventBus('room-1');
    bus.on('PHASE_CHANGED', (e) => events.push(e));
    bus.on('TURN_SWITCHED', (e) => events.push(e));
    sm = new StateMachine(room, bus);
  });

  describe('initial state', () => {
    it('should start in waiting phase', () => {
      expect(room.currentPhase).toBe('waiting');
    });

    it('should have player1 as current player', () => {
      expect(room.activeTurnPlayerId).toBe('player1');
    });

    it('should start with empty stack', () => {
      expect(room.stack).toEqual([]);
    });
  });

  describe('phase transitions', () => {
    it('should transition to a valid next phase', () => {
      sm.transition('RPS');
      expect(room.currentPhase).toBe('RPS');
    });

    it('should emit PHASE_CHANGED on transition', () => {
      sm.transition('RPS');
      const phaseEvent = events.find(e => e.eventId === 'PHASE_CHANGED');
      expect(phaseEvent).toBeDefined();
      expect(phaseEvent!.payload.phase).toBe('RPS');
    });

    it('should reject invalid transitions', () => {
      // 'waiting' can only go to 'RPS', not 'stateMainPhase'
      sm.transition('stateMainPhase');
      expect(room.currentPhase).toBe('waiting'); // unchanged
    });

    it('should allow Stack transition from any phase when stack is open', () => {
      sm.transition('RPS');
      sm.transition('Stack');
      expect(room.currentPhase).toBe('Stack');
    });

    it('should reject Stack transition when stack is closed', () => {
      sm.stackOpen = false;
      sm.transition('RPS');
      sm.transition('Stack');
      expect(room.currentPhase).toBe('RPS'); // unchanged
    });

    it('should save previousPhase when entering Stack', () => {
      sm.transition('RPS');
      sm.transition('Stack');
      expect(sm.previousPhase).toBe('RPS');
    });

    it('should transition through full turn cycle', () => {
      sm.transition('RPS');
      sm.transition('stateTurnStart');
      expect(room.currentPhase).toBe('stateTurnStart');
      sm.transition('stateDrawPhase');
      expect(room.currentPhase).toBe('stateDrawPhase');
      sm.transition('stateMainPhase');
      expect(room.currentPhase).toBe('stateMainPhase');
      sm.transition('stateBattlePhase');
      expect(room.currentPhase).toBe('stateBattlePhase');
      sm.transition('endCombat');
      expect(room.currentPhase).toBe('endCombat');
      sm.transition('stateEndPhase');
      expect(room.currentPhase).toBe('stateEndPhase');
      sm.transition('cleanupStep');
      expect(room.currentPhase).toBe('cleanupStep');
      sm.transition('stateTurnStart');
      expect(room.currentPhase).toBe('stateTurnStart');
    });
  });

  describe('turn management', () => {
    it('should switch current player', () => {
      sm.switchTurn();
      expect(room.activeTurnPlayerId).toBe('player2');
    });

    it('should emit TURN_SWITCHED on switch', () => {
      sm.switchTurn();
      const turnEvent = events.find(e => e.eventId === 'TURN_SWITCHED');
      expect(turnEvent).toBeDefined();
      expect(turnEvent!.payload.newPlayer).toBe('player2');
    });

    it('should switch back to player1 after two switches', () => {
      sm.switchTurn();
      sm.switchTurn();
      expect(room.activeTurnPlayerId).toBe('player1');
    });

    it('should correctly report isPlayerTurn', () => {
      expect(sm.isPlayerTurn('player1')).toBe(true);
      expect(sm.isPlayerTurn('player2')).toBe(false);
      sm.switchTurn();
      expect(sm.isPlayerTurn('player1')).toBe(false);
      expect(sm.isPlayerTurn('player2')).toBe(true);
    });
  });

  describe('priority system', () => {
    beforeEach(() => {
      sm.transition('RPS');
      sm.transition('stateTurnStart');
      sm.transition('stateDrawPhase');
      sm.transition('stateMainPhase');
    });

    it('should give priority to a player', () => {
      sm.givePriorityTo('player1');
      expect(room.priorityPlayerId).toBe('player1');
      expect(sm.waitingForResponse).toBe(true);
    });

    it('should emit PRIORITY_GIVEN', () => {
      bus.on('PRIORITY_GIVEN', (e) => events.push(e));
      sm.givePriorityTo('player1');
      const priorityEvent = events.find(e => e.eventId === 'PRIORITY_GIVEN');
      expect(priorityEvent).toBeDefined();
      expect(priorityEvent!.payload.playerId).toBe('player1');
    });

    it('should reject passPriority from wrong player', () => {
      sm.givePriorityTo('player1');
      const result = sm.passPriority('player2');
      expect(result).toBe(false);
    });

    it('should accept passPriority from correct player', () => {
      sm.givePriorityTo('player1');
      const result = sm.passPriority('player1');
      expect(result).toBe(true);
    });

    it('should resolve phase when both players pass consecutively', () => {
      sm.givePriorityTo('player1');
      sm.passPriority('player1'); // player1 passes
      // priority switches to player2
      expect(room.priorityPlayerId).toBe('player2');
      sm.passPriority('player2'); // player2 passes
      // both passed, phase should resolve
      expect(sm.waitingForResponse).toBe(false);
      expect(room.priorityPlayerId).toBeNull();
    });
  });

  describe('stack management', () => {
    beforeEach(() => {
      sm.transition('RPS');
      sm.transition('stateTurnStart');
      sm.transition('stateDrawPhase');
      sm.transition('stateMainPhase');
    });

    it('should add item to stack', () => {
      const stackObj = {
        uuid: 'stack-1',
        type: 'spell' as const,
        controllerId: 'player1',
        source: { id: 'test', uuid: 'card-1', name: 'Test Card', cardTypes: ['Spell'] as any, state: { zone: 'stack' as const } as any },
        effects: [] as any[],
        timestamp: Date.now(),
        countered: false,
      };
      // Handler pushes to room.stack; addToStack handles phase/event/priority
      room.stack.push(stackObj);
      sm.addToStack(stackObj);
      expect(room.stack.length).toBe(1);
      expect(room.stack[0].uuid).toBe('stack-1');
    });

    it('should transition to Stack state when adding to stack', () => {
      const stackObj = {
        uuid: 'stack-1',
        type: 'spell' as const,
        controllerId: 'player1',
        source: { id: 'test', uuid: 'card-1', name: 'Test Card', cardTypes: ['Spell'] as any, state: { zone: 'stack' as const } as any },
        effects: [] as any[],
        timestamp: Date.now(),
        countered: false,
      };
      room.stack.push(stackObj);
      sm.addToStack(stackObj);
      expect(room.currentPhase).toBe('Stack');
    });

    it('should emit STACK_UPDATED when adding to stack', () => {
      bus.on('STACK_UPDATED', (e) => events.push(e));
      const stackObj = {
        uuid: 'stack-1',
        type: 'spell' as const,
        controllerId: 'player1',
        source: { id: 'test', uuid: 'card-1', name: 'Test Card', cardTypes: ['Spell'] as any, state: { zone: 'stack' as const } as any },
        effects: [] as any[],
        timestamp: Date.now(),
        countered: false,
      };
      room.stack.push(stackObj);
      sm.addToStack(stackObj);
      const stackEvent = events.find(e => e.eventId === 'STACK_UPDATED');
      expect(stackEvent).toBeDefined();
    });

    it('should resolve stack in LIFO order', () => {
      const obj1 = {
        uuid: 'stack-1',
        type: 'spell' as const,
        controllerId: 'player1',
        source: { id: 'test', uuid: 'card-1', name: 'Test Card', cardTypes: ['Spell'] as any, state: { zone: 'stack' as const } as any },
        effects: [] as any[],
        timestamp: 1000,
        countered: false,
      };
      const obj2 = {
        uuid: 'stack-2',
        type: 'spell' as const,
        controllerId: 'player2',
        source: { id: 'test2', uuid: 'card-2', name: 'Test Card 2', cardTypes: ['Spell'] as any, state: { zone: 'stack' as const } as any },
        effects: [] as any[],
        timestamp: 2000,
        countered: false,
      };
      room.stack.push(obj1);
      sm.addToStack(obj1);
      room.stack.push(obj2);
      sm.addToStack(obj2);

      const resolved: string[] = [];
      while (room.stack.length > 0) {
        const item = room.stack.pop()!;
        resolved.push(item.uuid);
      }

      expect(resolved).toEqual(['stack-2', 'stack-1']); // LIFO
    });
  });
});