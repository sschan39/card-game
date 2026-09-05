import type { CardInstance } from '../types/card.types';
import type { TargetingDefinition } from '../types/effect.types';

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
): boolean {
  // cardTypes filter
  if (def.cardTypes && def.cardTypes.length > 0) {
    if (!def.cardTypes.some((t) => card.blueprint.cardTypes.includes(t))) return false;
  }
  // subTypes filter
  if (def.subTypes && def.subTypes.length > 0) {
    if (!def.subTypes.some((s) => (card.blueprint.subTypes || []).includes(s))) return false;
  }
  // controller filter
  if (def.controller === 'self' && card.state.controllerId !== playerId) return false;
  if (def.controller === 'opponent' && card.state.controllerId === playerId) return false;
  return true;
}