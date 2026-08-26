// tests/engine/action-service.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ActionService } from '../../src/engine/action-service';
import { ActionRegistry, registerAction } from '../../src/engine/action-registry';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { EventBus } from '../../src/engine/event-bus';
import { gameReducer } from '../../src/engine/game-reducer';
import { createTestRoom } from '../helpers/test-room-factory';
import type { GameMutation } from '../../src/types/game-mutation.types';
import type { GameRoom } from '../../src/types/game.room.types';

describe('ActionService', () => {
  let service: ActionService;
  let room: GameRoom;
  let bus: EventBus;
  let collector: GameMutation[];

  /** Apply mutations through the pure reducer, committing to `room`. */
  function apply(mutations: GameMutation[]): void {
    for (const m of mutations) {
      room = gameReducer(room, m);
    }
  }

  beforeEach(() => {
    Object.keys(ActionRegistry).forEach(key => delete ActionRegistry[key]);
    registerAction('cast_spell', playCardHandler);

    bus = new EventBus('room-1');
    collector = [];
    service = new ActionService(bus, collector, () => 'stack-uuid-1');
    room = createTestRoom();
    const card = room.players['player1'].hand[0];
    card.blueprint.castRequirements.cost = { mana: { red: 1 } };
  });

  describe('handleAction', () => {
    it('should validate and propose a valid action', () => {
      const card = room.players['player1'].hand[0];
      const result = service.handleAction(room, 'player1', 'cast_spell', { cardUuid: card.uuid, stackUuid: 'stack-uuid-1' });

      expect(result.success).toBe(true);
    });

    it('should reject unknown action type', () => {
      const card = room.players['player1'].hand[0];
      const result = service.handleAction(room, 'player1', 'unknown', { cardUuid: card.uuid });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toContain('No handler registered');
      }
    });

    it('should reject when validation fails', () => {
      room.players['player1'].mana.red = 0;
      const card = room.players['player1'].hand[0];
      const result = service.handleAction(room, 'player1', 'cast_spell', { cardUuid: card.uuid });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.phase).toBe('validate');
      }
    });
  });

  describe('proposeAndStack', () => {
    it('should propose action and return PUSH_STACK mutation', () => {
      const card = room.players['player1'].hand[0];
      const result = service.proposeAndStack(room, 'player1', 'cast_spell', { cardUuid: card.uuid, stackUuid: 'stack-uuid-1' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.mutations).toBeDefined();
        apply(result.mutations!);
        expect(room.stack.length).toBe(1);
      }
    });

    it('should not push to stack if propose fails', () => {
      room.players['player1'].mana.red = 0;
      const card = room.players['player1'].hand[0];
      const result = service.proposeAndStack(room, 'player1', 'cast_spell', { cardUuid: card.uuid });

      expect(result.success).toBe(false);
      expect(room.stack.length).toBe(0);
    });
  });

  describe('resolveTopOfStack', () => {
    it('should resolve the top stack object', () => {
      const card = room.players['player1'].hand[0];
      const proposeResult = service.proposeAndStack(room, 'player1', 'cast_spell', { cardUuid: card.uuid, stackUuid: 'stack-uuid-1' });
      if (proposeResult.success) {
        apply(proposeResult.mutations!);
      }

      const result = service.resolveTopOfStack(room);
      expect(result.success).toBe(true);
      if (result.success) {
        apply(result.mutations!);
        expect(room.stack.length).toBe(0);
      }
    });

    it('should fail when stack is empty', () => {
      const result = service.resolveTopOfStack(room);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('Stack is empty');
      }
    });
  });
});