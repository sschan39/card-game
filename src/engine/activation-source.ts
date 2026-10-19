import type { GameRoom, PlayerId } from '../types/game.room.types';
import { CardCharacteristicService } from './card-characteristic-service';

/** The two supported activation zones; each ability still declares its permission. */
export function findActivationSource(room: GameRoom, playerId: PlayerId, uuid: string | undefined) {
  if (!uuid) return;
  return room.battlefield.find(card => card.uuid === uuid && CardCharacteristicService.resolveController(room, card) === playerId)
    ?? room.players[playerId]?.hand.find(card => card.uuid === uuid);
}
