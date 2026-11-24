import {
  PROTOCOL_VERSION, MAX_SAVED_DECKS_PER_ACCOUNT, DeckListResponseSchema, DeckResponseSchema, DeckIdSchema,
  type DeckInput, type SavedDeck,
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
  catalog(signal?: AbortSignal) {
    return this.browser.catalog(builderConfig.pageSize, signal);
  }
  async decks(signal?: AbortSignal): Promise<SavedDeck[]> {
    const decks: SavedDeck[] = [], seen = new Set<string>(), limit = builderConfig.pageSize;
    for (let offset = 0; offset < MAX_SAVED_DECKS_PER_ACCOUNT; offset += limit) {
      const page = DeckListResponseSchema.parse(await this.request(`decks?offset=${offset}&limit=${limit}`, 'GET', undefined, signal));
      if (page.offset !== offset || page.limit !== limit || page.total > MAX_SAVED_DECKS_PER_ACCOUNT || page.decks.length !== Math.min(limit, Math.max(0, page.total - offset))) throw new Error('Incompatible saved-deck pagination. Retry.');
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
  async remove(id: string): Promise<void> {
    DeckIdSchema.parse(id);
    await this.request('decks/' + id, 'DELETE');
  }
}
