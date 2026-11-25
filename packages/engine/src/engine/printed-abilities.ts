import type { CardBlueprint, CardAbility } from '../types/card.types';

/** Give rule evaluation its own copy of the card's declared abilities. */
export function printedAbilities(blueprint: CardBlueprint): CardAbility[] {
  return structuredClone(blueprint.abilities);
}
