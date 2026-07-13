// src/engine/game-engine.ts
import { ActionRegistry, type ActionData, type ActionResult } from './action-registry';
import { EventBus } from './event-bus';
import { resolveStackObject } from './effect-resolver';
import { TriggerManager } from './trigger-manager';
import type { GameRoom, PlayerId } from '../types/game.room.types';

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
  private roomBus: EventBus | null = null;

  constructor() {
    this.eventBus = new EventBus('engine');
  }

  /**
   * Initialize per-room systems. Call once when a game starts.
   * Uses a single EventBus per room — TriggerManager and resolution
   * both use the same bus so all listeners receive all events.
   */
  initRoom(room: GameRoom): void {
    this.roomBus = new EventBus(room.roomId);
    new TriggerManager(this.roomBus, room);
  }

  private getRoomBus(room: GameRoom): EventBus {
    if (!this.roomBus) {
      this.roomBus = new EventBus(room.roomId);
    }
    return this.roomBus;
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
    const roomBus = this.getRoomBus(room);

    // Full resolution: zone change + effects + PERMANENT_ENTERED + STACK_RESOLVED
    resolveStackObject(room, stackObj, roomBus);

    return { success: true };
  }
}