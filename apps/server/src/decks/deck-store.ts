import type { DeckInput, SavedDeck } from '@card-game/protocol';

/** Every operation carries the authenticated owner; IDs alone never authorize access. */
export interface DeckRepository {
  listDecks(ownerId: string, offset: number, limit: number): { decks: SavedDeck[]; total: number };
  findDeck(ownerId: string, id: string): SavedDeck | undefined;
  createDeck(ownerId: string, deck: SavedDeck): boolean;
  updateDeck(ownerId: string, id: string, deck: DeckInput, updatedAt: number): SavedDeck | undefined;
  deleteDeck(ownerId: string, id: string): boolean;
}

export class InMemoryDeckStore implements DeckRepository {
  private readonly records = new Map<string, { ownerId: string; deck: SavedDeck }>();
  listDecks(ownerId: string, offset: number, limit: number) {
    const owned = [...this.records.values()].filter(entry => entry.ownerId === ownerId).map(entry => entry.deck).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    return { total: owned.length, decks: structuredClone(owned.slice(offset, offset + limit)) };
  }
  findDeck(ownerId: string, id: string) { const entry = this.records.get(id); return entry?.ownerId === ownerId ? structuredClone(entry.deck) : undefined; }
  createDeck(ownerId: string, deck: SavedDeck) {
    if (this.records.has(deck.id)) return false;
    this.records.set(deck.id, { ownerId, deck: structuredClone(deck) }); return true;
  }
  updateDeck(ownerId: string, id: string, input: DeckInput, updatedAt: number) {
    const previous = this.findDeck(ownerId, id); if (!previous) return;
    const deck = { ...structuredClone(input), id, createdAt: previous.createdAt, updatedAt };
    this.records.set(id, { ownerId, deck }); return structuredClone(deck);
  }
  deleteDeck(ownerId: string, id: string) { return !!this.findDeck(ownerId, id) && this.records.delete(id); }
}
