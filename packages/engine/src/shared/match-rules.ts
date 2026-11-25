import type { MatchRules } from '../types/setup-config.types';

/** Gameplay defaults for snapshots written before these settings were stored. */
export const legacyMatchRules = Object.freeze({
  landPlaysPerTurn: 1,
  firstPlayerDrawsOnFirstTurn: true,
});

export function landPlayLimit(setup?: Pick<MatchRules, 'landPlaysPerTurn'>): number {
  return setup?.landPlaysPerTurn ?? legacyMatchRules.landPlaysPerTurn;
}
