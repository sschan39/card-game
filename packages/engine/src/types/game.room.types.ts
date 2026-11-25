import type { MatchRules } from './setup-config.types';
import type { MatchContent } from './match-content.types';
/**
 * src/types/game.room.types.ts
 * Type-only definitions for room data stored by the game logic.
 */

import type { CardInstance, ContinuousEffectEntry } from './card.types';
import type { StackObject, CombatDeclaration } from './effect.types';
import type { PlayerState } from './game.player.types';
import type { Phase, GameStatus } from './game.state.types';
import type { DebugMode } from './debug-mode.types';

export type PlayerId = PlayerState['id'];

export interface PlayerLoss {
    playerId: PlayerId;
    reason: 'life_total' | 'failed_draw' | 'concede';
}

export type GameOutcome =
    | { type: 'win'; winnerId: PlayerId; losses: PlayerLoss[] }
    | { type: 'draw'; losses: PlayerLoss[] };

export interface MatchPosition {
    readonly matchContent?: MatchContent;
    tokenSequence?: number;
    cardObservations?: import('./card-observation.types').ObservationState;
    /** Rules-only causal ledger, keyed by exact battlefield incarnation; never projected raw. */
    causalState?: Record<string, import('./change-cause.types').LethalAttribution>;
    gameRuleUses?: Record<string, number>;
    replacementEffects?: import('./proposed-event.types').ReplacementDefinition[];
    replacementSequence?: number;
    /** Monotonic characteristic/effect timestamps survive effect expiry. */
    effectTimestamp?: number;
    effectSequence?: number;
    delayedTriggers?: import('./trigger.types').DelayedTrigger[];
    turnHistory?: import('./trigger.types').TurnHistory;
    triggerQueue?: import('./trigger.types').TriggerQueue | null;
    pendingChoice?: import('./choice.types').PendingChoice | null;
    /** Trigger proposals discovered during a paused resolution, restored with the room. */
    pendingTriggers?: import('./game-mutation.types').GameMutation[];
    //Player Data
    
	player1Id: PlayerId;
	player2Id: PlayerId | null;
    // Access via room.players[playerId]
    players: Record<PlayerId, PlayerState>; // All health, hands, and decks here

    // Loop Execution Context, Linear Phase Engine
	phase: Phase;
	status: GameStatus;
    /** Copied from central config at creation; absent in legacy snapshots. */
    debugMode?: DebugMode;
    setup?: MatchRules;
    turnNumber?: number;
    /** Absent until the game ends. */
    outcome?: GameOutcome;

	// Engine control state — disambiguates why priorityPlayerId may be null.
	// 'waiting_for_player': a player holds (or should hold) the priority token
	// 'resolving_stack': the stack is resolving; no player may act
	// 'state_based_actions': SBAs are being checked/applied
	engineState: 'waiting_for_player' | 'resolving_stack' | 'state_based_actions' | 'game_over';
	
    // Priority Engine (Data-driven)
    activeTurnPlayerId: PlayerId;          // Whose literal turn it is
    priorityPlayerId: PlayerId | null;     // Who currently has the right to act
    lastPassedPlayerId: PlayerId | null;   // Tracks consecutive passes to resolve the stack
    stack: StackObject[];                  // If length = 0, normal turn rules are paused
    combatDeclarations?: { attackers: boolean; blockers: boolean };
    combatDamage?: import('./combat.types').CombatDamageState | null;
    combat: CombatDeclaration[];           // Declared attackers (turn-based action, NOT on the stack)

	// Board State, need update
	battlefield: CardInstance[];            // Unified board state (cards track control via state flags)

	// Continuous Effect Pool (MTG-faithful global registry)
	continuousEffectPool: ContinuousEffectEntry[];

	// Mini-game state parameters
}

/** Correlation envelope for the existing event and transport APIs. */
export interface GameRoom extends MatchPosition {
    readonly roomId: string;
}

