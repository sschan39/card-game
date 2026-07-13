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
    readonly roomId: string;
    player1Id: PlayerId;
    player2Id: PlayerId | null;
    players: Record<PlayerId, PlayerState>;
    currentPhase: GameStateName;
    activeTurnPlayerId: PlayerId;
    priorityPlayerId: PlayerId | null;
    lastPassedPlayerId: PlayerId | null;
    stack: StackObject[];
    battlefield: CardInstance[];
    rpsState: {
        status: string;
        playedCards: Record<PlayerId, string>;
    };
}
//# sourceMappingURL=game.room.types.d.ts.map