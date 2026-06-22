import { v4 as uuidv4 } from 'uuid';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { PlayerState, ManaPool } from '../types/game.player.types';

 
// import { decks } from '../library/decks';

export class roomFactory {
    
    /**
     * Creates the initial, blank-slate room when Player 1 hosts.
     */
    public static createRoom(roomId: string, player1Id: PlayerId): GameRoom {
        return {
            roomId,
            
            // Player Identities
            player1Id: player1Id,
            player2Id: null,
            
            // Player Data Dictionary
            players: {
                [player1Id]: this.createDefaultPlayer(player1Id)
            },

            // Phase & Priority Engine
            currentPhase: 'waiting',
            activeTurnPlayerId: player1Id, // Defaults to P1, changed by RPS
            priorityPlayerId: null,
            lastPassedPlayerId: null,

            // Board & Stack
            battlefield: [],
            stack: [],

            // Mini-game State
            rpsState: {
                status: 'pending',
                playedCards: {}
            }
        };
    }

    /**
     * Adds Player 2 to the room.
     */
    public static joinRoom(room: GameRoom, player2Id: PlayerId): void {
        room.player2Id = player2Id;
        room.players[player2Id] = this.createDefaultPlayer(player2Id);
    }

    /**
     * Generates a fresh player state with 20 HP, 0 Mana, and a loaded deck.
     */
    private static createDefaultPlayer(id: PlayerId): PlayerState {
        return {
            id,
            health: 20,
            mana: { red: 0, blue: 0, green: 0, black: 0, white: 0, colorless: 0 },
            deck: [], // e.g., decks['redDeck'].map(id => instantiateCard(id))
            hand: [],
            graveyard: []
        };
    }

    /**
     * Prepares the room for the Rock-Paper-Scissors phase.
     */
    public static setupRPS(room: GameRoom): void {
        room.currentPhase = 'RPS';
        
        // Ensure both players exist before dealing
        if (!room.player2Id) return;

        const p1 = room.players[room.player1Id];
        const p2 = room.players[room.player2Id];

        // Clear areas
        room.battlefield = [];
        p1.hand = [];
        p2.hand = [];

        // Give RPS cards (assuming instantiateCard is set up)
        p1.hand.push(instantiateCard('rock'), instantiateCard('paper'), instantiateCard('scissors'));
        p2.hand.push(instantiateCard('rock'), instantiateCard('paper'), instantiateCard('scissors'));
    }

    /**
     * Clears RPS data and deals 4 cards to each player to start the real match.
     */
    public static dealStartingHands(room: GameRoom): void {
        if (!room.player2Id) return;

        const p1 = room.players[room.player1Id];
        const p2 = room.players[room.player2Id];

        // Clear RPS hands
        p1.hand = [];
        p2.hand = [];

        // Draw 4 cards each
        for (let i = 0; i < 4; i++) {
            const p1Card = p1.deck.pop();
            if (p1Card) p1.hand.push(p1Card);

            const p2Card = p2.deck.pop();
            if (p2Card) p2.hand.push(p2Card);
        }
    }
}