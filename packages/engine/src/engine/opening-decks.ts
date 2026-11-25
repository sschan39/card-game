import { createCardState } from '../shared/card-state';
import { shuffle } from '../shared/random';
import type { RuntimeContext } from '../shared/runtime-context';
import type { CardBlueprint, CardInstance } from '../types/card.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { PlayerId } from '../types/game.room.types';

export interface OpeningDeck {
  readonly cards: readonly CardBlueprint[];
  readonly shuffle: boolean;
}

export interface OpeningDecks {
  readonly openingHandSize: number;
  readonly bySeat: Readonly<Record<PlayerId, OpeningDeck>>;
}

export function buildStartingCardMutations(
  seats: readonly [PlayerId, PlayerId],
  opening: OpeningDecks,
  context: RuntimeContext,
): GameMutation[] {
  if (!Number.isSafeInteger(opening.openingHandSize) || opening.openingHandSize < 0) {
    throw new Error('Invalid opening hand size');
  }

  const decks = seats.map(playerId => {
    const input = Object.prototype.hasOwnProperty.call(opening.bySeat, playerId) ? opening.bySeat[playerId] : undefined;
    if (!input || input.cards.length < opening.openingHandSize) {
      throw new Error('Each seat needs a deck large enough to deal its opening hand');
    }
    return [playerId, input] as const;
  });

  return decks.map(([playerId, input]) => {
    const cards: CardInstance[] = input.cards.map(blueprint => ({
      blueprint,
      uuid: context.uuid(),
      state: createCardState(blueprint, playerId, playerId, 'library'),
    }));
    const deck = input.shuffle ? shuffle(cards, context.random) : cards;
    const hand: CardInstance[] = [];
    for (let index = 0; index < opening.openingHandSize; index++) {
      const card = deck.pop()!;
      hand.push({ ...card, state: createCardState(card.blueprint, playerId, playerId, 'hand') });
    }

    return { type: 'SET_PLAYER_ZONES', playerId, deck, hand };
  });
}
