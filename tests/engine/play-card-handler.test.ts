import { describe, it, expect, beforeEach } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { ActionRegistry, registerAction } from '../../src/engine/action-registry';
import { EventBus } from '../../src/engine/event-bus';
import type { GameRoom } from '../../src/types/game.room.types';
import type { EffectDefinition } from '../../src/types/effect.types';

describe('playCardHandler', () => {
  let room: GameRoom;
  let eventBus: EventBus;

  beforeEach(() => {
    room = createTestRoom();
    eventBus = new EventBus(room.roomId);
    registerAction('cast_spell', playCardHandler);
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
      if (!result.success) expect(result.phase).toBe('validate');
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
    it('should pay costs and create a StackObject with effects array', () => {
      const card = room.players['player1'].hand[0];
      // Attach onCastEffects to the card
      (card as any).onCastEffects = [
        { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self', required: false } },
      ] as EffectDefinition[];

      const initialHandSize = room.players['player1'].hand.length;
      const initialRedMana = room.players['player1'].mana.red;

      const result = playCardHandler.propose(room, 'player1', { cardUuid: card.uuid });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.stackObject).toBeDefined();
        expect(result.stackObject!.type).toBe('spell');
        expect(result.stackObject!.controllerId).toBe('player1');
        expect(result.stackObject!.effects.length).toBe(1);
        expect(result.stackObject!.effects[0].action).toBe('DRAW');
      }

      expect(room.players['player1'].hand.length).toBe(initialHandSize - 1);
      expect(room.players['player1'].mana.red).toBe(initialRedMana - 1);
      expect(room.stack.length).toBe(1);
    });

    it('should create StackObject with empty effects when no onCastEffects', () => {
      const card = room.players['player1'].hand[0];
      const result = playCardHandler.propose(room, 'player1', { cardUuid: card.uuid });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.stackObject!.effects).toEqual([]);
      }
    });

    it('should reject when card not found in hand during propose', () => {
      const result = playCardHandler.propose(room, 'player1', { cardUuid: 'nonexistent' });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.phase).toBe('propose');
    });
  });

  describe('resolve', () => {
    it('should move a creature card to the battlefield via structural zone change', () => {
      const card = room.players['player1'].hand[0];
      const proposeResult = playCardHandler.propose(room, 'player1', { cardUuid: card.uuid });
      expect(proposeResult.success).toBe(true);

      const stackObj = (proposeResult as { success: true; stackObject: any }).stackObject;
      const initialBattlefieldSize = room.battlefield.length;

      const resolveResult = playCardHandler.resolve(room, stackObj);
      expect(resolveResult.success).toBe(true);

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

      const validateResult = playCardHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(validateResult.success).toBe(true);

      const proposeResult = playCardHandler.propose(room, 'player1', { cardUuid: card.uuid });
      expect(proposeResult.success).toBe(true);
      expect(room.stack.length).toBe(1);

      const stackObj = (proposeResult as { success: true; stackObject: any }).stackObject;
      const resolveResult = playCardHandler.resolve(room, stackObj);
      expect(resolveResult.success).toBe(true);

      const onBattlefield = room.battlefield.find(c => c.name === cardName);
      expect(onBattlefield).toBeDefined();
      expect(onBattlefield!.state.zone).toBe('battlefield');
    });
  });
});