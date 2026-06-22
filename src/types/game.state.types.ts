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
    | 'stateBattlePhase'
    | 'stateEndPhase'
    | 'cleanupStep'
    | 'gameOver';

export type GameTransitionMap = Record<GameStateName, GameStateName[]>;


export interface GameStateMachineConfig {
	roomId: string;
	currentPhase?: GameStateName;
	previousPhase?: GameStateName | null;

}

