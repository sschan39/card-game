import { shuffle } from '@card-game/engine/shared/random';
import type { GameRoom, PlayerId } from '@card-game/engine/types/game.room.types';
import type { PlayerState } from '@card-game/engine/types/game.player.types';
import type { CardInstance } from '@card-game/engine/types/card.types';

import { createCardState } from '@card-game/engine/shared/card-state';
import { instantiateCard, getPlayableBlueprint } from '../catalog/card-factory';
import { gameConfig, matchRulesFrom, snapshotSetupConfig, type SetupConfig, type RoomSettings } from '../config/gameplay';
import { defaultRuntimeContext, type RuntimeContext } from '@card-game/engine/shared/runtime-context';
import { loadMatchContent } from '../catalog/match-content';

/** The application keeps the opening selection alongside the waiting position. */
export interface Lobby {
  readonly room: GameRoom;
  readonly setup: SetupConfig;
}

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
export function createRoom(roomId: string, player1Id: PlayerId, cards?: readonly string[], settings?: RoomSettings): Lobby {
  const selected = settings?.setup ?? gameConfig.setup;
  const setup = snapshotSetupConfig(cards ? { ...selected, playerDecks: { [player1Id]: [...cards] } } : selected);

  // An explicit card list overrides the configured development deck.
  if (cards) {
    cards.forEach(getPlayableBlueprint);
    setup.playerDecks = { [player1Id]: [...cards] };
  } else {
    setup.developmentDeck.forEach(getPlayableBlueprint);
  }

  const room: GameRoom = {
    setup: matchRulesFrom(setup),
    matchContent: loadMatchContent(),
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
  };
  return { room, setup };
}

/** Seat player 2 and optionally pin their deck list. */
export function joinRoom({ room, setup }: Lobby, player2Id: PlayerId, cards?: readonly string[]): void {
  if (cards) {
    cards.forEach(getPlayableBlueprint);
    setup.playerDecks = { ...setup.playerDecks, [player2Id]: [...cards] };
  }

  room.player2Id = player2Id;
  room.players[player2Id] = createDefaultPlayer(player2Id, setup);
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
export function dealStartingHands(room: GameRoom, openingHandSize = gameConfig.setup.openingHandSize): void {
  // Guard: dealing needs both seats filled.
  if (!room.player2Id) return;

  const p1 = room.players[room.player1Id];
  const p2 = room.players[room.player2Id];

  p1.hand = [];
  p2.hand = [];

  for (let i = 0; i < openingHandSize; i++) {
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
