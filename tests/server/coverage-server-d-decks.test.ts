import { describe, expect, it, vi } from 'vitest';
import { DeckService, InvalidDeckError } from '@server/decks/deck-service';
import { InMemoryDeckStore } from '@server/decks/deck-store';
import { buildCatalog } from '@server/catalog/catalog';
import type { DeckInput } from '@card-game/protocol';

const catalog = buildCatalog();
const deck: DeckInput = { name: 'Mountain servants', format: 'standard', cards: [{ cardId: 'land-red', quantity: 56 }, { cardId: 'empire-servant', quantity: 4 }] };
const otherDeck: DeckInput = { name: 'Wolves', format: 'standard', cards: [{ cardId: 'land-red', quantity: 56 }, { cardId: 'red-wolf', quantity: 4 }] };
const missingId = '00000000-0000-4000-8000-000000000000';

describe('in-memory deck repository ownership and lifecycle', () => {
  it('creates, pages newest-first, updates in place and deletes only owned decks', () => {
    const store = new InMemoryDeckStore(); let now = 1000;
    const decks = new DeckService(store, catalog, () => now);
    const a = decks.create('alice', deck), b = decks.create('alice', otherDeck);
    now = 2000;
    const c = decks.create('alice', { ...deck, name: 'Third' });
    expect(store.listDecks('alice', 0, 10).total).toBe(3);
    expect(store.listDecks('alice', 0, 1).decks.map(saved => saved.id)).toEqual([c.id]);
    const sameTime = [...store.listDecks('alice', 0, 10).decks].filter(saved => saved.createdAt === 1000).map(saved => saved.id);
    expect(sameTime).toEqual([a.id, b.id].sort((left, right) => left.localeCompare(right)));
    expect(store.findDeck('bob', a.id)).toBeUndefined();
    expect(decks.list('alice', 1, 1)).toMatchObject({ total: 3 });
    expect(decks.list('alice', 1, 1).decks).toHaveLength(1);
    const updated = decks.update('alice', a.id, { ...deck, name: 'Renamed' });
    expect(updated).toMatchObject({ id: a.id, name: 'Renamed', createdAt: 1000, updatedAt: 2000 });
    expect(store.updateDeck('alice', missingId, deck, 500)).toBeUndefined();
    expect(store.deleteDeck('bob', a.id)).toBe(false);
    expect(store.deleteDeck('alice', missingId)).toBe(false);
    expect(store.deleteDeck('alice', a.id)).toBe(true);
    expect(store.deleteDeck('alice', a.id)).toBe(false);
    expect(decks.get('alice', b.id)).toMatchObject({ id: b.id });
  });

  it('rejects duplicate identifiers and cross-owner lookups', () => {
    const store = new InMemoryDeckStore(), decks = new DeckService(store, catalog);
    const saved = decks.create('alice', deck);
    expect(store.createDeck('bob', saved)).toBe(false);
    expect(() => decks.get('bob', saved.id)).toThrow('Deck not found.');
    expect(() => decks.update('bob', saved.id, deck)).toThrow('Deck not found.');
    expect(() => decks.delete('bob', saved.id)).toThrow('Deck not found.');
    expect(() => decks.matchCards('bob', saved.id)).toThrow('Deck not found.');
  });
});

describe('deck service validation, capacity and storage failures', () => {
  it('reports shared validation issues before touching storage', () => {
    const store = new InMemoryDeckStore(), decks = new DeckService(store, catalog);
    let caught: unknown;
    try { decks.create('alice', { ...deck, cards: [{ cardId: 'land-red', quantity: 55 }, { cardId: 'empire-servant', quantity: 5 }] }); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(InvalidDeckError); expect(caught).toBeInstanceOf(Error);
    expect((caught as InvalidDeckError).status).toBe(400);
    expect((caught as InvalidDeckError).issues).toEqual([{ code: 'copy_limit', cardId: 'empire-servant', message: 'Use at most 4 copies of this card.' }]);
    expect(store.listDecks('alice', 0, 1).total).toBe(0);
  });

  it('enforces the per-account deck capacity', () => {
    const store = new InMemoryDeckStore(), decks = new DeckService(store, catalog, () => 1, 1);
    decks.create('alice', deck);
    expect(() => decks.create('alice', otherDeck)).toThrow('Deck capacity reached.');
    expect(decks.create('bob', otherDeck)).toMatchObject({ name: 'Wolves' });
  });

  it('surfaces storage refusals for create and update as conflicts', () => {
    const store = new InMemoryDeckStore(), decks = new DeckService(store, catalog), create = vi.spyOn(store, 'createDeck').mockReturnValue(false);
    expect(() => decks.create('alice', deck)).toThrow('Deck could not be created.');
    create.mockRestore();
    const saved = decks.create('alice', deck), update = vi.spyOn(store, 'updateDeck').mockReturnValue(undefined);
    expect(() => decks.update('alice', saved.id, otherDeck)).toThrow('Deck not found.');
    update.mockRestore();
    expect(decks.update('alice', saved.id, otherDeck)).toMatchObject({ name: 'Wolves', createdAt: saved.createdAt });
  });

  it('expands a saved deck into the exact card-id multiset for match setup', () => {
    const store = new InMemoryDeckStore(), decks = new DeckService(store, catalog), saved = decks.create('alice', deck);
    const cards = decks.matchCards('alice', saved.id);
    expect(cards).toHaveLength(60);
    expect(cards.filter(cardId => cardId === 'land-red')).toHaveLength(56);
    expect(cards.filter(cardId => cardId === 'empire-servant')).toHaveLength(4);
    decks.delete('alice', saved.id);
    expect(store.listDecks('alice', 0, 10).total).toBe(0);
  });
});
