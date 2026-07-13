// src/engine/action-service.ts
import { ActionRegistry, type ActionData, type ActionResult } from './action-registry';
import { EventBus } from './event-bus';
import { StateMachine } from './state-machine';
import { resolveStackObject } from './effect-resolver';
import { TriggerManager } from './trigger-manager';
import type { GameRoom, PlayerId } from '../types/game.room.types';

/**
 * ActionService — single orchestrator for game actions.
 *
 * Responsibilities:
 * - Route client actions to the ActionRegistry (validate → propose)
 * - Manage stack resolution (structural zone change + effect resolution + triggers)
 * - Wire per-room TriggerManager for ETB/triggered abilities
 * - Emit events via EventBus
 *
 * This is THE orchestrator used by server.ts. GameEngine exists for
 * backward-compatible testing but delegates to the same patterns.
 */
export class ActionService {
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Initialize per-room systems. Call once when a room is created.
   * Wires TriggerManager to the room's EventBus so ETB triggers fire.
   */
  initRoom(room: GameRoom): void {
    new TriggerManager(this.eventBus, room);
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

  proposeAndStack(
    room: GameRoom,
    playerId: PlayerId,
    actionType: string,
    actionData: ActionData,
    stateMachine: StateMachine
  ): ActionResult {
    const result = this.handleAction(room, playerId, actionType, actionData);
    if (!result.success) return result;

    // The handler's propose() already pushed to room.stack.
    // Sync the StateMachine's stack and emit STACK_UPDATED.
    if (result.stackObject) {
      stateMachine.addToStack(result.stackObject);
    }

    return result;
  }

  resolveTopOfStack(room: GameRoom, stateMachine?: StateMachine): ActionResult {
    if (room.stack.length === 0) {
      return { success: false, phase: 'resolve', reason: 'Stack is empty' };
    }

    const stackObj = room.stack.pop()!;

    // Sync StateMachine stack if provided
    if (stateMachine && stateMachine.stack.length > 0) {
      stateMachine.stack.pop();
    }

    // Full resolution: zone change + effects + PERMANENT_ENTERED + STACK_RESOLVED
    resolveStackObject(room, stackObj, this.eventBus);

    return { success: true };
  }
}