// src/engine/handlers/end-turn-handler.ts
import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { StackObject } from '../../types/effect.types';

/**
 * End the current turn.
 *
 * This handler has no propose/resolve — it's a direct action that produces
 * mutations via the state machine. The engine (server.ts) calls
 * engine.transition() and engine.switchTurn() after this handler returns.
 *
 * The "End Turn" button is phase-aware (see server.ts):
 * - From Main Phase it advances into the Battle Phase (stateBattlePhase) so the
 *   player can declare attackers.
 * - From Battle Phase (or later) it completes the turn: endCombat → endPhase →
 *   cleanupStep → turnStart, then switches the active turn player.
 *
 * Validation only blocks RPS, a non-empty stack, and non-turn players — both
 * the main-phase and battle-phase paths are legal.
 */
export const endTurnHandler: ActionHandler = {
  validate(room: GameRoom, playerId: PlayerId, _action: ActionData): ActionResult {
    if (room.currentPhase === 'RPS') {
      return { success: false, phase: 'validate', reason: 'Cannot end turn during Rock Paper Scissors phase!' };
    }
    // The stack is a zone, not a phase (MTG 116). Ending the turn while the
    // stack is open would abandon it. This blocks both a non-empty stack AND
    // the Stack phase itself (the stack can be empty but still open while
    // players hold priority). The turn can only end from a real phase.
    if (room.currentPhase === 'Stack') {
      return { success: false, phase: 'validate', reason: 'Cannot end turn while the stack is open!' };
    }
    // MTG 500.4a: the turn can only end by passing through the end step, which
    // requires an empty stack. Ending the turn while the stack is non-empty
    // would abandon the stack and leave it stuck.
    if (room.stack.length > 0) {
      return { success: false, phase: 'validate', reason: 'Cannot end turn while the stack is not empty!' };
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