import type { CardBlueprint, CardAbility, ActivatedAbility } from '../types/card.types';

/** Preserve the prototype's implicit plain-land ability as a removable ability. */
export function printedAbilities(blueprint: CardBlueprint): CardAbility[] {
  if (blueprint.abilities.length || !blueprint.cardTypes.includes('Land')) return structuredClone(blueprint.abilities);
  const fallback: ActivatedAbility = { id: 'produce-yellow', type: 'activated', castSpeed: 'instant', cost: { tap: true },
    effect: { action: 'ADD_MANA', params: { color: 'yellow', amount: 1 }, tags: [], targeting: { type: 'self', required: false } } };
  return [fallback];
}
