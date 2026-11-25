import { v4 as uuidv4 } from 'uuid';
import type { GameRoom, PlayerId } from '@shared/game.room.types';
import type { PlayerState } from '@shared/game.player.types';
import { parseCardDefinition } from '@library/card-parser';
import { loadMatchContent } from '@server/catalog/match-content';
import { createCardState } from '@rules/card-state';
import type { CardInstance, CardZone } from '@shared/card.types';
import fixture from '../fixtures/cards/empire-servant.json';

const fixtureBlueprint = parseCardDefinition(fixture);

function baselineCard(player: PlayerId, zone: CardZone): CardInstance {
  return { uuid: uuidv4(), blueprint: structuredClone(fixtureBlueprint), state: createCardState(fixtureBlueprint, player, player, zone) };
}

/** Turn-flow fixtures opt in; empty-library rule tests retain empty defaults. */
export function fillTestLibraries(room: GameRoom, count = 8): void {
  for (const player of Object.values(room.players)) player.deck = Array.from({ length: count }, () => baselineCard(player.id, 'library'));
}

export function createTestRoom(overrides?: Partial<GameRoom>): GameRoom {
  const room = createEmptyTestRoom(overrides);
  if (!overrides?.players) room.players.player1.hand.push(baselineCard('player1', 'hand'));
  return room;
}

export function createEmptyTestRoom(overrides?: Partial<GameRoom>): GameRoom {
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

  const room: GameRoom = {
    matchContent: loadMatchContent(),
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
    ...overrides,
  };

  return room;
}
