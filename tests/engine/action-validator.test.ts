import { describe, it, expect } from 'vitest';
import { ActionValidator } from '../../src/engine/action-validator';
import { createTestRoom } from '../helpers/test-room-factory';
import type { ActionRequirements, TargetingDefinition, TargetPointer } from '../../src/types/effect.types';

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

    it('should return false when a sick creature must pay a {T} cost (CR 302.6)', () => {
      const room = createTestRoom();
      const card = room.players['player1'].hand[0];
      card.blueprint.cardTypes = ['Creature'];
      card.state.summoningSickness = true;
      expect(ActionValidator.canPayCost(room, 'player1', card, { tap: true })).toBe(false);
    });

    it('should return true when a sick creature pays a NON-tap cost (CR 302.6)', () => {
      const room = createTestRoom();
      const card = room.players['player1'].hand[0];
      card.blueprint.cardTypes = ['Creature'];
      card.state.summoningSickness = true;
      // e.g. Crimson Hellkite's "{R}: +1/+0" — no {T} cost, usable while sick.
      expect(ActionValidator.canPayCost(room, 'player1', card, { mana: { red: 1 } })).toBe(true);
    });

    it('should return true when a sick non-creature pays a {T} cost (CR 302.6)', () => {
      const room = createTestRoom();
      const card = room.players['player1'].hand[0];
      card.blueprint.cardTypes = ['Artifact'];
      card.state.summoningSickness = true;
      // Summoning sickness only applies to creatures.
      expect(ActionValidator.canPayCost(room, 'player1', card, { tap: true })).toBe(true);
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

  describe('canTarget', () => {
    /** Place a creature on the battlefield under a given controller. */
    function putCreatureOnBattlefield(room: ReturnType<typeof createTestRoom>, controllerId: string, cardTypes: string[] = ['Creature']): TargetPointer {
      const card = room.players[controllerId].hand[0];
      card.state.zone = 'battlefield';
      card.state.controllerId = controllerId;
      card.blueprint.cardTypes = cardTypes;
      room.battlefield.push(card);
      return { targetType: 'permanent', cardUuid: card.uuid };
    }

    it('should accept a valid permanent target on the battlefield', () => {
      const room = createTestRoom();
      const target = putCreatureOnBattlefield(room, 'player1');
      const def: TargetingDefinition = { type: 'permanent', cardTypes: ['Creature'], required: true, minTargets: 1, maxTargets: 1 };
      expect(ActionValidator.canTarget(room, 'player1', room.players['player1'].hand[0], [target], def)).toBe(true);
    });

    it('should reject when required but no targets provided', () => {
      const room = createTestRoom();
      const def: TargetingDefinition = { type: 'permanent', cardTypes: ['Creature'], required: true, minTargets: 1, maxTargets: 1 };
      expect(ActionValidator.canTarget(room, 'player1', room.players['player1'].hand[0], [], def)).toBe(false);
    });

    it('should reject when fewer than minTargets provided', () => {
      const room = createTestRoom();
      const target = putCreatureOnBattlefield(room, 'player1');
      const def: TargetingDefinition = { type: 'permanent', cardTypes: ['Creature'], required: true, minTargets: 2, maxTargets: 2 };
      expect(ActionValidator.canTarget(room, 'player1', room.players['player1'].hand[0], [target], def)).toBe(false);
    });

    it('should reject when more than maxTargets provided', () => {
      const room = createTestRoom();
      const t1 = putCreatureOnBattlefield(room, 'player1');
      const t2 = putCreatureOnBattlefield(room, 'player1');
      const def: TargetingDefinition = { type: 'permanent', cardTypes: ['Creature'], required: true, minTargets: 1, maxTargets: 1 };
      expect(ActionValidator.canTarget(room, 'player1', room.players['player1'].hand[0], [t1, t2], def)).toBe(false);
    });

    it('should reject a target of the wrong type', () => {
      const room = createTestRoom();
      const def: TargetingDefinition = { type: 'permanent', cardTypes: ['Creature'], required: true, minTargets: 1, maxTargets: 1 };
      const playerTarget: TargetPointer = { targetType: 'player', playerId: 'player1' };
      expect(ActionValidator.canTarget(room, 'player1', room.players['player1'].hand[0], [playerTarget], def)).toBe(false);
    });

    it('should reject a permanent target not on the battlefield', () => {
      const room = createTestRoom();
      const card = room.players['player1'].hand[0];
      const def: TargetingDefinition = { type: 'permanent', cardTypes: ['Creature'], required: true, minTargets: 1, maxTargets: 1 };
      const target: TargetPointer = { targetType: 'permanent', cardUuid: card.uuid }; // still in hand
      expect(ActionValidator.canTarget(room, 'player1', room.players['player1'].hand[0], [target], def)).toBe(false);
    });

    it('should reject a permanent that does not match cardTypes filter', () => {
      const room = createTestRoom();
      const target = putCreatureOnBattlefield(room, 'player1', ['Artifact']);
      const def: TargetingDefinition = { type: 'permanent', cardTypes: ['Creature'], required: true, minTargets: 1, maxTargets: 1 };
      expect(ActionValidator.canTarget(room, 'player1', room.players['player1'].hand[0], [target], def)).toBe(false);
    });

    it('should accept a valid player target', () => {
      const room = createTestRoom();
      const def: TargetingDefinition = { type: 'player', required: true, minTargets: 1, maxTargets: 1 };
      const target: TargetPointer = { targetType: 'player', playerId: 'player2' };
      expect(ActionValidator.canTarget(room, 'player1', room.players['player1'].hand[0], [target], def)).toBe(true);
    });

    it('should reject a nonexistent player target', () => {
      const room = createTestRoom();
      const def: TargetingDefinition = { type: 'player', required: true, minTargets: 1, maxTargets: 1 };
      const target: TargetPointer = { targetType: 'player', playerId: 'nonexistent' };
      expect(ActionValidator.canTarget(room, 'player1', room.players['player1'].hand[0], [target], def)).toBe(false);
    });

    it('should accept no targets when not required', () => {
      const room = createTestRoom();
      const def: TargetingDefinition = { type: 'permanent', cardTypes: ['Creature'], required: false, minTargets: 0, maxTargets: 1 };
      expect(ActionValidator.canTarget(room, 'player1', room.players['player1'].hand[0], [], def)).toBe(true);
    });

    it('should be pure (not mutate the room)', () => {
      const room = createTestRoom();
      const target = putCreatureOnBattlefield(room, 'player1');
      const def: TargetingDefinition = { type: 'permanent', cardTypes: ['Creature'], required: true, minTargets: 1, maxTargets: 1 };
      const battlefieldBefore = room.battlefield.length;
      const handBefore = room.players['player1'].hand.length;
      ActionValidator.canTarget(room, 'player1', room.players['player1'].hand[0], [target], def);
      expect(room.battlefield.length).toBe(battlefieldBefore);
      expect(room.players['player1'].hand.length).toBe(handBefore);
    });
  });
});