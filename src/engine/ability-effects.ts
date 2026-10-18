import type { ActivatedAbility, TriggeredAbility } from '../types/card.types';
import type { EffectDefinition } from '../types/effect.types';

/** Adapt legacy single effects at the boundary; ordered triggers use one list. */
export function abilityEffects(ability: ActivatedAbility | TriggeredAbility): EffectDefinition[] {
  if (ability.type === 'triggered' && ability.effects) return ability.effects;
  return ability.effect ? [ability.effect] : [];
}
