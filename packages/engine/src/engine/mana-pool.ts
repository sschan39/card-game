import { MANA_COLORS, type ManaColor, type ManaCost, type ManaPayment } from '../types/card.types';
import type { ManaSubstitution } from '../types/continuous-effect.types';
import type { ManaPool as Pool } from '../types/game.player.types';
import { validManaAmounts } from '../shared/mana-validation';
export { validManaAmounts } from '../shared/mana-validation';

/**
 * Reserve specific symbols first, then allocate generic from remaining mana.
 *
 * Returns `undefined` when the pool cannot cover the cost, or when the caller
 * supplied an explicit `requested` payment that is not a legal allocation.
 */
function proposePayment(pool: Pool, cost: ManaCost = {}, requested?: unknown,
  substitution?: ManaSubstitution): ManaPayment | undefined {
  // Guard: reject malformed costs or pools before doing any arithmetic.
  if (
    !validManaAmounts(cost, true) ||
    !validManaAmounts(pool) ||
    MANA_COLORS.some((color) => !Number.isSafeInteger(pool[color]) || pool[color] < 0)
  ) {
    return undefined;
  }

  const required = Object.values(cost).reduce((total, amount) => {
    return total + (amount ?? 0);
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
        return total + (amount ?? 0);
      }, 0) !== required
    ) {
      return undefined;
    }

    if (MANA_COLORS.some(color => (payment[color] ?? 0) > pool[color])) return undefined;
    if (reserveSpecific(payment, cost, substitution) === undefined) return undefined;

    return { ...payment };
  }

  const payment = reserveSpecific(pool, cost, substitution);
  if (!payment) return undefined;

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

function reserveSpecific(
  available: ManaPayment, cost: ManaCost, substitution?: ManaSubstitution,
): ManaPayment | undefined {
  const reserved: ManaPayment = {};
  let shortage = 0;
  for (const color of MANA_COLORS) {
    const required = cost[color] ?? 0;
    const paid = Math.min(required, available[color] ?? 0);
    if (paid) reserved[color] = paid;
    if (paid === required) continue;
    if (!substitution || color === substitution.from || !substitution.colors.includes(color)) return;
    shortage += required - paid;
  }

  if (substitution && shortage) {
    const source = substitution.from;
    const total = (reserved[source] ?? 0) + shortage;
    if (total > (available[source] ?? 0)) return;
    reserved[source] = total;
  }
  return reserved;
}

export const ManaPool = {
  proposePayment,

  /** True when `pool` can pay `cost` in full. */
  canPay(pool: Pool, cost: ManaCost, substitution?: ManaSubstitution): boolean {
    return proposePayment(pool, cost, undefined, substitution) !== undefined;
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
