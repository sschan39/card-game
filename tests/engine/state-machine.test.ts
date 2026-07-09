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
});