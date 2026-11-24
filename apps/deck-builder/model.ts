import { z } from 'zod';
import { changeCardCounts, CardIdSchema, DECK_RULES, DeckSchema, type CatalogCard, type DeckInput, type SavedDeck } from '@card-game/protocol';
import { builderConfig } from './config';

// Drafts may be empty/unnamed while editing. Saving still uses validateDeck.
export const DraftSchema = DeckSchema.extend({ name: z.string().max(80), cards: z.array(DeckSchema.shape.cards.element).max(DECK_RULES.maxCards) });
export const newDraft = (): DeckInput => ({ name: '', format: DECK_RULES.format, cards: [] });
export const editableDeck = (deck: SavedDeck): DeckInput => ({ name: deck.name, format: deck.format, cards: deck.cards.map(entry => ({ ...entry })) });
export const deckCount = (deck: DeckInput) => deck.cards.reduce((sum, entry) => sum + entry.quantity, 0);

export function eligibleDeckCount(deck: DeckInput, catalog: ReadonlyMap<string, CatalogCard>): number {
  return deck.cards.reduce((count, { cardId, quantity }) => {
    const card = catalog.get(cardId);
    return count + (card?.deckLegal ? Math.min(quantity, card.copyLimit ?? quantity) : 0);
  }, 0);
}
/** Apply an absolute quantity atomically against the current card and deck limits. */
export function setCopies(deck: DeckInput, cardId: string, quantity: number, catalog: ReadonlyMap<string, CatalogCard>): { deck: DeckInput; error: string | null } {
  const reject = (error: string) => ({ deck, error });
  if (!Number.isSafeInteger(quantity) || quantity < 0) return reject('Enter a whole number of zero or more.');
  const current = deck.cards.find(entry => entry.cardId === cardId)?.quantity ?? 0;
  const card = catalog.get(cardId);
  if (quantity && (!card || !card.deckLegal)) return reject('This card cannot be added to a saved deck. Set zero to remove it.');
  const max = card?.copyLimit ?? DECK_RULES.maxCards;
  if (quantity > max) return reject(`Use at most ${max} copies of this card.`);
  if (deckCount(deck) - current + quantity > DECK_RULES.maxCards) return reject(`Use at most ${DECK_RULES.maxCards} cards in the deck.`);
  return { deck: quantity === current ? deck : changeCopies(deck, cardId, quantity - current), error: null };
}
export function changeCopies(deck: DeckInput, cardId: string, delta: number): DeckInput {
  if (!CardIdSchema.safeParse(cardId).success || !Number.isSafeInteger(delta)) return deck;
  if((deck.cards.find(entry=>entry.cardId===cardId)?.quantity??0)+delta>DECK_RULES.maxCards)return deck;
  return { ...deck, cards: changeCardCounts(deck.cards, cardId, delta, DECK_RULES.maxCards) };
}
export { filterCatalog, type CatalogFilter } from '@card-game/protocol';
/** Portable, unambiguous IDs; JSON-quoted name prevents header/line injection. */
export function exportDeck(deck: DeckInput): string {
  return ['# name: ' + JSON.stringify(deck.name), '# format: ' + deck.format,
    ...[...deck.cards].sort((a, b) => a.cardId.localeCompare(b.cardId)).map(entry => `${entry.quantity} ${entry.cardId}`)].join('\n') + '\n';
}
export function importDeck(text: string): DeckInput {
  if (new TextEncoder().encode(text).length > builderConfig.maxImportBytes) throw new Error('Deck text is too large.');
  let name = 'Imported deck';
  const quantities = new Map<string, number>(), lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.length > DECK_RULES.maxCards + 20) throw new Error('Too many lines in deck text.');
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('# name: ')) {
      try { const value: unknown = JSON.parse(line.slice(8)); name = z.string().max(80).parse(value); }
      catch { throw new Error(`Invalid deck name on line ${index + 1}.`); }
    } else if (line.startsWith('# format: ')) {
      if (line.slice(10) !== DECK_RULES.format) throw new Error('Unsupported deck format.');
    } else if (!line.startsWith('#')) {
      const match = /^(\d{1,3})\s+([a-z0-9][a-z0-9_-]{0,127})$/.exec(line);
      if (!match || Number(match[1]) < 1) throw new Error(`Use "quantity card-id" on line ${index + 1}.`);
      const quantity = (quantities.get(match[2]) ?? 0) + Number(match[1]);
      if (quantity > DECK_RULES.maxCards) throw new Error(`Too many copies on line ${index + 1}.`);
      quantities.set(match[2], quantity);
    }
  }
  if (!quantities.size) throw new Error('Deck text contains no cards.');
  return DraftSchema.parse({ name, format: DECK_RULES.format, cards: [...quantities].map(([cardId, quantity]) => ({ cardId, quantity })) });
}
