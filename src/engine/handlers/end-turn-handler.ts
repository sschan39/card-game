// src/engine/handlers/end-turn-handler.ts
import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { StackObject } from '../../types/effect.types';

/**
 * End the current turn: transition through endPhase → cleanupStep → turnStart,
 * then switch the active turn player.
 *
 * This handler has no propose/resolve — it's a direct action that produces
 * mutations via the state machine. The engine (server.ts) calls
 * engine.transition() and engine.switchTurn() after this handler returns.
 */
export const endTurnHandler: ActionHandler = {
  validate(room: GameRoom, playerId: PlayerId, _action: ActionData): ActionResult {
    if (room.currentPhase === 'RPS') {
      return { success: false, phase: 'validate', reason: 'Cannot end turn during Rock Paper Scissors phase!' };
    }
    if (room.currentPhase === 'gameOver') {
      return { success: false, phase: 'validate', reason: 'The game is already over!' };
    }
    if (room.activeTurnPlayerId !== playerId) {
      return { success: false, phase: 'validate', reason: 'Not your turn!' };
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