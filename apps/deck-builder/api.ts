import {
  PROTOCOL_VERSION, CatalogResponseSchema, DeckListResponseSchema, DeckResponseSchema, DeckIdSchema,
  type CatalogCard, type DeckInput, type SavedDeck,
} from '@card-game/protocol';
import { builderConfig } from './config';
import type { PublicSessionClient } from '@card-game/browser-session';

/* The workshop is cookie-only. The browser holds an HttpOnly session cookie and
   `PublicSessionClient` derives the CSRF token for writes, so there is no bearer
   path here on purpose: the game client owns that credential, and a second
   implementation would be a second place for the two to drift apart. */
export class BuilderApi {
  constructor(private readonly browser: PublicSessionClient) {}
  private request(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.browser.request('/api/' + path, { method, body, signal });
  }
  async catalog(locale: string, signal?: AbortSignal): Promise<CatalogCard[]> {
    const cards: CatalogCard[] = [], seen = new Set<string>(), limit = builderConfig.pageSize;
    for (let offset = 0; offset < 10000; offset += limit) {
      /* The catalogue carries card text, so the language travels with the request:
         switching language re-fetches instead of showing a half-translated list. */
      const page = CatalogResponseSchema.parse(await this.request(`cards?offset=${offset}&limit=${limit}&locale=${encodeURIComponent(locale)}`, 'GET', undefined, signal));
      if (page.offset !== offset || page.limit !== limit || page.total > 10000 || page.cards.length !== Math.min(limit, Math.max(0, page.total - offset))) throw new Error('Incompatible catalog pagination. Reload to retry.');
      for (const card of page.cards) { if (seen.has(card.id)) throw new Error('Duplicate catalog identity. Reload to retry.'); seen.add(card.id); cards.push(card); }
      if (offset + limit >= page.total) return cards;
    }
    throw new Error('Catalog is too large.');
  }
  async decks(signal?: AbortSignal): Promise<SavedDeck[]> {
    const decks: SavedDeck[] = [], seen = new Set<string>(), limit = builderConfig.pageSize;
    for (let offset = 0; offset < 1000; offset += limit) {
      const page = DeckListResponseSchema.parse(await this.request(`decks?offset=${offset}&limit=${limit}`, 'GET', undefined, signal));
      if (page.offset !== offset || page.limit !== limit || page.total > 1000 || page.decks.length !== Math.min(limit, Math.max(0, page.total - offset))) throw new Error('Incompatible saved-deck pagination. Retry.');
      for (const deck of page.decks) { if (seen.has(deck.id)) throw new Error('Duplicate saved deck identity. Retry.'); seen.add(deck.id); decks.push(deck); }
      if (offset + limit >= page.total) return decks;
    }
    throw new Error('Saved deck list is too large.');
  }
  async save(deck: DeckInput, id?: string): Promise<SavedDeck> {
    if (id) DeckIdSchema.parse(id);
    const result = DeckResponseSchema.parse(await this.request('decks' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', { protocolVersion: PROTOCOL_VERSION, deck })).deck;
    if (id && result.id !== id) throw new Error('Incompatible saved deck identity.');
    return result;
  }
}
