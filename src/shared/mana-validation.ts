import { MANA_COLORS, type ManaColor, type ManaCost } from '../types/card.types';

export function validManaAmounts(value: unknown, generic = false): value is ManaCost {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, amount]) =>
    (MANA_COLORS.includes(key as ManaColor) || (generic && key === 'generic')) &&
    Number.isSafeInteger(amount) && (amount as number) >= 0);
}
