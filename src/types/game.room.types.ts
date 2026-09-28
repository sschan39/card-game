/**
 * src/types/game.room.types.ts
 * Type-only definitions for room data stored by the game logic.
 */

import type { CardInstance, ContinuousEffectEntry } from './card.types';
import type { StackObject, CombatDeclaration } from './effect.types';
import type { PlayerState } from './game.player.types';
import type { Phase, GameStatus } from './game.state.types';

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
	phase: Phase;
	status: GameStatus;

	// Engine control state — disambiguates why priorityPlayerId may be null.
	// 'waiting_for_player': a player holds (or should hold) the priority token
	// 'resolving_stack': the stack is resolving; no player may act
	// 'state_based_actions': SBAs are being checked/applied
	engineState: 'waiting_for_player' | 'resolving_stack' | 'state_based_actions';
	
    // Priority Engine (Data-driven)
    activeTurnPlayerId: PlayerId;          // Whose literal turn it is
    priorityPlayerId: PlayerId | null;     // Who currently has the right to act
    lastPassedPlayerId: PlayerId | null;   // Tracks consecutive passes to resolve the stack
    stack: StackObject[];                  // If length = 0, normal turn rules are paused
    combat: CombatDeclaration[];           // Declared attackers (turn-based action, NOT on the stack)

	// Board State, need update
	battlefield: CardInstance[];            // Unified board state (cards track control via state flags)

	// Continuous Effect Pool (MTG-faithful global registry)
	continuousEffectPool: ContinuousEffectEntry[];

	// Mini-game state parameters
	rpsState: {
		status: string;
		playedCards: Record<PlayerId, string>; // Maps player IDs to 'rock' | 'paper' | 'scissors'
	};
}

