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

      const result = attackHandler.propose(room, 'player1', { cardUuid: card.uuid, stackUuid: 'stack-uuid-1' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.mutations).toBeDefined();
        apply(result.mutations!);
      }

      // After applying mutations, creature should be tapped
      const updated = room.battlefield.find(c => c.uuid === card.uuid)!;
      expect(updated.state.isTapped).toBe(true);

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
});