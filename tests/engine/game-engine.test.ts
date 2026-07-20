// tests/engine/game-engine.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { ActionRegistry, registerAction } from '../../src/engine/action-registry';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';

describe('GameEngine', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    Object.keys(ActionRegistry).forEach(key => delete ActionRegistry[key]);
    registerAction('cast_spell', playCardHandler);

    room = createTestRoom();
    const card = room.players['player1'].hand[0];
    card.castRequirements.cost = { mana: { red: 1 }, tap: false, life: 0, discard: 0, sacrifice: false };
    engine = new GameEngine(room);
  });

  describe('handleAction', () => {
    it('should validate and propose a valid action', () => {
      const card = room.players['player1'].hand[0];
      const result = engine.handleAction('player1', 'cast_spell', { cardUuid: card.uuid });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.stackObject).toBeDefined();
        expect(room.stack.length).toBe(1);
      }
    });

    it('should reject an unregistered action type', () => {
      const card = room.players['player1'].hand[0];
      const result = engine.handleAction('player1', 'nonexistent_action', { cardUuid: card.uuid });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toContain('No handler registered');
      }
    });

    it('should reject when validation fails', () => {
      room.players['player1'].mana.red = 0;
      const card = room.players['player1'].hand[0];
      const result = engine.handleAction('player1', 'cast_spell', { cardUuid: card.uuid });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.phase).toBe('validate');
      }
    });
  });

  describe('proposeAndStack', () => {
    it('should propose action and push to stack', () => {
      const card = room.players['player1'].hand[0];
      const result = engine.proposeAndStack('player1', 'cast_spell', { cardUuid: card.uuid });

      expect(result.success).toBe(true);
      expect(room.stack.length).toBe(1);
    });
  });

  describe('resolveTopOfStack', () => {
    it('should resolve the top stack object', () => {
      const card = room.players['player1'].hand[0];
      engine.proposeAndStack('player1', 'cast_spell', { cardUuid: card.uuid });

      const result = engine.resolveTopOfStack();
      expect(result.success).toBe(true);
      expect(room.stack.length).toBe(0);
    });

    it('should fail when stack is empty', () => {
      const result = engine.resolveTopOfStack();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('Stack is empty');
      }
    });
  });
});