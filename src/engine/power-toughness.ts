// src/engine/power-toughness.ts
// Centralized resolution of a creature's *current* (effective) power and
// toughness. Blueprint P/T are the base; state.powerMod/toughnessMod are the
// net bonuses applied by effects. Every combat/lethality code path must read
// through these accessors so buffs/debuffs actually take effect.

import type { CardInstance } from '../types/card.types';

/** Current power = blueprint power + net mod (0 if no blueprint power). */
export function currentPower(card: CardInstance): number {
  return (card.blueprint.power ?? 0) + (card.state.powerMod ?? 0);
}

/** Current toughness = blueprint toughness + net mod (must be 0+ to survive). */
export function currentToughness(card: CardInstance): number {
  return (card.blueprint.toughness ?? 0) + (card.state.toughnessMod ?? 0);
}

/** True when a creature's current toughness is 0 or less (dies via SBA). */
export function isToughnessFatal(card: CardInstance): boolean {
  return currentToughness(card) <= 0;
}