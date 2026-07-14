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
    // Clear and re-register
    Object.keys(ActionRegistry).forEach(key => delete ActionRegistry[key]);
    registerAction('cast_spell', playCardHandler);

    room = createTestRoom();
    // Set a mana cost on the card so validation/propose work
    const card = room.players['player1'].hand[0];
    card.castRequirements.cost = { mana: { red: 1 }, tap: false, life: 0, discard: 0, sacrifice: false };
    engine = new GameEngine();
  });

  describe('handleAction', () => {
    it('should validate and propose a valid action', () => {
      const card = room.players['player1'].hand[0];
      const result = engine.handleAction(room, 'player1', 'cast_spell', { cardUuid: card.uuid });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.stackObject).toBeDefined();
        expect(room.stack.length).toBe(1);
      }
    });

    it('should reject an unregistered action type', () => {
      const card = room.players['player1'].hand[0];
      const result = engine.handleAction(room, 'player1', 'nonexistent_action', { cardUuid: card.uuid });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toContain('No handler registered');
      }
    });

    it('should reject when validation fails', () => {
      room.players['player1'].mana.red = 0;
      const card = room.players['player1'].hand[0];
      const result = engine.handleAction(room, 'player1', 'cast_spell', { cardUuid: card.uuid });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.phase).toBe('validate');
      }
    });
  });

  describe('resolveTopOfStack', () => {
    it('should resolve the top stack object', () => {
      const card = room.players['player1'].hand[0];
      const proposeResult = engine.handleAction(room, 'player1', 'cast_spell', { cardUuid: card.uuid });
      expect(proposeResult.success).toBe(true);

      const resolveResult = engine.resolveTopOfStack(room);
      expect(resolveResult.success).toBe(true);
      expect(room.stack.length).toBe(0);
      expect(room.battlefield.length).toBe(1);
    });

    it('should return failure when stack is empty', () => {
      const result = engine.resolveTopOfStack(room);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toContain('empty');
      }
    });

    it('should revalidate targets at resolve time (target removed before resolution)', () => {
      // First, put a creature on opponent's battlefield as a target
      const targetCard = instantiateCard('empire-servant');
      targetCard.state.zone = 'battlefield';
      targetCard.state.controllerId = 'player2';
      targetCard.state.ownerId = 'player2';
      targetCard.state.damageTaken = 0;
      room.battlefield.push(targetCard);

      // Give player1 a card with a damage effect targeting that creature
      const card = room.players['player1'].hand[0];
      card.onCastEffects = [
        {
          action: 'MODIFY_STATS',
          params: { damage: 3 },
          tags: ['damage'],
          targeting: { type: 'permanent', required: true, minTargets: 1, maxTargets: 1 },
        },
      ];

      // Propose with the target
      const proposeResult = engine.handleAction(room, 'player1', 'cast_spell', {
        cardUuid: card.uuid,
        targets: [{ targetType: 'permanent', cardUuid: targetCard.uuid }],
      });
      expect(proposeResult.success).toBe(true);

      // BEFORE resolution: remove the target from battlefield (simulate opponent's bounce spell)
      room.battlefield = [];

      // Resolve — should NOT crash and should NOT deal damage to the missing target
      const resolveResult = engine.resolveTopOfStack(room);
      expect(resolveResult.success).toBe(true);

      // Target was removed before resolution, so no damage should be applied
      expect(targetCard.state.damageTaken).toBe(0);
    });
  });
});