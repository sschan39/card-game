// src/engine/handlers/enter-battle-handler.ts
import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { StackObject } from '../../types/effect.types';

/**
 * Enter the combat phase from the main phase.
 *
 * Like endTurnHandler, this is a direct action with no propose/resolve — the
 * engine (server.ts) calls engine.advancePhase('complete') after validation.
 *
 * Validation blocks RPS, a non-empty stack, non-turn players, and any phase
 * other than the main phase.
 */
export const enterBattleHandler: ActionHandler = {
  validate(room: GameRoom, playerId: PlayerId, _action: ActionData): ActionResult {
    if (room.status === 'RPS') {
      return { success: false, phase: 'validate', reason: 'Cannot enter battle during Rock Paper Scissors phase!' };
    }
    if (room.stack.length > 0) {
      return { success: false, phase: 'validate', reason: 'Cannot enter battle while the stack is not empty!' };
    }
    if (room.activeTurnPlayerId !== playerId) {
      return { success: false, phase: 'validate', reason: 'Not your turn!' };
    }
    if (room.phase !== 'stateMainPhase') {
      return { success: false, phase: 'validate', reason: 'Can only enter battle from the main phase!' };
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
