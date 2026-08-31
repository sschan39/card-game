// src/engine/stat-resolver.ts
// Pure helpers for computing a card's effective power/toughness.
//
// Effective stats are computed on demand, never stored. The modifier list is
// only scanned when a stat is actually read (attack, damage resolution, display).
//
// Layer ordering (MTG layer 7 subset):
//   1. SET_STATS (base overwrite)  — declared but no handler yet
//   2. STAT_DELTA (additive)       — applied here
//   3. Counters (+1/+1)            — always last
//
// Cross-layer ordering is fixed by effect type, not by timestamp. Same-layer
// competition (two SET_STATS effects) is not yet possible; if it ever is, an
// ordering field can be added then as a non-breaking change.

import type { CardInstance } from '../types/card.types';

function statDeltaSum(card: CardInstance, key: 'power' | 'toughness'): number {
  return card.state.modifiers
    .filter(m => m.effect.type === 'STAT_DELTA')
    .reduce((sum, m) => sum + (m.effect[key] ?? 0), 0);
}

export function getEffectivePower(card: CardInstance): number {
  const base = card.blueprint.power ?? 0;
  const fromModifiers = statDeltaSum(card, 'power');
  const fromCounters = card.state.counters['+1/+1'] ?? 0;
  return base + fromModifiers + fromCounters;
}

export function getEffectiveToughness(card: CardInstance): number {
  const base = card.blueprint.toughness ?? 0;
  const fromModifiers = statDeltaSum(card, 'toughness');
  const fromCounters = card.state.counters['+1/+1'] ?? 0;
  return base + fromModifiers + fromCounters;
}