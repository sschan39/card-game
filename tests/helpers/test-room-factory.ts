import { v4 as uuidv4 } from 'uuid';
import type { GameRoom, PlayerId } from '../../src/types/game.room.types';
import type { PlayerState } from '../../src/types/game.player.types';
import { instantiateCard } from '../../src/library/card-factory';

export function createTestRoom(overrides?: Partial<GameRoom>): GameRoom {
  const player1Id: PlayerId = 'player1';
  const player2Id: PlayerId = 'player2';

  const defaultPlayer = (id: PlayerId): PlayerState => ({
    id,
    life: 20,
    mana: { red: 5, blue: 5, green: 5, black: 5, white: 5, colorless: 5 },
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
    currentPhase: 'stateMainPhase',
    previousPhase: null,
    activeTurnPlayerId: player1Id,
    priorityPlayerId: player1Id,
    lastPassedPlayerId: null,
    stack: [],
    battlefield: [],
    rpsState: { status: 'resolved', playedCards: {} },
    winnerId: null,
    combat: {},
    ...overrides,
  };

  return room;
}