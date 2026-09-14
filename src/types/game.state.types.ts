/**
 * src/types/game.state.types.ts
 * Type-only definitions for the turn/state machine runtime.
 */

/**
 * The ordered sequence of turn phases. This is the single source of truth
 * for "what comes next" — TRANSITIONS is derived from it.
 */
export const TURN_SEQUENCE = [
  'stateTurnStart',
  'stateDrawPhase',
  'stateMainPhase',
  'beginCombatStep',
  'declareAttackersStep',
  'declareBlockersStep',
  'combatDamageStep',
  'endCombatStep',
  'stateEndPhase',
  'cleanupStep',
] as const;

/** A phase within a player's turn. */
export type Phase = typeof TURN_SEQUENCE[number];

/** High-level game status — orthogonal to turn phase. */
export type GameStatus = 'waiting' | 'RPS' | 'playing' | 'gameOver';

/**
 * @deprecated Use `Phase` for turn phases and `GameStatus` for game-level state.
 * Kept temporarily for incremental migration.
 */
export type GameStateName = Phase | 'waiting' | 'RPS' | 'Stack' | 'gameOver';

export type GameTransitionMap = Record<GameStateName, GameStateName[]>;

