import { MANA_COLORS, type ActivatedAbility, type CardAbility, type CardInstance, type ManaColor } from '../types/card.types';
import type { GameRoom } from '../types/game.room.types';
import { CardCharacteristicService } from './card-characteristic-service';
import { printedAbilities } from './printed-abilities';

/** The current single-effect schema can express activated mana production. */
export function isManaAbility(ability: CardAbility): boolean {
  return ability.type === 'activated' && !!ability.effect && ability.effect.action === 'ADD_MANA' &&
    ability.effect.targeting.type === 'self' && !ability.effect.targeting.required &&
    !ability.effect.targeting.all && ability.cost.loyalty === undefined;
}

/** Every activated mana ability on a card, paired with its index in the ability list. */
export function manaAbilities(card: CardInstance, room?: GameRoom): { abilityIndex: number; ability: ActivatedAbility }[] {
  // Prefer live characteristics when a room is available, so continuous effects
  // that grant or remove abilities are respected.
  const abilities = room ? CardCharacteristicService.resolveAbilities(room, card) : printedAbilities(card.blueprint);

  const found = abilities.flatMap((ability, abilityIndex) => {
    if (ability.type === 'activated' && isManaAbility(ability)) return [{ abilityIndex, ability }];
    return [];
  });

  return found;
}

/** The colours and amount an ADD_MANA ability produces, or undefined if malformed. */
export function manaOutput(ability: ActivatedAbility): { colors: ManaColor[]; amount: number } | undefined {
  // Guard: only ADD_MANA abilities produce mana.
  if (!ability.effect) return;

  const params = ability.effect.params;
  const colors = params.colors ?? [params.color];
  const amount = params.amount ?? 1;

  // Guard: colours must be a non-empty list of known colours, and the amount a
  // positive safe integer.
  if (
    !Array.isArray(colors) ||
    !colors.length ||
    !colors.every((color) => MANA_COLORS.includes(color)) ||
    !Number.isSafeInteger(amount) ||
    (amount as number) <= 0
  ) {
    return;
  }

  // De-duplicate colours so a repeated entry does not inflate the output.
  return { colors: [...new Set(colors)] as ManaColor[], amount: amount as number };
}
