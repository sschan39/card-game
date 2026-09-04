import type { CardInstance } from '../types/card.types';
import type { TargetingDefinition } from '../types/effect.types';

/**
 * Does this card need explicit targets before casting?
 * Returns the TargetingDefinition if the card has an onCastEffect with
 * explicit targets (type !== 'self' && !all), else null.
 *
 * The TargetingDefinition is static card data, and the client's room snapshot
 * is the server-authoritative copy — no round-trip needed.
 */
export function needsTargets(card: CardInstance): TargetingDefinition | null {
  const def = card.blueprint.onCastEffects?.find(
    (e) => e.targeting.type !== 'self' && !e.targeting.all
  )?.targeting;
  return def ?? null;
}