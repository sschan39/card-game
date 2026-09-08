/**
 * src/types/game.state.types.ts
 * Type-only definitions for the turn/state machine runtime.
 */

export type GameStateName =
    | 'waiting'
    | 'RPS'
    | 'stateTurnStart'
    | 'stateDrawPhase'
    | 'stateMainPhase'
    | 'beginCombatStep'
    | 'declareAttackersStep'
    | 'declareBlockersStep'
    | 'combatDamageStep'
    | 'endCombatStep'
    | 'stateEndPhase'
    | 'cleanupStep'
    | 'Stack'
    | 'gameOver';

export type GameTransitionMap = Record<GameStateName, GameStateName[]>;

