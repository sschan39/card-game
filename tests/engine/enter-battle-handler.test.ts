import { describe, it, expect, beforeEach } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { enterBattleHandler } from '../../src/engine/handlers/enter-battle-handler';
import type { GameRoom } from '../../src/types/game.room.types';
import type { StackObject } from '../../src/types/effect.types';

describe('enterBattleHandler', () => {
  let room: GameRoom;

  beforeEach(() => {
    room = createTestRoom();
  });

  describe('validate', () => {
    it('should allow entering battle from the main phase with an empty stack', () => {
      const result = enterBattleHandler.validate(room, 'player1', {});
      expect(result.success).toBe(true);
    });

    it('should reject entering battle while the stack is non-empty', () => {
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

      const result = enterBattleHandler.validate(room, 'player1', {});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.phase).toBe('validate');
        expect(result.reason).toMatch(/stack/i);
      }
    });

    it('should reject entering battle during RPS phase', () => {
      room.status = 'RPS';
      const result = enterBattleHandler.validate(room, 'player1', {});
      expect(result.success).toBe(false);
    });

    it('should reject entering battle when it is not the player\'s turn', () => {
      const result = enterBattleHandler.validate(room, 'player2', {});
      expect(result.success).toBe(false);
    });

    it('should reject entering battle outside the main phase', () => {
      room.phase = 'beginCombatStep';
      const result = enterBattleHandler.validate(room, 'player1', {});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toMatch(/main phase/i);
      }
    });
  });
});
