import type { CardInstance } from '../types/card.types';
import type { TargetingDefinition } from '../types/effect.types';
import type { ActionId } from '../types/action.ids';
import type { TargetingState } from './store/gameStore';
import { describeTargetGroups } from '../shared/target-legality';

export function createTargetingState(card: CardInstance, zone: 'hand' | 'battlefield', actionId: ActionId, data?: Record<string, unknown>): TargetingState | null {
  const ability = data?.abilityId ? card.blueprint.abilities.find(a => a.id === data.abilityId) : undefined;
  const definitions = ability ? [ability.effect] : card.blueprint.onCastEffects ?? [];
  const groups = describeTargetGroups(definitions);
  return groups.length ? { cardUuid: card.uuid, zone, actionId, data, groups, groupIndex: 0, completedGroups: [], targeting: groups[0].targeting, collected: [] } : null;
}

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

/**
 * Does this attack action need a target choice?
 * Always returns true for attack — the player must choose between
 * attacking the opponent player or an opponent creature.
 * Returns a synthetic TargetingDefinition for the client targeting UI.
 *
 * `required: false` + `minTargets: 0` means the player may confirm with
 * zero targets, which the server interprets as "attack the face".
 */
export function needsAttackTarget(): TargetingDefinition {
  return {
    type: 'permanent',
    cardTypes: ['Creature'],
    required: false,  // optional — can also attack the player
    minTargets: 0,
    maxTargets: 1,
  };
}
