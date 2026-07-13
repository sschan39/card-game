// src/engine/action-service.ts
import { ActionRegistry, type ActionData, type ActionResult } from './action-registry';
import { EventBus } from './event-bus';
import { StateMachine } from './state-machine';
import type { GameRoom, PlayerId } from '../types/game.room.types';

export class ActionService {
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
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

    const handler = ActionRegistry['cast_spell'];
    if (!handler) {
      return { success: false, phase: 'resolve', reason: 'No handler for stack resolution' };
    }

    const result = handler.resolve(room, stackObj);

    this.eventBus.emit({
      eventId: 'STACK_RESOLVED',
      roomId: room.roomId,
      payload: { effectId: stackObj.effects[0]?.action || 'structural' },
    });

    return result;
  }
}