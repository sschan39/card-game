// src/engine/game-engine.ts
import { ActionRegistry, type ActionData, type ActionResult } from './action-registry';
import { EventBus } from './event-bus';
import { resolveEffects } from './effect-resolver';
import { TriggerManager } from './trigger-manager';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';
import type { StackObject } from '../types/effect.types';

function isPermanent(card: CardInstance): boolean {
  return card.cardTypes.some(type =>
    ['Creature', 'Artifact', 'Enchantment', 'Land'].includes(type)
  );
}

/**
 * GameEngine — thin orchestrator for game actions.
 *
 * Responsibilities:
 * - Route client actions to the ActionRegistry
 * - Manage stack resolution (structural zone change + effect resolution + triggers)
 * - Emit events via EventBus
 *
 * Does NOT contain game rules — those live in ActionValidator, EffectRegistry, and handlers.
 */
export class GameEngine {
  private eventBus: EventBus;

  constructor() {
    this.eventBus = new EventBus('engine');
  }

  /**
   * Initialize per-room systems. Call once when a game starts.
   */
  initRoom(room: GameRoom): void {
    const roomBus = new EventBus(room.roomId);
    new TriggerManager(roomBus, room);
    (this as any)._roomBus = roomBus;
  }

  private getRoomBus(room: GameRoom): EventBus {
    return (this as any)._roomBus || new EventBus(room.roomId);
  }

  handleAction(
    room: GameRoom,
    playerId: PlayerId,
    actionType: string,
    actionData: ActionData
  ): ActionResult {
    const handler = ActionRegistry[actionType];
    if (!handler) {
      return { success: false, phase: 'validate', reason: `No handler registered for action: ${actionType}` };
    }

    const validateResult = handler.validate(room, playerId, actionData);
    if (!validateResult.success) return validateResult;

    const proposeResult = handler.propose(room, playerId, actionData);
    if (!proposeResult.success) return proposeResult;

    this.eventBus.emit({
      eventId: 'ACTION_PROPOSED',
      roomId: room.roomId,
      payload: { actionType, playerId, cardUuid: actionData.cardUuid },
    });

    return proposeResult;
  }

  resolveTopOfStack(room: GameRoom): ActionResult {
    if (room.stack.length === 0) {
      return { success: false, phase: 'resolve', reason: 'Stack is empty' };
    }

    const stackObj = room.stack.pop()!;
    const card = stackObj.source as CardInstance;
    const roomBus = this.getRoomBus(room);

    // Structural zone change (game rule, not an effect)
    if (stackObj.countered) {
      card.state.zone = 'graveyard';
      const ownerId = card.state.controllerId || card.state.ownerId;
      room.players[ownerId]?.graveyard.push(card);
    } else if (isPermanent(card)) {
      card.state.zone = 'battlefield';
      card.state.isTapped = false;
      if (card.cardTypes.includes('Creature')) {
        card.state.summoningSickness = true;
      }
      room.battlefield.push(card);
    } else {
      card.state.zone = 'graveyard';
      const ownerId = card.state.controllerId || card.state.ownerId;
      room.players[ownerId]?.graveyard.push(card);
    }

    // Resolve effects
    resolveEffects(room, stackObj, roomBus);

    // Emit PERMANENT_ENTERED for permanents (triggers ETB)
    if (!stackObj.countered && isPermanent(card)) {
      roomBus.emit({
        eventId: 'PERMANENT_ENTERED',
        roomId: room.roomId,
        payload: { card, controllerId: stackObj.controllerId },
      });
    }

    this.eventBus.emit({
      eventId: 'STACK_RESOLVED',
      roomId: room.roomId,
      payload: { effectId: stackObj.effects[0]?.action || 'structural' },
    });

    return { success: true };
  }
}