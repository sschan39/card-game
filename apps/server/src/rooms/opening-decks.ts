import type { SetupConfig } from '../config/gameplay';
import type { OpeningDecks } from '@card-game/engine/engine/opening-decks';
import { getPlayableBlueprint } from '../catalog/card-factory';
import type { GameRoom } from '@card-game/engine/types/game.room.types';

/** Resolve the lobby's selected deck IDs before entering the engine. */
export function resolveOpeningDecks(room: GameRoom, setup: SetupConfig): OpeningDecks {
  if (!room.player2Id) throw new Error('Both seats must be filled before opening a match');
  const bySeat = Object.fromEntries([room.player1Id, room.player2Id].map(seat => {
    const selected = setup.playerDecks?.[seat];
    const cards = (selected ?? setup.developmentDeck).map(getPlayableBlueprint);
    return [seat, { cards, shuffle: selected !== undefined || setup.shuffleDevelopmentDeck }];
  }));
  return { openingHandSize: setup.openingHandSize, bySeat };
}
