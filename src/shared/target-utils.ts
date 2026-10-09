import type { CardInstance } from '../types/card.types';
import type { TargetingDefinition } from '../types/effect.types';
import type { GameRoom } from '../types/game.room.types';
import { CardCharacteristicService } from '../engine/card-characteristic-service';

/**
 * Pure function: does a battlefield card match a TargetingDefinition's
 * structural filters (cardTypes, subTypes, controller)?
 *
 * Shared by the server (ActionValidator.isTargetLegal) and the client
 * (TargetSelector) so filter rules stay in sync.
 *
 * @param card - The card on the battlefield to check.
 * @param def - The targeting definition with optional filter fields.
 * @param playerId - The ID of the player choosing targets (for controller filter).
 * @returns `true` if the card passes all applicable filters.
 */
export function matchesTargetFilter(
  card: CardInstance,
  def: TargetingDefinition,
  playerId: string,
  room?: GameRoom,
): boolean {
  const value = room ? CardCharacteristicService.resolve(room, card) : { ...card.blueprint, controllerId: card.state.controllerId };
  // cardTypes filter
  if (def.cardTypes && def.cardTypes.length > 0) {
    if (!def.cardTypes.some((t) => value.cardTypes.includes(t))) return false;
  }
  // subTypes filter
  if (def.subTypes && def.subTypes.length > 0) {
    if (!def.subTypes.some((s) => (value.subTypes || []).includes(s))) return false;
  }
  // controller filter
  if (def.controller === 'self' && value.controllerId !== playerId) return false;
  if (def.controller === 'opponent' && value.controllerId === playerId) return false;
  return true;
}
