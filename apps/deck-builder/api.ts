import {
  PROTOCOL_VERSION, AuthResponseSchema, AuthErrorSchema, SessionInfoSchema, CatalogResponseSchema,
  DeckListResponseSchema, DeckResponseSchema, DeckIdSchema, DeckValidationErrorSchema,
  type AuthResponse, type CatalogCard, type DeckInput, type SavedDeck,
} from '@card-game/protocol';
import { builderConfig } from './config';
import type { PublicSessionClient } from '@card-game/browser-session';

export class BuilderApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export class BuilderApi {
  constructor(private readonly fetcher: typeof fetch = (...args) => fetch(...args), private readonly browser?: PublicSessionClient) {}
  private async request(path: string, method = 'GET', token?: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.browser && !token) return this.browser.request('/api/' + path, { method, body, signal });
    const response = await this.fetcher('/api/' + path, {
      method, signal, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      const invalid = DeckValidationErrorSchema.safeParse(data), error = AuthErrorSchema.safeParse(data);
      throw new BuilderApiError(invalid.success ? invalid.data.issues.map(issue => issue.message).join(' ') : error.success ? error.data.message : 'Request failed. Please retry.', response.status);
    }
    return data;
  }
  async catalog(signal?: AbortSignal): Promise<CatalogCard[]> {
    const cards: CatalogCard[] = [], seen = new Set<string>(), limit = builderConfig.pageSize;
    for (let offset = 0; offset < 10000; offset += limit) {
      const page = CatalogResponseSchema.parse(await this.request(`cards?offset=${offset}&limit=${limit}`, 'GET', undefined, undefined, signal));
      if (page.offset !== offset || page.limit !== limit || page.total > 10000 || page.cards.length !== Math.min(limit, Math.max(0, page.total - offset))) throw new Error('Incompatible catalog pagination. Reload to retry.');
      for (const card of page.cards) { if (seen.has(card.id)) throw new Error('Duplicate catalog identity. Reload to retry.'); seen.add(card.id); cards.push(card); }
      if (offset + limit >= page.total) return cards;
    }
    throw new Error('Catalog is too large.');
  }
  async authenticate(mode: 'login' | 'register', username: string, password: string): Promise<AuthResponse> {
    const result = AuthResponseSchema.parse(await this.request('auth/' + mode, 'POST', undefined, { protocolVersion: PROTOCOL_VERSION, username, password }));
    if (result.scope !== 'game' || !result.account) throw new Error('An account session is required.');
    return result;
  }
  async verify(token: string, signal?: AbortSignal) {
    const result = SessionInfoSchema.parse(await this.request('auth/me', 'GET', token, undefined, signal));
    if (result.scope !== 'game' || !result.account) throw new Error('An account session is required.');
    return result;
  }
  async logout(token: string): Promise<void> {
    try { await this.request('auth/logout', 'POST', token, { protocolVersion: PROTOCOL_VERSION }); }
    catch (error) { if (!(error instanceof BuilderApiError && error.status === 401)) throw error; }
  }
  async decks(token?: string, signal?: AbortSignal): Promise<SavedDeck[]> {
    const decks: SavedDeck[] = [], seen = new Set<string>(), limit = builderConfig.pageSize;
    for (let offset = 0; offset < 1000; offset += limit) {
      const page = DeckListResponseSchema.parse(await this.request(`decks?offset=${offset}&limit=${limit}`, 'GET', token, undefined, signal));
      if (page.offset !== offset || page.limit !== limit || page.total > 1000 || page.decks.length !== Math.min(limit, Math.max(0, page.total - offset))) throw new Error('Incompatible saved-deck pagination. Retry.');
      for (const deck of page.decks) { if (seen.has(deck.id)) throw new Error('Duplicate saved deck identity. Retry.'); seen.add(deck.id); decks.push(deck); }
      if (offset + limit >= page.total) return decks;
    }
    throw new Error('Saved deck list is too large.');
  }
  async save(token: string | undefined, deck: DeckInput, id?: string): Promise<SavedDeck> {
    if (id) DeckIdSchema.parse(id);
    const result = DeckResponseSchema.parse(await this.request('decks' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', token, { protocolVersion: PROTOCOL_VERSION, deck })).deck;
    if (id && result.id !== id) throw new Error('Incompatible saved deck identity.');
    return result;
  }
}
