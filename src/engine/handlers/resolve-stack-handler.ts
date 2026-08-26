// src/engine/handlers/resolve-stack-handler.ts
import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { StackObject } from '../../types/effect.types';

/**
 * Resolve the top object of the stack.
 *
 * This handler only validates that the stack is non-empty. The actual
 * resolution is performed by the engine via `engine.resolveTopOfStack()`,
 * which delegates to the action service and produces mutations.
 */
export const resolveStackHandler: ActionHandler = {
  validate(room: GameRoom, _playerId: PlayerId, _action: ActionData): ActionResult {
    if (room.stack.length === 0) {
      return { success: false, phase: 'validate', reason: 'Stack is empty!' };
    }
    return { success: true };
  },

  propose(_room: GameRoom, _playerId: PlayerId, _action: ActionData): ActionResult {
    return { success: true };
  },

  resolve(_room: GameRoom, _stackObj: StackObject): ActionResult {
    return { success: true };
  },
};