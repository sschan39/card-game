/**
 * src/types/game.room.types.ts
 * Type-only definitions for room data stored by the game logic.
 */

import type { CardInstance } from './card.types';
import type { StackObject } from './effect.types';
import type { PlayerState } from './game.player.types';
import type { GameStateName } from './game.state.types';

export type PlayerId = PlayerState['id'];

export interface GameRoom {
    // Identity Context
	readonly roomId: string;
    //Player Data
    
	player1Id: PlayerId;
	player2Id: PlayerId | null;
    // Access via room.players[playerId]
    players: Record<PlayerId, PlayerState>; // All health, hands, and decks here

    // Loop Execution Context, Linear Phase Engine
	currentPhase: GameStateName;
	previousPhase: GameStateName | null;    // Phase to return to when the stack empties
	
    // Priority Engine (Data-driven)
    activeTurnPlayerId: PlayerId;          // Whose literal turn it is
    priorityPlayerId: PlayerId | null;     // Who currently has the right to act
    lastPassedPlayerId: PlayerId | null;   // Tracks consecutive passes to resolve the stack
    stack: StackObject[];                  // If length = 0, normal turn rules are paused

	// Board State, need update
	battlefield: CardInstance[];            // Unified board state (cards track control via state flags)
	

	// Mini-game state parameters
	rpsState: {
		status: string;
		playedCards: Record<PlayerId, string>; // Maps player IDs to 'rock' | 'paper' | 'scissors'
	};
}

