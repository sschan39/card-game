import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createTestRoom } from '../helpers/test-room-factory';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { ActionRegistry, registerAction } from '../../src/engine/action-registry';
import type { GameRoom } from '../../src/types/game.room.types';

describe('playCardHandler', () => {
  let room: GameRoom;

  beforeEach(() => {
    room = createTestRoom();
    registerAction('cast_spell', playCardHandler);
    // Set a mana cost on the card in hand so propose can deduct mana
    const card = room.players['player1'].hand[0];
    card.castRequirements.cost = { mana: { red: 1 }, tap: false, life: 0, discard: 0, sacrifice: false };
  });

  describe('validate', () => {
    it('should validate a playable creature card', () => {
      const card = room.players['player1'].hand[0];
      const result = playCardHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(result.success).toBe(true);
    });

    it('should reject when card is not in hand', () => {
      const card = room.players['player1'].hand[0];
      card.state.zone = 'graveyard';
      const result = playCardHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.phase).toBe('validate');
      }
    });

    it('should reject when player lacks mana', () => {
      room.players['player1'].mana.red = 0;
      const card = room.players['player1'].hand[0];
      const result = playCardHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(result.success).toBe(false);
    });

    it('should reject when card uuid does not exist in hand', () => {
      const result = playCardHandler.validate(room, 'player1', { cardUuid: 'nonexistent-uuid' });
      expect(result.success).toBe(false);
    });
  });

  describe('propose', () => {
    it('should pay costs and create a StackObject', () => {
      const card = room.players['player1'].hand[0];
      const initialHandSize = room.players['player1'].hand.length;
      const initialRedMana = room.players['player1'].mana.red;

      const result = playCardHandler.propose(room, 'player1', { cardUuid: card.uuid });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.stackObject).toBeDefined();
        expect(result.stackObject!.type).toBe('spell');
        expect(result.stackObject!.controllerId).toBe('player1');
        expect(result.stackObject!.payload.effectId).toBe('CAST_SPELL');
      }

      // Card removed from hand
      expect(room.players['player1'].hand.length).toBe(initialHandSize - 1);

      // Mana deducted (empire-servant costs 1 red)
      expect(room.players['player1'].mana.red).toBe(initialRedMana - 1);

      // StackObject pushed to stack
      expect(room.stack.length).toBe(1);
    });

    it('should reject when card not found in hand during propose', () => {
      const result = playCardHandler.propose(room, 'player1', { cardUuid: 'nonexistent' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.phase).toBe('propose');
      }
    });
  });

  describe('resolve', () => {
    it('should move a creature card to the battlefield', () => {
      // First propose to get a stack object
      const card = room.players['player1'].hand[0];
      const proposeResult = playCardHandler.propose(room, 'player1', { cardUuid: card.uuid });
      expect(proposeResult.success).toBe(true);

      const stackObj = (proposeResult as { success: true; stackObject: any }).stackObject;
      const initialBattlefieldSize = room.battlefield.length;

      const resolveResult = playCardHandler.resolve(room, stackObj);
      expect(resolveResult.success).toBe(true);

      // Card on battlefield
      expect(room.battlefield.length).toBe(initialBattlefieldSize + 1);
      const resolvedCard = room.battlefield[room.battlefield.length - 1];
      expect(resolvedCard.state.zone).toBe('battlefield');
      expect(resolvedCard.state.summoningSickness).toBe(true);
    });
  });

  describe('full flow: validate → propose → resolve', () => {
    it('should complete the full play-card lifecycle', () => {
      const card = room.players['player1'].hand[0];
      const cardName = card.name;

      // 1. Validate
      const validateResult = playCardHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(validateResult.success).toBe(true);

      // 2. Propose
      const proposeResult = playCardHandler.propose(room, 'player1', { cardUuid: card.uuid });
      expect(proposeResult.success).toBe(true);
      expect(room.stack.length).toBe(1);

      // 3. Resolve
      const stackObj = (proposeResult as { success: true; stackObject: any }).stackObject;
      const resolveResult = playCardHandler.resolve(room, stackObj);
      expect(resolveResult.success).toBe(true);

      // Card is now on battlefield
      const onBattlefield = room.battlefield.find(c => c.name === cardName);
      expect(onBattlefield).toBeDefined();
      expect(onBattlefield!.state.zone).toBe('battlefield');
    });
  });
});