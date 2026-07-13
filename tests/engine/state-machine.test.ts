import { describe, it, expect, beforeEach } from 'vitest';
import { StateMachine } from '../../src/engine/state-machine';
import { EventBus } from '../../src/engine/event-bus';
import type { GameEvent } from '../../src/engine/event-bus';

describe('StateMachine', () => {
  let sm: StateMachine;
  let bus: EventBus;
  let events: GameEvent[];

  beforeEach(() => {
    events = [];
    bus = new EventBus('room-1');
    bus.on('PHASE_CHANGED', (e) => events.push(e));
    bus.on('TURN_SWITCHED', (e) => events.push(e));
    sm = new StateMachine('room-1', 'player1', 'player2', bus);
  });

  describe('initial state', () => {
    it('should start in waiting phase', () => {
      expect(sm.currentPhase).toBe('waiting');
    });

    it('should have player1 as current player', () => {
      expect(sm.currentPlayer).toBe('player1');
    });

    it('should start with empty stack', () => {
      expect(sm.stack).toEqual([]);
    });
  });

  describe('phase transitions', () => {
    it('should transition to a valid next phase', () => {
      sm.transition('RPS');
      expect(sm.currentPhase).toBe('RPS');
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
      expect(sm.currentPhase).toBe('waiting'); // unchanged
    });

    it('should allow Stack transition from any phase when stack is open', () => {
      sm.transition('RPS');
      sm.transition('Stack');
      expect(sm.currentPhase).toBe('Stack');
    });

    it('should reject Stack transition when stack is closed', () => {
      sm.stackOpen = false;
      sm.transition('RPS');
      sm.transition('Stack');
      expect(sm.currentPhase).toBe('RPS'); // unchanged
    });

    it('should save previousPhase when entering Stack', () => {
      sm.transition('RPS');
      sm.transition('Stack');
      expect(sm.previousPhase).toBe('RPS');
    });

    it('should transition through full turn cycle', () => {
      sm.transition('RPS');
      sm.transition('stateTurnStart');
      expect(sm.currentPhase).toBe('stateTurnStart');
      sm.transition('stateDrawPhase');
      expect(sm.currentPhase).toBe('stateDrawPhase');
      sm.transition('stateMainPhase');
      expect(sm.currentPhase).toBe('stateMainPhase');
      sm.transition('stateBattlePhase');
      expect(sm.currentPhase).toBe('stateBattlePhase');
      sm.transition('endCombat');
      expect(sm.currentPhase).toBe('endCombat');
      sm.transition('stateEndPhase');
      expect(sm.currentPhase).toBe('stateEndPhase');
      sm.transition('cleanupStep');
      expect(sm.currentPhase).toBe('cleanupStep');
      sm.transition('stateTurnStart');
      expect(sm.currentPhase).toBe('stateTurnStart');
    });
  });

  describe('turn management', () => {
    it('should switch current player', () => {
      sm.switchTurn();
      expect(sm.currentPlayer).toBe('player2');
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
      expect(sm.currentPlayer).toBe('player1');
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
      expect(sm.priorityPlayer).toBe('player1');
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
      expect(sm.priorityPlayer).toBe('player2');
      sm.passPriority('player2'); // player2 passes
      // both passed, phase should resolve
      expect(sm.waitingForResponse).toBe(false);
      expect(sm.priorityPlayer).toBeNull();
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
      sm.addToStack(stackObj);
      expect(sm.stack.length).toBe(1);
      expect(sm.stack[0].uuid).toBe('stack-1');
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
      sm.addToStack(stackObj);
      expect(sm.currentPhase).toBe('Stack');
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
      sm.addToStack(obj1);
      sm.addToStack(obj2);

      const resolved: string[] = [];
      while (sm.stack.length > 0) {
        const item = sm.stack.pop()!;
        resolved.push(item.uuid);
      }

      expect(resolved).toEqual(['stack-2', 'stack-1']); // LIFO
    });
  });
});