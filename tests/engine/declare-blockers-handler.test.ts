// tests/engine/declare-blockers-handler.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { declareBlockersHandler } from '../../src/engine/handlers/declare-blockers-handler';
import { registerAction } from '../../src/engine/action-registry';
import { gameReducer } from '../../src/engine/game-reducer';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameMutation } from '../../src/types/game-mutation.types';
import type { GameRoom } from '../../src/types/game.room.types';
import type { CombatDeclaration } from '../../src/types/effect.types';

describe('declareBlockersHandler', () => {
  let room: GameRoom;

  function apply(mutations: GameMutation[]): void {
    for (const m of mutations) {
      room = gameReducer(room, m);
    }
  }

  beforeEach(() => {
    room = createTestRoom();
    registerAction('declare_blockers', declareBlockersHandler);
    room.currentPhase = 'declareBlockersStep';
    // player2 is the defending player (active turn is player1)
    room.activeTurnPlayerId = 'player1';

    // Attacker on player1's battlefield
    const attacker = instantiateCard('empire-servant');
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1';
    attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);

    // Blocker on player2's battlefield
    const blocker = instantiateCard('empire-servant');
    blocker.state.zone = 'battlefield';
    blocker.state.ownerId = 'player2';
    blocker.state.controllerId = 'player2';
    blocker.state.summoningSickness = false;
    room.battlefield.push(blocker);

    // Pre-populate combat with a declaration (simulating declareAttackersStep)
    const decl: CombatDeclaration = {
      uuid: attacker.uuid,
      attacker,
      attackerPower: attacker.blueprint.power ?? 0,
      blockers: [],
    };
    room.combat.push(decl);
  });

  describe('validate', () => {
    it('should validate a blocker assignment in declareBlockersStep', () => {
      const attacker = room.battlefield[0];
      const blocker = room.battlefield[1];
      const result = declareBlockersHandler.validate(room, 'player2', {
        assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }],
      });
      expect(result.success).toBe(true);
    });

    it('should reject when not in declareBlockersStep', () => {
      room.currentPhase = 'stateMainPhase';
      const attacker = room.battlefield[0];
      const blocker = room.battlefield[1];
      const result = declareBlockersHandler.validate(room, 'player2', {
        assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }],
      });
      expect(result.success).toBe(false);
      expect(result.reason).toContain('declare blockers step');
    });

    it('should reject when the active player tries to block', () => {
      const attacker = room.battlefield[0];
      const blocker = room.battlefield[1];
      const result = declareBlockersHandler.validate(room, 'player1', {
        assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }],
      });
      expect(result.success).toBe(false);
      expect(result.reason).toContain('defending player');
    });

    it('should reject a blocker not on the defending player battlefield', () => {
      const attacker = room.battlefield[0];
      const result = declareBlockersHandler.validate(room, 'player2', {
        assignments: [{ attackerUuid: attacker.uuid, blockerUuids: ['nonexistent'] }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject a tapped blocker', () => {
      const attacker = room.battlefield[0];
      const blocker = room.battlefield[1];
      blocker.state.isTapped = true;
      const result = declareBlockersHandler.validate(room, 'player2', {
        assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject a non-creature blocker', () => {
      const attacker = room.battlefield[0];
      const blocker = room.battlefield[1];
      // Save and restore to avoid mutating the shared blueprint cache
      const originalTypes = blocker.blueprint.cardTypes;
      blocker.blueprint.cardTypes = ['Land'];
      const result = declareBlockersHandler.validate(room, 'player2', {
        assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }],
      });
      blocker.blueprint.cardTypes = originalTypes;
      expect(result.success).toBe(false);
    });

    it('should reject a blocker assigned to a non-existent attacker', () => {
      const blocker = room.battlefield[1];
      const result = declareBlockersHandler.validate(room, 'player2', {
        assignments: [{ attackerUuid: 'nonexistent', blockerUuids: [blocker.uuid] }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject duplicate blocker across assignments', () => {
      // Add a second attacker and declaration
      const attacker2 = instantiateCard('empire-servant');
      attacker2.state.zone = 'battlefield';
      attacker2.state.ownerId = 'player1';
      attacker2.state.controllerId = 'player1';
      attacker2.state.summoningSickness = false;
      room.battlefield.push(attacker2);
      room.combat.push({
        uuid: attacker2.uuid,
        attacker: attacker2,
        attackerPower: attacker2.blueprint.power ?? 0,
        blockers: [],
      });

      const blocker = room.battlefield[1];
      const result = declareBlockersHandler.validate(room, 'player2', {
        assignments: [
          { attackerUuid: room.battlefield[0].uuid, blockerUuids: [blocker.uuid] },
          { attackerUuid: attacker2.uuid, blockerUuids: [blocker.uuid] },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.reason).toContain('already assigned');
    });

    it('should reject a non-flying blocker assigned to a flying attacker', () => {
      // Use a natively-Flying attacker (Crimson Hellkite) to avoid mutating shared blueprint
      const flyingAttacker = instantiateCard('card_09876_core_set');
      flyingAttacker.state.zone = 'battlefield';
      flyingAttacker.state.ownerId = 'player1';
      flyingAttacker.state.controllerId = 'player1';
      flyingAttacker.state.summoningSickness = false;
      room.battlefield.push(flyingAttacker);
      room.combat.push({
        uuid: flyingAttacker.uuid,
        attacker: flyingAttacker,
        attackerPower: flyingAttacker.blueprint.power ?? 0,
        blockers: [],
      });

      const blocker = room.battlefield[1]; // empire-servant, non-flying
      const result = declareBlockersHandler.validate(room, 'player2', {
        assignments: [{ attackerUuid: flyingAttacker.uuid, blockerUuids: [blocker.uuid] }],
      });
      expect(result.success).toBe(false);
      expect(result.reason).toContain('Flying');
    });

    it('should allow a flying blocker to block a flying attacker', () => {
      // Both attacker and blocker are natively-Flying (Crimson Hellkite)
      const flyingAttacker = instantiateCard('card_09876_core_set');
      flyingAttacker.state.zone = 'battlefield';
      flyingAttacker.state.ownerId = 'player1';
      flyingAttacker.state.controllerId = 'player1';
      flyingAttacker.state.summoningSickness = false;
      room.battlefield.push(flyingAttacker);
      room.combat.push({
        uuid: flyingAttacker.uuid,
        attacker: flyingAttacker,
        attackerPower: flyingAttacker.blueprint.power ?? 0,
        blockers: [],
      });

      const flyingBlocker = instantiateCard('card_09876_core_set');
      flyingBlocker.state.zone = 'battlefield';
      flyingBlocker.state.ownerId = 'player2';
      flyingBlocker.state.controllerId = 'player2';
      flyingBlocker.state.summoningSickness = false;
      room.battlefield.push(flyingBlocker);

      const result = declareBlockersHandler.validate(room, 'player2', {
        assignments: [{ attackerUuid: flyingAttacker.uuid, blockerUuids: [flyingBlocker.uuid] }],
      });
      expect(result.success).toBe(true);
    });

    it('should allow empty assignments (defender chooses no blockers)', () => {
      const result = declareBlockersHandler.validate(room, 'player2', {
        assignments: [],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('propose', () => {
    it('should produce ASSIGN_BLOCKERS mutation and populate blockers on CombatDeclaration', () => {
      const attacker = room.battlefield[0];
      const blocker = room.battlefield[1];
      const result = declareBlockersHandler.propose(room, 'player2', {
        assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.mutations).toBeDefined();
        apply(result.mutations!);
      }

      // Blocker should NOT be tapped (MTG CR 509.1f)
      const updatedBlocker = room.battlefield.find(c => c.uuid === blocker.uuid)!;
      expect(updatedBlocker.state.isTapped).toBe(false);

      // Combat declaration should have the blocker
      expect(room.combat[0].blockers.length).toBe(1);
      expect(room.combat[0].blockers[0].uuid).toBe(blocker.uuid);

      // ASSIGN_BLOCKERS mutation should be present
      const mutationTypes = result.success ? result.mutations!.map(m => m.type) : [];
      expect(mutationTypes).toContain('ASSIGN_BLOCKERS');

      // No stack object
      if (result.success) {
        expect(result.stackObject).toBeUndefined();
      }
    });

    it('should succeed with empty assignments (no blockers declared)', () => {
      const result = declareBlockersHandler.propose(room, 'player2', {
        assignments: [],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.mutations).toEqual([]);
        expect(result.stackObject).toBeUndefined();
      }
    });
  });
});