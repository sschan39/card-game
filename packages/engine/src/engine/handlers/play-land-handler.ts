import { actionPermission } from '../../shared/action-permissions';
import type { ActionData, ActionHandler, ActionResult } from '../action-registry';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import { CardCharacteristicService } from '../card-characteristic-service';
import { isMainPhase } from '../../shared/turn-utils';
import { landPlayLimit } from '../../config';

/** Shared by the command and its option preview; lands are special actions. */
export function validateLandPlay(room: GameRoom, playerId: PlayerId, data: ActionData): ActionResult {
  const reject = (reason: string): ActionResult => ({ success: false, phase: 'validate', reason });

  const card = room.players[playerId]?.hand.find((card) => card.uuid === data.cardUuid);

  // Guard: the card must be in the acting player's hand.
  if (!card) return reject('Land not found in your hand');

  // Guard: only lands can be played this way.
  if (!CardCharacteristicService.resolveTypes(room, card).includes('Land')) return reject('Only a Land can be played this way');

  if (!actionPermission(room, playerId, card, 'deploy').allowed) return reject('An effect prohibits playing this land');

  // Guard: the client must name the exact hand incarnation it saw.
  if (
    typeof data.zoneRevision !== 'number' ||
    !Number.isSafeInteger(data.zoneRevision) ||
    data.zoneRevision < 0 ||
    data.zoneRevision !== (card.state.zoneRevision ?? 0)
  ) {
    return reject('The card has changed zones; select its current hand instance');
  }

  // Guard: the engine must be idle and waiting for this player.
  if (room.status !== 'playing' || room.engineState !== 'waiting_for_player' || room.pendingChoice) {
    return reject('Wait for the current action to finish');
  }

  // Guard: turn, phase, priority, and stack must all allow a land play.
  if (room.activeTurnPlayerId !== playerId) return reject('Play lands during your own turn');
  if (!isMainPhase(room.phase)) return reject('Play lands during a main phase');
  if (room.priorityPlayerId !== playerId) return reject('Wait until you have priority');
  if (room.stack.length) return reject('Play lands while the stack is empty');

  // Guard: the per-turn land play allowance must not be exhausted.
  if ((room.turnHistory?.landPlays?.[playerId] ?? 0) >= landPlayLimit(room.setup)) {
    return reject('No land plays remaining this turn');
  }

  return { success: true };
}

export const playLandHandler: ActionHandler = {
  validate: validateLandPlay,

  propose(room, playerId, data) {
    // Re-validate: the room may have moved on since the preview.
    const validation = validateLandPlay(room, playerId, data);
    if (!validation.success) return validation;

    const card = room.players[playerId].hand.find((card) => card.uuid === data.cardUuid)!;

    // The proposal transaction retains both instructions while replacements
    // await a choice. A replaced entry still consumes the accepted land play.
    return {
      success: true,
      mutations: [
        {
          type: 'MOVE_CARD',
          cardUuid: card.uuid,
          playerId,
          controllerId: playerId,
          from: 'hand',
          to: 'battlefield',
          zoneRevision: card.state.zoneRevision ?? 0,
        },
        { type: 'RECORD_LAND_PLAY', playerId, turnNumber: room.turnNumber ?? 1 },
      ],
    };
  },
};
