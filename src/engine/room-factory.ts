import { v4 as uuidv4 } from 'uuid';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { PlayerState } from '../types/game.player.types';

import { instantiateCard } from '../library/card-factory';

const RPS_CARD_IDS = ['rock', 'paper', 'scissors'] as const;

function createDefaultPlayer(id: PlayerId): PlayerState {
    return {
        id,
        life: 20,
        mana: { red: 0, blue: 0, green: 0, black: 0, white: 0, colorless: 0 },
        deck: [],
        hand: [],
        graveyard: []
    };
}

export function createRoom(roomId: string, player1Id: PlayerId): GameRoom {
    return {
        roomId,
        player1Id: player1Id,
        player2Id: null,
        players: {
            [player1Id]: createDefaultPlayer(player1Id)
        },
        currentPhase: 'waiting',
        activeTurnPlayerId: player1Id,
        priorityPlayerId: null,
        lastPassedPlayerId: null,
        battlefield: [],
        stack: [],
        rpsState: {
            status: 'pending',
            playedCards: {}
        }
    };
}

export function joinRoom(room: GameRoom, player2Id: PlayerId): void {
    room.player2Id = player2Id;
    room.players[player2Id] = createDefaultPlayer(player2Id);
}

export function setupRPS(room: GameRoom): void {
    room.currentPhase = 'RPS';
    
    if (!room.player2Id) return;

    const p1 = room.players[room.player1Id];
    const p2 = room.players[room.player2Id];

    room.battlefield = [];
    p1.hand = [];
    p2.hand = [];

    for (const id of RPS_CARD_IDS) {
      p1.hand.push(instantiateCard(id));
      p2.hand.push(instantiateCard(id));
    }
}

export function dealStartingHands(room: GameRoom): void {
    if (!room.player2Id) return;

    const p1 = room.players[room.player1Id];
    const p2 = room.players[room.player2Id];

    p1.hand = [];
    p2.hand = [];

    for (let i = 0; i < 4; i++) {
        const p1Card = p1.deck.pop();
        if (p1Card) p1.hand.push(p1Card);

        const p2Card = p2.deck.pop();
        if (p2Card) p2.hand.push(p2Card);
    }
}