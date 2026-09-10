// tests/engine/declare-attackers-handler.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { declareAttackersHandler } from '../../src/engine/handlers/declare-attackers-handler';
import { registerAction } from '../../src/engine/action-registry';
import { gameReducer } from '../../src/engine/game-reducer';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameMutation } from '../../src/types/game-mutation.types';
import type { GameRoom } from '../../src/types/game.room.types';

describe('declareAttackersHandler', () => {
  let room: GameRoom;

  function apply(mutations: GameMutation[]): void {
    for (const m of mutations) {
      room = gameReducer(room, m);
    }
  }

  beforeEach(() => {
    room = createTestRoom();
    registerAction('declare_attackers', declareAttackersHandler);
    room.currentPhase = 'declareAttackersStep';
    // Put two creatures on the battlefield for player1
    const c1 = instantiateCard('empire-servant');
    c1.state.zone = 'battlefield';
    c1.state.ownerId = 'player1';
    c1.state.controllerId = 'player1';
    c1.state.summoningSickness = false;
    room.battlefield.push(c1);

    const c2 = instantiateCard('empire-servant');
    c2.state.zone = 'battlefield';
    c2.state.ownerId = 'player1';
    c2.state.controllerId = 'player1';
    c2.state.summoningSickness = false;
    room.battlefield.push(c2);
  });

  describe('validate', () => {
    it('should validate a batch of untapped, non-sick creatures in declareAttackersStep', () => {
      const attackers = room.battlefield.filter(c => c.state.controllerId === 'player1');
      const result = declareAttackersHandler.validate(room, 'player1', {
        attackers: attackers.map(c => ({ cardUuid: c.uuid })),
      });
      expect(result.success).toBe(true);
    });

    it('should reject when not in declareAttackersStep', () => {
      room.currentPhase = 'stateMainPhase';
      const card = room.battlefield[0];
      const result = declareAttackersHandler.validate(room, 'player1', {
        attackers: [{ cardUuid: card.uuid }],
      });
      expect(result.success).toBe(false);
      expect(result.reason).toContain('declare attackers step');
    });

    it('should reject when not the active player', () => {
      room.activeTurnPlayerId = 'player2';
      const card = room.battlefield[0];
      const result = declareAttackersHandler.validate(room, 'player1', {
        attackers: [{ cardUuid: card.uuid }],
      });
      expect(result.success).toBe(false);
      expect(result.reason).toContain('turn');
    });

    it('should reject empty attackers array', () => {
      const result = declareAttackersHandler.validate(room, 'player1', {
        attackers: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject a tapped creature', () => {
      const card = room.battlefield[0];
      card.state.isTapped = true;
      const result = declareAttackersHandler.validate(room, 'player1', {
        attackers: [{ cardUuid: card.uuid }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject a summoning sick creature', () => {
      const card = room.battlefield[0];
      card.state.summoningSickness = true;
      const result = declareAttackersHandler.validate(room, 'player1', {
        attackers: [{ cardUuid: card.uuid }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject a creature that already attacked this turn', () => {
      const card = room.battlefield[0];
      card.state.attackedThisTurn = true;
      const result = declareAttackersHandler.validate(room, 'player1', {
        attackers: [{ cardUuid: card.uuid }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject duplicate cardUuids', () => {
      const card = room.battlefield[0];
      const result = declareAttackersHandler.validate(room, 'player1', {
        attackers: [{ cardUuid: card.uuid }, { cardUuid: card.uuid }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject a non-creature', () => {
      const card = room.battlefield[0];
      card.blueprint.cardTypes = ['Land'];
      const result = declareAttackersHandler.validate(room, 'player1', {
        attackers: [{ cardUuid: card.uuid }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('propose', () => {
    it('should tap all attackers, mark them as attacked, and produce DECLARE_ATTACKERS mutation', () => {
      const attackers = room.battlefield.filter(c => c.state.controllerId === 'player1');
      const result = declareAttackersHandler.propose(room, 'player1', {
        attackers: attackers.map(c => ({ cardUuid: c.uuid })),
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.mutations).toBeDefined();
        apply(result.mutations!);
      }

      // All attackers should be tapped and marked
      for (const c of attackers) {
        const updated = room.battlefield.find(bc => bc.uuid === c.uuid)!;
        expect(updated.state.isTapped).toBe(true);
        expect(updated.state.attackedThisTurn).toBe(true);
      }

      // DECLARE_ATTACKERS mutation should be present
      const mutationTypes = result.success ? result.mutations!.map(m => m.type) : [];
      expect(mutationTypes).toContain('DECLARE_ATTACKERS');

      // Combat declarations should have empty blockers
      expect(room.combat.length).toBe(2);
      for (const decl of room.combat) {
        expect(decl.blockers).toEqual([]);
        expect(decl.attackerPower).toBe(decl.attacker.blueprint.power ?? 0);
      }

      // No stack object — turn-based action
      if (result.success) {
        expect(result.stackObject).toBeUndefined();
      }
    });
  });
});