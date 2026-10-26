import { createHmac, randomBytes } from 'node:crypto';
import type { GameRoom } from '@card-game/engine/types/game.room.types';
import { CardCharacteristicService } from '@card-game/engine/engine/card-characteristic-service';

const key = randomBytes(32);
/** Granted ability identifiers embed server effect/source identities; keep those opaque. */
export function publicAbilityId(roomId: string, viewerId: string, id: string): string {
  return id.includes('@') ? 'ability:' + createHmac('sha256', key).update(JSON.stringify([roomId, viewerId, id])).digest('hex') : id;
}
export function decodeAbilityId(room: GameRoom, viewerId: string, data: Record<string, unknown>): Record<string, unknown> {
  if (typeof data.abilityId !== 'string' || !data.abilityId.startsWith('ability:')) return data;
  const card = [...room.battlefield, ...room.players[viewerId]?.hand ?? []].find(card => card.uuid === data.cardUuid);
  const ability = card && CardCharacteristicService.resolveAbilities(room, card).find(ability => typeof ability.id === 'string' && publicAbilityId(room.roomId, viewerId, ability.id) === data.abilityId);
  if (!ability) throw new Error('Invalid ability option');
  return { ...data, abilityId: ability.id };
}
