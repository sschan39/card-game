// src/engine/handlers/pass-priority-handler.ts
import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { StackObject } from '../../types/effect.types';

/**
 * Pass priority to the next player.
 *
 * This handler only validates; the actual priority transition is performed by
 * the engine via `engine.passPriority(playerId)`, which delegates to the state
 * machine and produces mutations.
 */
export const passPriorityHandler: ActionHandler = {
  validate(room: GameRoom, playerId: PlayerId, _action: ActionData): ActionResult {
    if (room.priorityPlayerId !== playerId) {
      return { success: false, phase: 'validate', reason: 'Not your priority!' };
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