// tests/engine/attack-handler.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { attackHandler } from '../../src/engine/handlers/attack-handler';
import { registerAction } from '../../src/engine/action-registry';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';

describe('attackHandler', () => {
  let room: GameRoom;

  beforeEach(() => {
    room = createTestRoom();
    registerAction('attack', attackHandler);
    // Set battle phase for attack tests
    room.currentPhase = 'stateBattlePhase';
    // Put a creature on the battlefield for player1
    const creature = instantiateCard('empire-servant');
    creature.state.zone = 'battlefield';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    creature.state.summoningSickness = false;
    room.battlefield.push(creature);
  });

  describe('validate', () => {
    it('should validate an untapped, non-sick creature in battle phase', () => {
      const card = room.battlefield[0];
      const result = attackHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(result.success).toBe(true);
    });

    it('should reject a tapped creature', () => {
      const card = room.battlefield[0];
      card.state.isTapped = true;
      const result = attackHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(result.success).toBe(false);
    });

    it('should reject a summoning sick creature', () => {
      const card = room.battlefield[0];
      card.state.summoningSickness = true;
      const result = attackHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(result.success).toBe(false);
    });

    it('should reject when creature not on battlefield', () => {
      const result = attackHandler.validate(room, 'player1', { cardUuid: 'nonexistent' });
      expect(result.success).toBe(false);
    });

    it('should reject when not your turn', () => {
      room.activeTurnPlayerId = 'player2';
      const card = room.battlefield[0];
      const result = attackHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(result.success).toBe(false);
    });

    it('should reject when not in battle phase', () => {
      room.currentPhase = 'stateMainPhase';
      const card = room.battlefield[0];
      const result = attackHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(result.success).toBe(false);
    });
  });

  describe('propose', () => {
    it('should tap creature and push a StackObject with MODIFY_LIFE effect', () => {
      const card = room.battlefield[0];
      const initialLife = room.players['player2'].life;

      const result = attackHandler.propose(room, 'player1', { cardUuid: card.uuid });

      expect(result.success).toBe(true);
      expect(card.state.isTapped).toBe(true);

      // Damage is deferred to stack resolution — life unchanged at propose time
      expect(room.players['player2'].life).toBe(initialLife);

      // StackObject should be on the stack
      if (result.success) {
        expect(result.stackObject).toBeDefined();
        expect(result.stackObject!.type).toBe('activated');
        expect(result.stackObject!.effects.length).toBe(1);
        expect(result.stackObject!.effects[0].action).toBe('MODIFY_LIFE');
        expect(result.stackObject!.effects[0].params.amount).toBe(-(card.blueprint.power ?? 0));
      }
      expect(room.stack.length).toBe(1);
    });
  });
});