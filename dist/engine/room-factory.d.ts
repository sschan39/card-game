import type { GameRoom, PlayerId } from '../types/game.room.types';
export declare class roomFactory {
    /**
     * Creates the initial, blank-slate room when Player 1 hosts.
     */
    static createRoom(roomId: string, player1Id: PlayerId): GameRoom;
    /**
     * Adds Player 2 to the room.
     */
    static joinRoom(room: GameRoom, player2Id: PlayerId): void;
    /**
     * Generates a fresh player state with 20 HP, 0 Mana, and a loaded deck.
     */
    private static createDefaultPlayer;
    /**
     * Prepares the room for the Rock-Paper-Scissors phase.
     */
    static setupRPS(room: GameRoom): void;
    /**
     * Clears RPS data and deals 4 cards to each player to start the real match.
     */
    static dealStartingHands(room: GameRoom): void;
}
//# sourceMappingURL=room-factory.d.ts.map