// tests/engine/attack-handler.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { attackHandler } from '../../src/engine/handlers/attack-handler';
import { registerAction } from '../../src/engine/action-registry';
import { gameReducer } from '../../src/engine/game-reducer';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameMutation } from '../../src/types/game-mutation.types';
import type { GameRoom } from '../../src/types/game.room.types';

describe('attackHandler', () => {
  let room: GameRoom;

  /** Apply mutations through the pure reducer, committing to `room`. */
  function apply(mutations: GameMutation[]): void {
    for (const m of mutations) {
      room = gameReducer(room, m);
    }
  }

  beforeEach(() => {
    room = createTestRoom();
    registerAction('attack', attackHandler);
    // Set main phase for attack tests
    room.currentPhase = 'stateMainPhase';
    // Put a creature on the battlefield for player1
    const creature = instantiateCard('empire-servant');
    creature.state.zone = 'battlefield';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    creature.state.summoningSickness = false;
    room.battlefield.push(creature);
  });

  describe('validate', () => {
    it('should validate an untapped, non-sick creature in main phase', () => {
      const card = room.battlefield[0];
      const result = attackHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(result.success).toBe(true);
    });

    it('should reject attacks during combat steps', () => {
      room.currentPhase = 'beginCombatStep';
      const card = room.battlefield[0];
      const result = attackHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(result.success).toBe(false);
      expect(result.reason).toContain('main phase');
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

    it('should reject when not in main phase', () => {
      room.currentPhase = 'declareAttackersStep';
      const card = room.battlefield[0];
      const result = attackHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(result.success).toBe(false);
    });
  });

  describe('propose', () => {
    it('should tap creature, apply damage immediately, and produce a CombatDeclaration (no stack object)', () => {
      const card = room.battlefield[0];
      const initialLife = room.players['player2'].life;

      const result = attackHandler.propose(room, 'player1', { cardUuid: card.uuid, stackUuid: 'stack-uuid-1' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.mutations).toBeDefined();
        apply(result.mutations!);
      }

      // After applying mutations, creature should be tapped and marked as attacked
      const updated = room.battlefield.find(c => c.uuid === card.uuid)!;
      expect(updated.state.isTapped).toBe(true);
      expect(updated.state.attackedThisTurn).toBe(true);

      // Attack is a turn-based action — damage is applied immediately (SET_LIFE),
      // NOT deferred to stack resolution.
      expect(room.players['player2'].life).toBe(initialLife - (card.blueprint.power ?? 0));

      // No stack object — attack does not go on the stack
      if (result.success) {
        expect(result.stackObject).toBeUndefined();
        expect(result.combatDeclaration).toBeDefined();
        expect(result.combatDeclaration!.attacker.uuid).toBe(card.uuid);
        expect(result.combatDeclaration!.target.targetType).toBe('player');
        expect(result.combatDeclaration!.attackerPower).toBe(card.blueprint.power ?? 0);
      }
      expect(room.stack.length).toBe(0);

      // Mutations should include SET_LIFE (not MODIFY_LIFE) and ADD_COMBAT_DECLARATION
      const mutationTypes = result.success ? result.mutations!.map(m => m.type) : [];
      expect(mutationTypes).toContain('SET_LIFE');
      expect(mutationTypes).toContain('ADD_COMBAT_DECLARATION');
      expect(mutationTypes).not.toContain('PUSH_STACK');
    });

    it('should include attackingCard in propose result for ATTACK_DECLARED emission', () => {
      const card = room.battlefield[0];
      const result = attackHandler.propose(room, 'player1', { cardUuid: card.uuid, stackUuid: 'stack-uuid-1' });
      expect(result.success).toBe(true);
      if (result.success) {
        // The handler returns the attacking card so the engine can emit ATTACK_DECLARED
        expect(result.attackingCard).toBeDefined();
        expect(result.attackingCard!.uuid).toBe(card.uuid);
      }
    });
  });

  describe('creature-vs-creature combat', () => {
    it('should validate attack targeting an opponent creature', () => {
      // Put a defender creature on player2's battlefield
      const defender = instantiateCard('empire-servant');
      defender.state.zone = 'battlefield';
      defender.state.ownerId = 'player2';
      defender.state.controllerId = 'player2';
      defender.state.summoningSickness = false;
      room.battlefield.push(defender);

      const attacker = room.battlefield.find(c => c.state.controllerId === 'player1')!;
      const result = attackHandler.validate(room, 'player1', {
        cardUuid: attacker.uuid,
        targets: [{ targetType: 'permanent', cardUuid: defender.uuid }],
      });
      expect(result.success).toBe(true);
    });

    it('should reject attack targeting own creature', () => {
      // Put a second creature on player1's battlefield
      const ownCreature = instantiateCard('empire-servant');
      ownCreature.state.zone = 'battlefield';
      ownCreature.state.ownerId = 'player1';
      ownCreature.state.controllerId = 'player1';
      ownCreature.state.summoningSickness = false;
      room.battlefield.push(ownCreature);

      const attacker = room.battlefield.find(c => c.state.controllerId === 'player1' && c.uuid !== ownCreature.uuid)!;
      const result = attackHandler.validate(room, 'player1', {
        cardUuid: attacker.uuid,
        targets: [{ targetType: 'permanent', cardUuid: ownCreature.uuid }],
      });
      expect(result.success).toBe(false);
      expect(result.reason).toContain('own creature');
    });

    it('should reject attack targeting a non-existent creature', () => {
      const attacker = room.battlefield.find(c => c.state.controllerId === 'player1')!;
      const result = attackHandler.validate(room, 'player1', {
        cardUuid: attacker.uuid,
        targets: [{ targetType: 'permanent', cardUuid: 'nonexistent' }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject attack with already-attacked creature', () => {
      const defender = instantiateCard('empire-servant');
      defender.state.zone = 'battlefield';
      defender.state.ownerId = 'player2';
      defender.state.controllerId = 'player2';
      room.battlefield.push(defender);

      const attacker = room.battlefield.find(c => c.state.controllerId === 'player1')!;
      attacker.state.attackedThisTurn = true;
      const result = attackHandler.validate(room, 'player1', {
        cardUuid: attacker.uuid,
        targets: [{ targetType: 'permanent', cardUuid: defender.uuid }],
      });
      expect(result.success).toBe(false);
      expect(result.reason).toContain('already attacked');
    });
  });

  describe('propose — creature target', () => {
    it('should apply SET_DAMAGE to both attacker and defender and produce a CombatDeclaration', () => {
      const defender = instantiateCard('empire-servant');
      defender.state.zone = 'battlefield';
      defender.state.ownerId = 'player2';
      defender.state.controllerId = 'player2';
      defender.state.summoningSickness = false;
      room.battlefield.push(defender);

      const attacker = room.battlefield.find(c => c.state.controllerId === 'player1')!;
      const result = attackHandler.propose(room, 'player1', {
        cardUuid: attacker.uuid,
        stackUuid: 'stack-uuid-1',
        targets: [{ targetType: 'permanent', cardUuid: defender.uuid }],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.mutations).toBeDefined();
        apply(result.mutations!);
      }

      // Attacker should be tapped and marked as attacked
      const updatedAttacker = room.battlefield.find(c => c.uuid === attacker.uuid)!;
      expect(updatedAttacker.state.isTapped).toBe(true);
      expect(updatedAttacker.state.attackedThisTurn).toBe(true);

      // Damage applied immediately via SET_DAMAGE (accumulates on damageTaken)
      const updatedDefender = room.battlefield.find(c => c.uuid === defender.uuid)!;
      expect(updatedDefender.state.damageTaken).toBe(attacker.blueprint.power ?? 0);
      expect(updatedAttacker.state.damageTaken).toBe(defender.blueprint.power ?? 0);

      // No stack object — attack is a turn-based action
      if (result.success) {
        expect(result.stackObject).toBeUndefined();
        expect(result.combatDeclaration).toBeDefined();
        expect(result.combatDeclaration!.target.targetType).toBe('permanent');
        expect(result.combatDeclaration!.target.cardUuid).toBe(defender.uuid);
        expect(result.combatDeclaration!.attackerPower).toBe(attacker.blueprint.power ?? 0);
        expect(result.combatDeclaration!.defenderPower).toBe(defender.blueprint.power ?? 0);
      }
      expect(room.stack.length).toBe(0);

      // Mutations should include SET_DAMAGE (not MODIFY_STATS) and ADD_COMBAT_DECLARATION
      const mutationTypes = result.success ? result.mutations!.map(m => m.type) : [];
      expect(mutationTypes).toContain('SET_DAMAGE');
      expect(mutationTypes).toContain('ADD_COMBAT_DECLARATION');
      expect(mutationTypes).not.toContain('PUSH_STACK');
    });
  });
});