import { MANA_COLORS, type ManaColor, type ManaCost, type ManaPayment } from '../types/card.types';
import type { ManaPool as Pool } from '../types/game.player.types';
import { validManaAmounts } from '../shared/mana-validation';
export { validManaAmounts } from '../shared/mana-validation';

/**
 * Reserve specific symbols first, then allocate generic from remaining mana.
 *
 * Returns `undefined` when the pool cannot cover the cost, or when the caller
 * supplied an explicit `requested` payment that is not a legal allocation.
 */
function proposePayment(pool: Pool, cost: ManaCost = {}, requested?: unknown): ManaPayment | undefined {
  // Guard: reject malformed costs or pools before doing any arithmetic.
  if (
    !validManaAmounts(cost, true) ||
    !validManaAmounts(pool) ||
    MANA_COLORS.some((color) => !Number.isSafeInteger(pool[color]) || pool[color] < 0)
  ) {
    return undefined;
  }

  const required = Object.values(cost).reduce((total, amount) => {
    return total + amount;
  }, 0);

  if (!Number.isSafeInteger(required)) {
    return undefined;
  }

  // Caller supplied an explicit allocation: validate it instead of proposing one.
  if (requested !== undefined) {
    if (!validManaAmounts(requested)) {
      return undefined;
    }

    const payment = requested as ManaPayment;

    if (
      Object.values(payment).reduce((total, amount) => {
        return total + amount;
      }, 0) !== required
    ) {
      return undefined;
    }

    // Each colour must be covered by the pool and must satisfy its specific cost.
    if (
      MANA_COLORS.some((color) => {
        return (payment[color] ?? 0) > pool[color] || (payment[color] ?? 0) < (cost[color] ?? 0);
      })
    ) {
      return undefined;
    }

    return { ...payment };
  }

  // Reserve the specific (coloured) part of the cost first.
  const payment: ManaPayment = {};

  for (const color of MANA_COLORS) {
    const specific = cost[color] ?? 0;

    if (specific > pool[color]) {
      return undefined;
    }

    if (specific) {
      payment[color] = specific;
    }
  }

  // Then cover the generic part from whatever mana is left, colour by colour.
  let remaining = cost.generic ?? 0;

  for (const color of MANA_COLORS) {
    const allocated = Math.min(remaining, pool[color] - (payment[color] ?? 0));

    if (allocated) {
      payment[color] = (payment[color] ?? 0) + allocated;
    }

    remaining -= allocated;
  }

  if (remaining === 0) {
    return payment;
  }

  return undefined;
}

export const ManaPool = {
  proposePayment,

  /** True when `pool` can pay `cost` in full. */
  canPay(pool: Pool, cost: ManaCost): boolean {
    return proposePayment(pool, cost) !== undefined;
  },

  add(pool: Pool, color: ManaColor, amount: number): void {
    pool[color] += amount;
  },

  /** Concrete allocation only; handlers validate before committing. */
  spend(pool: Pool, payment: ManaPayment): void {
    for (const color of MANA_COLORS) {
      pool[color] -= payment[color] ?? 0;
    }
  },

  /** Zero every colour and return the mana that was drained. */
  drain(pool: Pool): Pool {
    const drained = { ...pool };

    for (const color of MANA_COLORS) {
      pool[color] = 0;
    }

    return drained;
  },
};
