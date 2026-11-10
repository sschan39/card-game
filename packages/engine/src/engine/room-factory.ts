import { shuffle } from '../shared/random';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { PlayerState } from '../types/game.player.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { CardInstance } from '../types/card.types';

import { createCardState } from '../shared/card-state';
import { instantiateCard, getBlueprint } from '../library/card-factory';
import { gameConfig, snapshotSetupConfig } from '../config';
import type { SetupConfig, RoomSettings } from '../types/setup-config.types';
import { defaultRuntimeContext, type RuntimeContext } from '../shared/runtime-context';

const RPS_CARD_IDS = ['rock', 'paper', 'scissors'] as const;

/** A fresh player record with full life, empty mana pool and empty zones. */
function createDefaultPlayer(id: PlayerId, setup: SetupConfig): PlayerState {
  return {
    id,
    life: setup.startingLife,
    mana: { red: 0, blue: 0, green: 0, black: 0, white: 0, yellow: 0 },
    deck: [],
    hand: [],
    graveyard: [],
  };
}

/** Create a room with only player 1 seated; player 2 joins later. */
export function createRoom(roomId: string, player1Id: PlayerId, cards?: readonly string[], settings?: RoomSettings): GameRoom {
  const selected = settings?.setup ?? gameConfig.setup;
  const setup = snapshotSetupConfig(cards ? { ...selected, playerDecks: { [player1Id]: [...cards] } } : selected);

  // An explicit card list overrides the configured development deck.
  if (cards) {
    cards.forEach(getBlueprint);
    setup.playerDecks = { [player1Id]: [...cards] };
  } else {
    setup.developmentDeck.forEach(getBlueprint);
  }

  return {
    setup,
    turnNumber: 1,
    roomId,
    player1Id: player1Id,
    player2Id: null,
    players: {
      [player1Id]: createDefaultPlayer(player1Id, setup),
    },
    phase: 'stateMainPhase',
    status: 'waiting',
    debugMode: settings?.debugMode ?? gameConfig.debugMode,
    engineState: 'waiting_for_player',
    activeTurnPlayerId: player1Id,
    priorityPlayerId: null,
    lastPassedPlayerId: null,
    battlefield: [],
    continuousEffectPool: [],
    stack: [],
    combat: [],
    rpsState: {
      status: 'pending',
      playedCards: {},
    },
  };
}

/** Seat player 2 and optionally pin their deck list. */
export function joinRoom(room: GameRoom, player2Id: PlayerId, cards?: readonly string[]): void {
  if (cards) {
    cards.forEach(getBlueprint);
    room.setup = { ...(room.setup ?? snapshotSetupConfig()), playerDecks: { ...room.setup?.playerDecks, [player2Id]: [...cards] } };
  }

  room.player2Id = player2Id;
  room.players[player2Id] = createDefaultPlayer(player2Id, room.setup ?? gameConfig.setup);
}

/** Deal the three RPS cards to both players and enter the RPS phase. */
export function setupRPS(
  room: GameRoom,
  context: Pick<RuntimeContext, 'uuid'> = defaultRuntimeContext,
): void {
  room.status = 'RPS';

  // Guard: RPS needs both seats filled.
  if (!room.player2Id) return;

  const p1 = room.players[room.player1Id];
  const p2 = room.players[room.player2Id];

  room.battlefield = [];
  p1.hand = [];
  p2.hand = [];

  for (const id of RPS_CARD_IDS) {
    const c1 = instantiateCard(id, context);
    c1.state = createCardState(c1.blueprint, room.player1Id, room.player1Id, 'hand');
    p1.hand.push(c1);

    const c2 = instantiateCard(id, context);
    c2.state = createCardState(c2.blueprint, room.player2Id, room.player2Id, 'hand');
    p2.hand.push(c2);
  }
}

/**
 * Build a test deck for a player. Cards are instantiated with zone='library'
 * and correct ownerId/controllerId. The deck is shuffled (Fisher-Yates).
 */
export function buildTestDeck(
  playerId: PlayerId,
  setup: SetupConfig = gameConfig.setup,
  context: RuntimeContext = defaultRuntimeContext,
): CardInstance[] {
  return buildDeck(playerId, setup.developmentDeck, setup.shuffleDevelopmentDeck, context);
}

/** Instantiate a deck list into library-zone cards, optionally shuffled. */
function buildDeck(playerId: PlayerId, cardIds: readonly string[], shouldShuffle: boolean, context: RuntimeContext): CardInstance[] {
  const deck = cardIds.map((id) => {
    const card = instantiateCard(id, context);
    card.state.zone = 'library';
    card.state.ownerId = playerId;
    card.state.controllerId = playerId;

    return card;
  });

  return shouldShuffle ? shuffle(deck, context.random) : deck;
}

/** Move the top cards of both decks into the opening hands. */
export function dealStartingHands(room: GameRoom): void {
  // Guard: dealing needs both seats filled.
  if (!room.player2Id) return;

  const p1 = room.players[room.player1Id];
  const p2 = room.players[room.player2Id];

  p1.hand = [];
  p2.hand = [];

  for (let i = 0; i < (room.setup ?? gameConfig.setup).openingHandSize; i++) {
    const p1Card = p1.deck.pop();

    if (p1Card) {
      p1Card.state = createCardState(p1Card.blueprint, p1.id, p1.id, 'hand');
      p1.hand.push(p1Card);
    }

    const p2Card = p2.deck.pop();

    if (p2Card) {
      p2Card.state = createCardState(p2Card.blueprint, p2.id, p2.id, 'hand');
      p2.hand.push(p2Card);
    }
  }
}

/** Build/deal on fresh setup data so previously committed room references stay intact. */
export function buildStartingCardMutations(
  room: GameRoom,
  context: RuntimeContext = defaultRuntimeContext,
): GameMutation[] {
  // Guard: nothing to deal until both players are seated.
  if (!room.player2Id) return [];

  const ids = [room.player1Id, room.player2Id];
  const players = { ...room.players };

  for (const id of ids) {
    players[id] = {
      ...players[id],
      deck: room.setup?.playerDecks?.[id]
        ? buildDeck(id, room.setup.playerDecks[id], true, context)
        : buildTestDeck(id, room.setup ?? gameConfig.setup, context),
      hand: [],
    };
  }

  // Deal against a throwaway copy so the real room is untouched.
  const setup = { ...room, players };
  dealStartingHands(setup);

  return ids.map((playerId) => ({
    type: 'SET_PLAYER_ZONES',
    playerId,
    deck: setup.players[playerId].deck,
    hand: setup.players[playerId].hand,
  }));
}

/**
 * Resolve the RPS phase once both players have chosen.
 * Returns mutations that set the winner's turn, transition to stateTurnStart,
 * and discard all remaining RPS cards from both hands.
 *
 * Tie rule: player1 goes first on a tie (deterministic, no replayed rounds).
 * The server deals the configured development deck after RPS resolution.
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
    { type: 'SET_STATUS', status: 'playing' },
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
