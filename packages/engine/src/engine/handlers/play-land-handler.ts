import type { ActionData, ActionHandler, ActionResult } from '../action-registry';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import { CardCharacteristicService } from '../card-characteristic-service';
import { isMainPhase } from '../../shared/turn-utils';
import { landPlayLimit } from '../../config';

/** Shared by the command and its option preview; lands are special actions. */
export function validateLandPlay(room: GameRoom, playerId: PlayerId, data: ActionData): ActionResult {
  const reject = (reason: string): ActionResult => ({ success: false, phase: 'validate', reason });
  const card = room.players[playerId]?.hand.find(card => card.uuid === data.cardUuid);
  if (!card) return reject('Land not found in your hand');
  if (!CardCharacteristicService.resolveTypes(room, card).includes('Land')) return reject('Only a Land can be played this way');
  if (typeof data.zoneRevision !== 'number' || !Number.isSafeInteger(data.zoneRevision) || data.zoneRevision < 0 || data.zoneRevision !== (card.state.zoneRevision ?? 0)) return reject('The card has changed zones; select its current hand instance');
  if (room.status !== 'playing' || room.engineState !== 'waiting_for_player' || room.pendingChoice) return reject('Wait for the current action to finish');
  if (room.activeTurnPlayerId !== playerId) return reject('Play lands during your own turn');
  if (!isMainPhase(room.phase)) return reject('Play lands during a main phase');
  if (room.priorityPlayerId !== playerId) return reject('Wait until you have priority');
  if (room.stack.length) return reject('Play lands while the stack is empty');
  if ((room.turnHistory?.landPlays?.[playerId] ?? 0) >= landPlayLimit(room.setup)) return reject('No land plays remaining this turn');
  return { success: true };
}

export const playLandHandler: ActionHandler = {
  validate: validateLandPlay,
  propose(room, playerId, data) {
    const validation = validateLandPlay(room, playerId, data);
    if (!validation.success) return validation;
    const card = room.players[playerId].hand.find(card => card.uuid === data.cardUuid)!;
    // The proposal transaction retains both instructions while replacements
    // await a choice. A replaced entry still consumes the accepted land play.
    return { success: true, mutations: [
      { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: card.state.ownerId, controllerId: playerId,
        from: 'hand', to: 'battlefield', zoneRevision: card.state.zoneRevision ?? 0 },
      { type: 'RECORD_LAND_PLAY', playerId, turnNumber: room.turnNumber ?? 1 },
    ] };
  },
};
