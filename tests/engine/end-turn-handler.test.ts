import { describe, it, expect, beforeEach } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { endTurnHandler } from '../../src/engine/handlers/end-turn-handler';
import type { GameRoom } from '../../src/types/game.room.types';
import type { StackObject } from '../../src/types/effect.types';

describe('endTurnHandler', () => {
  let room: GameRoom;

  beforeEach(() => {
    room = createTestRoom();
  });

  describe('validate', () => {
    it('should allow ending the turn when the stack is empty', () => {
      const result = endTurnHandler.validate(room, 'player1', {});
      expect(result.success).toBe(true);
    });

    it('should reject ending the turn while the stack is non-empty', () => {
      const stackObj: StackObject = {
        uuid: 'stack-1',
        type: 'spell',
        controllerId: 'player1',
        source: {
          id: 'test',
          uuid: 'card-1',
          name: 'Test Spell',
          cardTypes: ['Spell'],
          state: { zone: 'stack' },
        },
        effects: [],
        countered: false,
      };
      room.stack = [stackObj];

      const result = endTurnHandler.validate(room, 'player1', {});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.phase).toBe('validate');
        expect(result.reason).toMatch(/stack/i);
      }
    });

    it('should reject ending the turn during RPS phase', () => {
      room.currentPhase = 'RPS';
      const result = endTurnHandler.validate(room, 'player1', {});
      expect(result.success).toBe(false);
    });

    it('should reject ending the turn when it is not the player\'s turn', () => {
      const result = endTurnHandler.validate(room, 'player2', {});
      expect(result.success).toBe(false);
    });
  });
});