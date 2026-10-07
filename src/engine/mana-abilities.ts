import { MANA_COLORS, type ActivatedAbility, type CardAbility, type CardInstance, type ManaColor } from '../types/card.types';

/** The current single-effect schema can express activated mana production. */
export function isManaAbility(ability: CardAbility): boolean {
  return ability.type === 'activated' && ability.effect.action === 'ADD_MANA' &&
    ability.effect.targeting.type === 'self' && !ability.effect.targeting.required &&
    !ability.effect.targeting.all && ability.cost.loyalty === undefined;
}

export function manaAbilities(card: CardInstance): { abilityIndex: number; ability: ActivatedAbility }[] {
  const found = card.blueprint.abilities.flatMap((ability, abilityIndex) => ability.type === 'activated' && isManaAbility(ability) ? [{ abilityIndex, ability }] : []);
  // Preserve the prototype's plain-land fallback, without bypassing defined abilities.
  if (!card.blueprint.abilities.length && card.blueprint.cardTypes.includes('Land')) return [{ abilityIndex: 0, ability: {
    id: 'produce-colorless', type: 'activated', castSpeed: 'instant', cost: { tap: true },
    effect: { action: 'ADD_MANA', params: { color: 'colorless', amount: 1 }, tags: [], targeting: { type: 'self', required: false } },
  } }];
  return found;
}

export function manaOutput(ability: ActivatedAbility): { colors: ManaColor[]; amount: number } | undefined {
  const params = ability.effect.params;
  const colors = params.colors ?? [params.color];
  const amount = params.amount ?? 1;
  if (!Array.isArray(colors) || !colors.length || !colors.every(color => MANA_COLORS.includes(color)) ||
      !Number.isSafeInteger(amount) || (amount as number) <= 0) return;
  return { colors: [...new Set(colors)] as ManaColor[], amount: amount as number };
}
