import { describe, it, expect } from 'vitest';
import { ActionValidator } from '../../src/engine/action-validator';
import { createTestRoom } from '../helpers/test-room-factory';
import type { ActionRequirements } from '../../src/types/effect.types';

describe('ActionValidator', () => {
  describe('canPayCost', () => {
    it('should return true when no cost is provided', () => {
      const room = createTestRoom();
      const card = room.players['player1'].hand[0];
      expect(ActionValidator.canPayCost(room, 'player1', card, undefined)).toBe(true);
    });

    it('should return true when player has enough mana', () => {
      const room = createTestRoom();
      const card = room.players['player1'].hand[0];
      // player1 has 5 red mana, cost is 1 red
      expect(ActionValidator.canPayCost(room, 'player1', card, { mana: { red: 1 } })).toBe(true);
    });

    it('should return false when player lacks specific mana color', () => {
      const room = createTestRoom();
      room.players['player1'].mana.red = 0;
      const card = room.players['player1'].hand[0];
      expect(ActionValidator.canPayCost(room, 'player1', card, { mana: { red: 1 } })).toBe(false);
    });

    it('should return false when player lacks enough mana quantity', () => {
      const room = createTestRoom();
      room.players['player1'].mana.red = 1;
      const card = room.players['player1'].hand[0];
      expect(ActionValidator.canPayCost(room, 'player1', card, { mana: { red: 3 } })).toBe(false);
    });

    it('should return false when life cost exceeds player life', () => {
      const room = createTestRoom();
      const card = room.players['player1'].hand[0];
      expect(ActionValidator.canPayCost(room, 'player1', card, { life: 25 })).toBe(false);
    });

    it('should return false when card is already tapped and tap cost required', () => {
      const room = createTestRoom();
      const card = room.players['player1'].hand[0];
      card.state.isTapped = true;
      expect(ActionValidator.canPayCost(room, 'player1', card, { tap: true })).toBe(false);
    });

    it('should return false when discard cost exceeds hand size', () => {
      const room = createTestRoom();
      const card = room.players['player1'].hand[0];
      expect(ActionValidator.canPayCost(room, 'player1', card, { discard: 5 })).toBe(false);
    });

    it('should handle colorless mana requirements', () => {
      const room = createTestRoom();
      const card = room.players['player1'].hand[0];
      expect(ActionValidator.canPayCost(room, 'player1', card, { mana: { colorless: 2 } })).toBe(true);
    });
  });

  describe('canActivate', () => {
    it('should validate a playable card in hand', () => {
      const room = createTestRoom();
      const card = room.players['player1'].hand[0];
      const req: ActionRequirements = {
        allowedZones: ['hand'],
        speed: 'sorcery',
        cost: { mana: { red: 1 } },
      };
      const result = ActionValidator.canActivate(room, 'player1', card, req);
      expect(result.valid).toBe(true);
    });

    it('should reject card not in allowed zone', () => {
      const room = createTestRoom();
      const card = room.players['player1'].hand[0];
      card.state.zone = 'graveyard';
      const req: ActionRequirements = {
        allowedZones: ['hand'],
        speed: 'sorcery',
      };
      const result = ActionValidator.canActivate(room, 'player1', card, req);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('graveyard');
    });

    it('should reject sorcery-speed when stack is not empty', () => {
      const room = createTestRoom();
      room.stack.push({} as any); // non-empty stack
      const card = room.players['player1'].hand[0];
      const req: ActionRequirements = {
        allowedZones: ['hand'],
        speed: 'sorcery',
      };
      const result = ActionValidator.canActivate(room, 'player1', card, req);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('sorcery speed');
    });

    it('should reject when player does not have priority', () => {
      const room = createTestRoom();
      room.priorityPlayerId = 'player2';
      const card = room.players['player1'].hand[0];
      const req: ActionRequirements = {
        allowedZones: ['hand'],
        speed: 'instant',
      };
      const result = ActionValidator.canActivate(room, 'player1', card, req);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('priority');
    });
  });
});