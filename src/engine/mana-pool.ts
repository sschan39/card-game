import { MANA_COLORS, type ManaColor, type ManaCost, type ManaPayment } from '../types/card.types';
import type { ManaPool as Pool } from '../types/game.player.types';

export function validManaAmounts(value: unknown, generic = false): value is ManaCost {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, amount]) =>
    (MANA_COLORS.includes(key as ManaColor) || (generic && key === 'generic')) &&
    Number.isSafeInteger(amount) && (amount as number) >= 0);
}

/** Reserve specific symbols first, then allocate generic from remaining mana. */
function proposePayment(pool: Pool, cost: ManaCost = {}, requested?: unknown): ManaPayment | undefined {
  if (!validManaAmounts(cost, true) || !validManaAmounts(pool) || MANA_COLORS.some(color => !Number.isSafeInteger(pool[color]) || pool[color] < 0)) return;
  const required = Object.values(cost).reduce((total, amount) => total + (amount ?? 0), 0);
  if (!Number.isSafeInteger(required)) return;
  if (requested !== undefined) {
    if (!validManaAmounts(requested)) return;
    const payment = requested as ManaPayment;
    if (Object.values(payment).reduce((total, amount) => total + (amount ?? 0), 0) !== required) return;
    if (MANA_COLORS.some(color => (payment[color] ?? 0) > pool[color] || (payment[color] ?? 0) < (cost[color] ?? 0))) return;
    return { ...payment };
  }
  const payment: ManaPayment = {};
  for (const color of MANA_COLORS) {
    const specific = cost[color] ?? 0;
    if (specific > pool[color]) return;
    if (specific) payment[color] = specific;
  }
  let remaining = cost.generic ?? 0;
  for (const color of MANA_COLORS) {
    const allocated = Math.min(remaining, pool[color] - (payment[color] ?? 0));
    if (allocated) payment[color] = (payment[color] ?? 0) + allocated;
    remaining -= allocated;
  }
  return remaining === 0 ? payment : undefined;
}

export const ManaPool = {
  proposePayment,
  canPay(pool: Pool, cost: ManaCost): boolean { return proposePayment(pool, cost) !== undefined; },
  add(pool: Pool, color: ManaColor, amount: number): void { pool[color] += amount; },
  /** Concrete allocation only; handlers validate before committing. */
  spend(pool: Pool, payment: ManaPayment): void {
    for (const color of MANA_COLORS) pool[color] -= payment[color] ?? 0;
  },
  drain(pool: Pool): Pool {
    const drained = { ...pool };
    for (const color of MANA_COLORS) pool[color] = 0;
    return drained;
  },
};
