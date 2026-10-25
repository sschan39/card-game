import { v4 as uuidv4 } from 'uuid';
import type { GameRoom, PlayerId } from '@shared/game.room.types';
import type { PlayerState } from '@shared/game.player.types';
import { instantiateCard } from '@library/card-factory';

/** Turn-flow fixtures opt in; empty-library rule tests retain empty defaults. */
export function fillTestLibraries(room: GameRoom, count = 8): void {
  for (const player of Object.values(room.players)) player.deck = Array.from({ length: count }, () => {
    const card = instantiateCard('empire-servant');
    card.state = { ...card.state, zone: 'library', ownerId: player.id, controllerId: player.id };
    return card;
  });
}

export function createTestRoom(overrides?: Partial<GameRoom>): GameRoom {
  const player1Id: PlayerId = 'player1';
  const player2Id: PlayerId = 'player2';

  const defaultPlayer = (id: PlayerId): PlayerState => ({
    id,
    life: 20,
    mana: { red: 5, blue: 5, green: 5, black: 5, white: 5, yellow: 5 },
    deck: [],
    hand: [],
    graveyard: [],
  });

  const p1 = defaultPlayer(player1Id);
  const p2 = defaultPlayer(player2Id);

  // Put empire-servant in player1's hand
  const card = instantiateCard('empire-servant');
  card.state.zone = 'hand';
  card.state.ownerId = player1Id;
  card.state.controllerId = player1Id;
  p1.hand.push(card);

  const room: GameRoom = {
    roomId: uuidv4(),
    player1Id,
    player2Id,
    players: {
      [player1Id]: p1,
      [player2Id]: p2,
    },
    phase: 'stateMainPhase',
    status: 'playing',
    engineState: 'waiting_for_player',
    activeTurnPlayerId: player1Id,
    priorityPlayerId: player1Id,
    lastPassedPlayerId: null,
    stack: [],
    combat: [],
    battlefield: [],
    continuousEffectPool: [],
    rpsState: { status: 'resolved', playedCards: {} },
    ...overrides,
  };

  return room;
}
