import type { CardInstance } from '../types/card.types';
import type { GameRoom } from '../types/game.room.types';
import { CardCharacteristicService } from '../engine/card-characteristic-service';

/** Shared display-only numbering follows battlefield order, never game identity. */
export function battlefieldCardLabel(room: GameRoom, card: CardInstance): string {
  const live = room.battlefield.find(candidate => candidate.uuid === card.uuid &&
    (candidate.state.zoneRevision ?? 0) === (card.state.zoneRevision ?? 0));
  if (!live) return card.blueprint.name;
  const { name } = CardCharacteristicService.resolve(room, live);
  const peers = room.battlefield.filter(candidate => {
    const resolved = CardCharacteristicService.resolve(room, candidate);
    return resolved.name === name;
  });
  return peers.length > 1 ? `${name} #${peers.findIndex(candidate => candidate.uuid === live.uuid) + 1}` : name;
}
