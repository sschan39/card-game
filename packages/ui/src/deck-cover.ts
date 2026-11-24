import { cardArt } from './card-art';

/** Use the most represented non-land art when the printed catalog is available. */
export function deckCoverArt(cards: readonly { cardId: string; quantity: number }[],
  catalog?: ReadonlyMap<string, { cardTypes: readonly string[] }>): string | undefined {
  const ranked = [...cards].sort((a, b) => b.quantity - a.quantity || a.cardId.localeCompare(b.cardId));
  let fallback: string | undefined;
  for (const { cardId } of ranked) {
    const art = cardArt(cardId);
    if (!art) continue;
    const card = catalog?.get(cardId);
    if (card && !card.cardTypes.includes('Land')) return art;
    fallback ??= art;
  }
  return fallback;
}
