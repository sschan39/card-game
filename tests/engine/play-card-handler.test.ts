import { describe, it, expect, beforeEach } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { ActionRegistry, registerAction } from '../../src/engine/action-registry';
import { EventBus } from '../../src/engine/event-bus';
import { GameEngine } from '../../src/engine/game-engine';
import { gameReducer } from '../../src/engine/game-reducer';
import type { GameMutation } from '../../src/types/game-mutation.types';
import type { GameRoom } from '../../src/types/game.room.types';

describe('playCardHandler', () => {
  let room: GameRoom;
  let eventBus: EventBus;

  /** Apply mutations through the pure reducer, committing to `room`. */
  function apply(mutations: GameMutation[]): void {
    for (const m of mutations) {
      room = gameReducer(room, m);
    }
  }

  beforeEach(() => {
    room = createTestRoom();
    eventBus = new EventBus(room.roomId);
    registerAction('cast_spell', playCardHandler);
    const card = room.players['player1'].hand[0];
    card.blueprint.castRequirements.cost = { mana: { red: 1 }, tap: false, life: 0, discard: 0, sacrifice: false };
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
      card.blueprint.onCastEffects = [
        { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self', required: false } },
      ];

      const initialHandSize = room.players['player1'].hand.length;
      const initialRedMana = room.players['player1'].mana.red;

      const result = playCardHandler.propose(room, 'player1', { cardUuid: card.uuid, stackUuid: 'stack-uuid-1' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.stackObject).toBeDefined();
        expect(result.stackObject!.type).toBe('spell');
        expect(result.stackObject!.controllerId).toBe('player1');
        expect(result.stackObject!.effects.length).toBe(1);
        expect(result.stackObject!.effects[0].action).toBe('DRAW');
        expect(result.mutations).toBeDefined();
        apply(result.mutations!);
      }

      expect(room.players['player1'].hand.length).toBe(initialHandSize - 1);
      expect(room.players['player1'].mana.red).toBe(initialRedMana - 1);
      expect(room.stack.length).toBe(1);
    });

    it('should create StackObject with empty effects when no onCastEffects', () => {
      const card = room.players['player1'].hand[0];
      // Reset onCastEffects from previous test's mutation
      card.blueprint.onCastEffects = undefined;
      const result = playCardHandler.propose(room, 'player1', { cardUuid: card.uuid, stackUuid: 'stack-uuid-2' });

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

    it('should move card from hand to stack (cost zone change) during propose', () => {
      const card = room.players['player1'].hand[0];
      expect(card.state.zone).toBe('hand');

      const result = playCardHandler.propose(room, 'player1', { cardUuid: card.uuid, stackUuid: 'stack-uuid-3' });
      expect(result.success).toBe(true);
      if (result.success) {
        apply(result.mutations!);
      }

      // Cost zone change: hand → stack (done by propose via MOVE_CARD mutation)
      // The card in room.stack[0].source should have zone 'stack'
      expect(room.stack.length).toBe(1);
      const stackCard = room.stack[0].source;
      expect(stackCard.state.zone).toBe('stack');
      // Card is NOT on battlefield yet — that's the structural zone change (done by orchestrator)
      expect(room.battlefield.find(c => c.uuid === card.uuid)).toBeUndefined();
    });

    it('should merge a single client target into an explicit-target effect', () => {
      const card = room.players['player1'].hand[0];
      card.blueprint.onCastEffects = [
        {
          action: 'MODIFY_STATS',
          params: { damage: 2 },
          tags: ['damage'],
          targeting: { type: 'permanent', cardTypes: ['Creature'], required: true, minTargets: 1, maxTargets: 1 },
        },
      ];

      const target = { targetType: 'permanent' as const, cardUuid: 'creature-uuid-1' };
      const result = playCardHandler.propose(room, 'player1', {
        cardUuid: card.uuid,
        stackUuid: 'stack-uuid-target-1',
        targets: [target],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.stackObject!.effects[0].targets).toEqual([target]);
      }
    });

    it('should slice client targets to maxTargets per effect', () => {
      const card = room.players['player1'].hand[0];
      card.blueprint.onCastEffects = [
        {
          action: 'MODIFY_STATS',
          params: { damage: 2 },
          tags: ['damage'],
          targeting: { type: 'permanent', cardTypes: ['Creature'], required: true, minTargets: 1, maxTargets: 1 },
        },
      ];

      const result = playCardHandler.propose(room, 'player1', {
        cardUuid: card.uuid,
        stackUuid: 'stack-uuid-target-2',
        targets: [
          { targetType: 'permanent' as const, cardUuid: 'creature-uuid-1' },
          { targetType: 'permanent' as const, cardUuid: 'creature-uuid-2' },
        ],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.stackObject!.effects[0].targets).toEqual([
          { targetType: 'permanent', cardUuid: 'creature-uuid-1' },
        ]);
      }
    });

    it('should leave self-target effects untouched when client targets are provided', () => {
      const card = room.players['player1'].hand[0];
      card.blueprint.onCastEffects = [
        { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self', required: false } },
      ];

      const result = playCardHandler.propose(room, 'player1', {
        cardUuid: card.uuid,
        stackUuid: 'stack-uuid-target-3',
        targets: [{ targetType: 'permanent' as const, cardUuid: 'creature-uuid-1' }],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.stackObject!.effects[0].targets).toEqual([{ targetType: 'player', playerId: 'player1' }]);
      }
    });
  });

  describe('resolve', () => {
    it('should resolve effects without performing structural zone change', () => {
      const card = room.players['player1'].hand[0];
      const proposeResult = playCardHandler.propose(room, 'player1', { cardUuid: card.uuid, stackUuid: 'stack-uuid-4' });
      expect(proposeResult.success).toBe(true);
      if (proposeResult.success) {
        apply(proposeResult.mutations!);
      }

      const stackObj = (proposeResult as { success: true; stackObject: any }).stackObject;

      // Handler resolve only resolves effects — zone change is orchestrator's job
      const resolveResult = playCardHandler.resolve(room, stackObj);
      expect(resolveResult.success).toBe(true);

      // Card should still be on stack (zone change not done by handler)
      expect(room.stack.length).toBe(1);
    });
  });

  describe('full flow: validate → propose → resolve', () => {
    it('should complete the full play-card lifecycle via GameEngine', () => {
      const card = room.players['player1'].hand[0];
      const cardName = card.blueprint.name;

      const validateResult = playCardHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(validateResult.success).toBe(true);

      const proposeResult = playCardHandler.propose(room, 'player1', { cardUuid: card.uuid, stackUuid: 'stack-uuid-5' });
      expect(proposeResult.success).toBe(true);
      if (proposeResult.success) {
        apply(proposeResult.mutations!);
      }
      expect(room.stack.length).toBe(1);

      // Use GameEngine for full resolution (zone change + effects + PERMANENT_ENTERED)
      const engine = new GameEngine(room);
      engine.initRoom();
      const resolveResult = engine.resolveTopOfStack();
      expect(resolveResult.success).toBe(true);

      const onBattlefield = engine.roomState.battlefield.find(c => c.blueprint.name === cardName);
      expect(onBattlefield).toBeDefined();
      expect(onBattlefield!.state.zone).toBe('battlefield');
    });
  });
});