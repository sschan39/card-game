// src/engine/mana-pool.ts
//
// Centralized mana pool operations. All mana mutations go through this module.
// The pool itself remains a plain Record<ManaColor, number> on PlayerState —
// this module just provides the functions so arithmetic isn't scattered.

import type { ManaColor, ManaCost } from '../types/card.types';
import type { ManaPool as ManaPoolType } from '../types/game.player.types';

export const ManaPool = {
  /** Check if a pool can cover a cost. */
  canPay(pool: ManaPoolType, cost: ManaCost): boolean {
    for (const [color, amount] of Object.entries(cost)) {
      if ((pool[color as ManaColor] ?? 0) < amount!) return false;
    }
    return true;
  },

  /** Add mana to a pool. Mutates in place. */
  add(pool: ManaPoolType, color: ManaColor, amount: number): void {
    pool[color] = (pool[color] ?? 0) + amount;
  },

  /** Deduct a cost from a pool. Caller must verify with canPay first. Mutates in place. */
  spend(pool: ManaPoolType, cost: ManaCost): void {
    for (const [color, amount] of Object.entries(cost)) {
      pool[color as ManaColor] -= amount!;
    }
  },

  /** Zero out the pool and return what was drained (for mana-burn / triggers). */
  drain(pool: ManaPoolType): ManaPoolType {
    const drained = { ...pool };
    for (const color of Object.keys(pool) as ManaColor[]) {
      pool[color] = 0;
    }
    return drained;
  },

  /** Returns true if an effect ID is a pure mana ability (eligible for atomic execution). */
  isPureAbility(effectId: string): boolean {
    return effectId === 'ADD_MANA';
  },
};