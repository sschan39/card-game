// src/engine/handlers/counter-handler.ts
import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { StackObject } from '../../types/effect.types';

/**
 * Counter a spell (or activated ability) on the stack.
 *
 * Countering is a priority-gated engine action: the player who currently holds
 * priority may counter the top spell on the stack (or a specific stack object
 * by uuid). A countered stack object is marked `countered`, which:
 *   - causes `resolveStackObject` to skip all effects, and
 *   - sends the card to its owner's graveyard on resolution (structural rule).
 *
 * This closes the structural "countering" gap — the `countered` flag already
 * existed but no action set it.
 */
export const counterHandler: ActionHandler = {
  validate(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    if (room.currentPhase === 'gameOver') {
      return { success: false, phase: 'validate', reason: 'The game is already over.' };
    }
    if (room.priorityPlayerId !== playerId) {
      return { success: false, phase: 'validate', reason: 'You do not have priority to counter.' };
    }
    if (room.stack.length === 0) {
      return { success: false, phase: 'validate', reason: 'There is no spell on the stack to counter.' };
    }

    // Target a specific stack object by uuid, defaulting to the top of the stack.
    const targetUuid = typeof action.stackUuid === 'string' && action.stackUuid
      ? action.stackUuid
      : room.stack[room.stack.length - 1].uuid;
    const target = room.stack.find(so => so.uuid === targetUuid);
    if (!target) {
      return { success: false, phase: 'validate', reason: 'Targeted stack object not found.' };
    }
    if (target.countered) {
      return { success: false, phase: 'validate', reason: 'That spell is already countered.' };
    }
    return { success: true };
  },

  propose(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    const targetUuid = typeof action.stackUuid === 'string' && action.stackUuid
      ? action.stackUuid
      : room.stack[room.stack.length - 1]?.uuid;
    if (!targetUuid) {
      return { success: false, phase: 'propose', reason: 'No stack object to counter.' };
    }
    return {
      success: true,
      mutations: [{ type: 'SET_COUNTERED', stackUuid: targetUuid }],
    };
  },

  resolve(_room: GameRoom, _stackObj: StackObject): ActionResult {
    return { success: true };
  },
};