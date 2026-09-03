import { v4 as uuidv4 } from 'uuid';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { PlayerState } from '../types/game.player.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { CardInstance } from '../types/card.types';

import { instantiateCard } from '../library/card-factory';

const RPS_CARD_IDS = ['rock', 'paper', 'scissors'] as const;

/**
 * Test deck composition for the post-RPS smoke test.
 * 4x empire-servant (1/1 creature, {R}, taps for red) + 4x land-red (land, taps for red).
 */
const TEST_DECK_IDS = [
  'empire-servant', 'empire-servant', 'empire-servant', 'empire-servant',
  'land-red', 'land-red', 'land-red', 'land-red',
];

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
        previousPhase: null,
        activeTurnPlayerId: player1Id,
        priorityPlayerId: null,
        lastPassedPlayerId: null,
        battlefield: [],
        continuousEffectPool: [],
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
      const c1 = instantiateCard(id);
      c1.state.zone = 'hand';
      c1.state.ownerId = room.player1Id;
      c1.state.controllerId = room.player1Id;
      p1.hand.push(c1);

      const c2 = instantiateCard(id);
      c2.state.zone = 'hand';
      c2.state.ownerId = room.player2Id;
      c2.state.controllerId = room.player2Id;
      p2.hand.push(c2);
    }
}

/**
 * Build a test deck for a player. Cards are instantiated with zone='library'
 * and correct ownerId/controllerId. The deck is shuffled (Fisher-Yates).
 */
export function buildTestDeck(playerId: PlayerId): CardInstance[] {
  const deck = TEST_DECK_IDS.map(id => {
    const card = instantiateCard(id);
    card.state.zone = 'library';
    card.state.ownerId = playerId;
    card.state.controllerId = playerId;
    return card;
  });

  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

export function dealStartingHands(room: GameRoom): void {
    if (!room.player2Id) return;

    const p1 = room.players[room.player1Id];
    const p2 = room.players[room.player2Id];

    p1.hand = [];
    p2.hand = [];

    for (let i = 0; i < 4; i++) {
        const p1Card = p1.deck.pop();
        if (p1Card) {
          p1Card.state.zone = 'hand';
          p1.hand.push(p1Card);
        }

        const p2Card = p2.deck.pop();
        if (p2Card) {
          p2Card.state.zone = 'hand';
          p2.hand.push(p2Card);
        }
    }
}

/**
 * Resolve the RPS phase once both players have chosen.
 * Returns mutations that set the winner's turn, transition to stateTurnStart,
 * and discard all remaining RPS cards from both hands.
 *
 * Tie rule: player1 goes first on a tie (deterministic, no replayed rounds).
 * Starting-hand dealing is deferred until deck-building exists (decks are empty).
 */
export function resolveRPS(room: GameRoom): GameMutation[] {
  const p1 = room.player1Id;
  const p2 = room.player2Id!;
  const c1 = room.rpsState.playedCards[p1];
  const c2 = room.rpsState.playedCards[p2];

  // rock > scissors, scissors > paper, paper > rock
  const beats: Record<string, string> = { rock: 'scissors', scissors: 'paper', paper: 'rock' };

  let winner: PlayerId;
  if (c1 === c2) {
    winner = p1; // tie → player1 goes first
  } else if (beats[c1] === c2) {
    winner = p1;
  } else {
    winner = p2;
  }

  const mutations: GameMutation[] = [
    { type: 'SET_RPS_STATUS', status: 'resolved' },
    { type: 'SET_TURN', playerId: winner },
    { type: 'SET_PHASE', phase: 'stateTurnStart' },
  ];

  // Discard remaining RPS cards from both hands
  for (const [pid, player] of Object.entries(room.players)) {
    for (const card of player.hand) {
      if (['rock', 'paper', 'scissors'].includes(card.blueprint.id)) {
        mutations.push({ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: pid as PlayerId, from: 'hand', to: 'graveyard' });
      }
    }
  }

  return mutations;
}