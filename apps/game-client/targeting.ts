import type { CardInstance } from '../types/card.types';
import type { TargetingDefinition } from '../types/effect.types';
import type { ActionId } from '../types/action.ids';
import type { TargetingState } from './store/gameStore';
import { describeTargetGroups } from '../shared/target-legality';
import type { GameRoom } from '../types/game.room.types';
import { CardCharacteristicService } from '../engine/card-characteristic-service';
import { selectModeEffects } from '../shared/action-modes';
import { abilityEffects } from '../engine/ability-effects';

export function createTargetingState(card: CardInstance, zone: 'hand' | 'battlefield', actionId: ActionId, data?: Record<string, unknown>, room?: GameRoom): TargetingState | null {
  const blueprint = room ? CardCharacteristicService.resolveBlueprint(room, card) : card.blueprint;
  const ability = data?.abilityId ? blueprint.abilities.find(a => a.id === data.abilityId) : undefined;
  if ((ability?.type === 'activated' ? ability.numericDeclarations : blueprint.numericDeclarations)?.length) return null;
  if ((ability?.type === 'activated' ? ability.alternativeCosts : blueprint.castRequirements.alternativeCosts)?.length) return null;
  const modes = ability?.type === 'activated' ? ability.modes : blueprint.modes;
  if (modes?.length && data?.modes === undefined) return null;
  const definitions = selectModeEffects(ability?.type === 'activated' ? abilityEffects(ability) : blueprint.onCastEffects ?? [], modes, data?.modes,
    ability?.type === 'activated' ? ability.modeCount : blueprint.modeCount);
  if (!definitions) return null;
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
export function needsTargets(card: CardInstance, room?: GameRoom): TargetingDefinition | null {
  const def = (room ? CardCharacteristicService.resolve(room, card).onCastEffects : card.blueprint.onCastEffects)?.find(
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
