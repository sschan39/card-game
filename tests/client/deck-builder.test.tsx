import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CardSurface } from '@card-game/ui';
import { validateDeck, type AuthResponse, type CatalogCard, type DeckInput, type SavedDeck } from '@card-game/protocol';
import App, { DeckPreview } from '@builder/App';
import { BuilderApi, BuilderApiError } from '@builder/api';
import { builderConfig } from '@builder/config';
import { changeCopies, deckCount, editableDeck, exportDeck, filterCatalog, importDeck, newDraft } from '@builder/model';
import { gameDeckUrl, gameDestination } from '@builder/handoff';
import { readDraft, readSession, writeDraft, writeSession, type StoragePort } from '@builder/storage';
import { ownedHandoffDeck, readDeckHandoff } from '@client/deck-handoff';

const id = '00000000-0000-4000-8000-000000000001';
const session: AuthResponse = { protocolVersion: 1, token: 't'.repeat(43), sessionId: 'session', expiresAt: 10000, scope: 'game', playerId: 'account:a', account: { id: 'a', username: 'alice', role: 'player' } };
const land: CatalogCard = { id: 'land-red', name: 'Mountain', manaCost: '', cardTypes: ['Land'], subTypes: ['Mountain'], rulesText: 'Add red mana.', colors: [], deckLegal: true, copyLimit: null };
const creature: CatalogCard = { id: 'empire-servant', name: 'Servant <script>', manaCost: '{R}', cardTypes: ['Creature'], subTypes: ['Soldier'], rulesText: '<img src=x onerror=alert(1)>', colors: ['R'], power: 1, toughness: 2, deckLegal: true, copyLimit: 4 };
const fixture: CatalogCard = { ...creature, id: 'rock', deckLegal: false };
const cards = [land, creature, fixture], catalog = new Map(cards.map(card => [card.id, card]));
const deck: DeckInput = { name: 'Workshop', format: 'standard', cards: [{ cardId: 'land-red', quantity: 56 }, { cardId: 'empire-servant', quantity: 4 }] };
const saved: SavedDeck = { ...deck, id, createdAt: 1, updatedAt: 1 };
const response = (body: unknown, status = 200): Response => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
function memory() {
  const values = new Map<string, string>();
  const storage: StoragePort = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
  return { values, storage };
}
afterEach(() => vi.unstubAllGlobals());

describe('public deck editor and shared validation', () => {
  it('adds and removes copies without mutating the draft, and removes empty entries', () => {
    const empty = newDraft(), one = changeCopies(empty, 'land-red', 1), two = changeCopies(one, 'land-red', 1);
    expect(empty.cards).toEqual([]); expect(deckCount(one)).toBe(1); expect(deckCount(two)).toBe(2);
    expect(changeCopies(two, 'land-red', -2).cards).toEqual([]);
    expect(changeCopies(one, '../invalid', 1)).toBe(one); expect(changeCopies(one, 'land-red', 250)).toBe(one);
  });
  it('uses the protocol validator for size, unlimited lands, copy limits, excluded and unknown cards', () => {
    expect(validateDeck(deck, catalog)).toEqual({ valid: true, deck });
    for (const [input, code] of [
      [{ ...deck, cards: [{ cardId: 'land-red', quantity: 59 }] }, 'size'],
      [{ ...deck, cards: [{ cardId: 'land-red', quantity: 55 }, { cardId: 'empire-servant', quantity: 5 }] }, 'copy_limit'],
      [{ ...deck, cards: [{ cardId: 'rock', quantity: 60 }] }, 'illegal_card'],
      [{ ...deck, cards: [{ cardId: 'missing-card', quantity: 60 }] }, 'unknown_card'],
    ] as const) {
      const result = validateDeck(input, catalog); expect(result.valid).toBe(false);
      if (!result.valid) expect(result.issues.some(issue => issue.code === code)).toBe(true);
    }
    expect(validateDeck({ ...deck, cards: [{ cardId: 'land-red', quantity: 60 }] }, catalog).valid).toBe(true);
  });
  it('combines search, type, color and eligibility filters without needing authenticated endpoints', () => {
    const base = { search: '', type: '', color: '', legalOnly: true };
    expect(filterCatalog(cards, base)).toEqual([land, creature]);
    expect(filterCatalog(cards, { ...base, search: ' SOLDIER ', type: 'Creature', color: 'R' })).toEqual([creature]);
    expect(filterCatalog(cards, { ...base, search: 'mana', color: 'colorless' })).toEqual([land]);
    expect(filterCatalog(cards, { ...base, legalOnly: false, search: 'rock' })).toEqual([fixture]);
    expect(filterCatalog(cards, { ...base, search: 'servant', type: 'Land' })).toEqual([]);
  });
  it('roundtrips stable IDs, special names and CRLF text while merging repeated imported IDs', () => {
    const input = { ...deck, name: 'A\n# format: injected "name"' };
    expect(importDeck(exportDeck(input).replace(/\n/g, '\r\n'))).toEqual({ ...input, cards: [...input.cards].sort((a, b) => a.cardId.localeCompare(b.cardId)) });
    expect(importDeck('30 land-red\n30 land-red').cards).toEqual([{ cardId: 'land-red', quantity: 60 }]);
    expect(validateDeck(importDeck('60 unknown-card'), catalog).valid).toBe(false);
  });
  it.each(['', '# comment', '0 land-red', '-1 land-red', '2 Land Name', '999 land-red', '250 land-red\n1 land-red', '# format: other\n60 land-red', '# name: broken\n60 land-red', 'x'.repeat(32769), '\n'.repeat(300)])('rejects invalid/bounded import atomically (case %#)', text => {
    const before = structuredClone(deck); expect(() => importDeck(text)).toThrow(); expect(deck).toEqual(before);
  });
  it('strips record metadata so a recovered local draft never carries authority to overwrite a saved ID', () => {
    expect(editableDeck(saved)).toEqual(deck);
    const { storage, values } = memory(); expect(writeDraft(storage, newDraft())).toBe(true); expect(readDraft(storage)).toEqual(newDraft());
    expect(writeDraft(storage, editableDeck(saved))).toBe(true);
    expect(readDraft(storage)).toEqual(deck); expect(values.get(builderConfig.draftKey)).not.toContain('createdAt');
    values.set(builderConfig.draftKey, JSON.stringify(saved)); expect(readDraft(storage)).toEqual(newDraft());
  });
});

describe('builder session and public UI boundaries', () => {
  it('uses its own per-tab key, rejects guest/admin/expired credentials and tolerates denied storage', () => {
    const { storage, values } = memory(); values.set('cardgame.authSession', JSON.stringify(session)); values.set('cardgame.adminSession.v1', JSON.stringify(session));
    expect(readSession(storage, 1)).toBeNull(); writeSession(storage, session); expect(readSession(storage, 1)).toEqual(session);
    for (const value of [{ ...session, scope: 'admin' }, { ...session, account: null }, { ...session, expiresAt: 1 }]) {
      storage.setItem(builderConfig.sessionKey, JSON.stringify(value)); expect(readSession(storage, 1)).toBeNull();
    }
    writeSession(storage, null); expect(values.has('cardgame.authSession')).toBe(true); expect(values.has('cardgame.adminSession.v1')).toBe(true);
    const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
    expect(readDraft(denied)).toEqual(newDraft()); expect(readSession(denied)).toBeNull(); expect(writeDraft(denied, deck)).toBe(false); expect(() => writeSession(denied, null)).not.toThrow();
  });
  it('renders the public workbench without login and disables saving', () => {
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain('Card catalog'); expect(html).toContain('Text import / export'); expect(html).toContain('Sign in above to save');
    expect(html).toMatch(/<button disabled="">Save deck<\/button>/); expect(html).not.toContain('/api/admin');
  });
  it('renders one shared printed face and escapes catalog text; live validation exposes rule messages', () => {
    const html = renderToStaticMarkup(createElement(CardSurface, { card: creature }));
    expect(html).toContain('class="card"'); expect(html).toContain('Servant &lt;script&gt;'); expect(html).toContain('1/2'); expect(html).not.toContain('<img');
    expect(renderToStaticMarkup(createElement(DeckPreview, { draft: deck, cards }))).toContain('Ready to save and play.');
    expect(renderToStaticMarkup(createElement(DeckPreview, { draft: { ...deck, cards: [{ cardId: 'rock', quantity: 60 }] }, cards }))).toContain('cannot be included');
  });
});

describe('builder API contracts', () => {
  it('pages public catalog data without a bearer and validates page counts and identity', async () => {
    const generated = Array.from({ length: 101 }, (_, i) => ({ ...land, id: 'card-' + i }));
    const fetcher = vi.fn().mockResolvedValueOnce(response({ protocolVersion: 1, cards: generated.slice(0, 100), total: 101, offset: 0, limit: 100 }))
      .mockResolvedValueOnce(response({ protocolVersion: 1, cards: generated.slice(100), total: 101, offset: 100, limit: 100 }));
    const controller = new AbortController(); expect(await new BuilderApi(fetcher).catalog(controller.signal)).toHaveLength(101);
    expect(fetcher.mock.calls[0][0]).toBe('/api/cards?offset=0&limit=100'); expect(fetcher.mock.calls[1][0]).toBe('/api/cards?offset=100&limit=100');
    expect(fetcher.mock.calls[0][1].headers).toEqual({}); expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal);
    fetcher.mockResolvedValue(response({ protocolVersion: 1, cards: [land, land], total: 2, offset: 0, limit: 100 })); await expect(new BuilderApi(fetcher).catalog()).rejects.toThrow('Duplicate');
    fetcher.mockResolvedValue(response({ protocolVersion: 1, cards: [], total: 101, offset: 0, limit: 100 })); await expect(new BuilderApi(fetcher).catalog()).rejects.toThrow('pagination');
  });
  it('sends credentials only to account login/register, refuses non-account/game sessions and verifies restored sessions', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(session)), api = new BuilderApi(fetcher);
    expect(await api.authenticate('login', 'alice', 'password')).toEqual(session);
    expect(fetcher.mock.calls[0][0]).toBe('/api/auth/login'); expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ protocolVersion: 1, username: 'alice', password: 'password' });
    fetcher.mockResolvedValue(response({ ...session, scope: 'admin' })); await expect(api.authenticate('login', 'alice', 'password')).rejects.toThrow('account session');
    const { token: _token, ...info } = session; fetcher.mockResolvedValue(response(info)); expect(await api.verify(session.token)).toEqual(info);
    expect(fetcher.mock.calls.at(-1)![0]).toBe('/api/auth/me'); expect(fetcher.mock.calls.at(-1)![1].headers.Authorization).toBe('Bearer ' + session.token);
  });
  it('creates/updates owned decks with strict envelopes, pages saved decks, and propagates validation/denial without treating failure as success', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ protocolVersion: 1, deck: saved })), api = new BuilderApi(fetcher);
    expect(await api.save(session.token, deck)).toEqual(saved); expect(fetcher.mock.calls[0][0]).toBe('/api/decks'); expect(fetcher.mock.calls[0][1].method).toBe('POST');
    expect(await api.save(session.token, deck, id)).toEqual(saved); expect(fetcher.mock.calls[1][0]).toBe('/api/decks/' + id); expect(fetcher.mock.calls[1][1].method).toBe('PUT');
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ protocolVersion: 1, deck });
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer ' + session.token);
    const first = Array.from({ length: 100 }, (_, i) => ({ ...saved, id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}` }));
    fetcher.mockResolvedValueOnce(response({ protocolVersion: 1, decks: first, total: 101, offset: 0, limit: 100 }))
      .mockResolvedValueOnce(response({ protocolVersion: 1, decks: [{ ...saved, id: '00000000-0000-4000-8000-000000000101' }], total: 101, offset: 100, limit: 100 }));
    expect(await api.decks(session.token)).toHaveLength(101);
    fetcher.mockResolvedValue(response({ protocolVersion: 1, message: 'Deck is invalid.', issues: [{ code: 'copy_limit', message: 'Use at most 4 copies.' }] }, 400)); await expect(api.save(session.token, deck)).rejects.toThrow('Use at most 4');
    fetcher.mockResolvedValue(response({ protocolVersion: 1, message: 'Sign in again.' }, 401)); await expect(api.decks(session.token)).rejects.toMatchObject({ status: 401 });
    fetcher.mockResolvedValue(response({ protocolVersion: 1, deck: { ...saved, id: '00000000-0000-4000-8000-000000000002' } })); await expect(api.save(session.token, deck, id)).rejects.toThrow('identity');
  });
  it('accepts already-expired logout but reports other logout failures', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ protocolVersion: 1, message: 'Expired' }, 401)), api = new BuilderApi(fetcher);
    await expect(api.logout(session.token)).resolves.toBeUndefined();
    fetcher.mockResolvedValue(response({ protocolVersion: 1, message: 'Failed' }, 500)); await expect(api.logout(session.token)).rejects.toBeInstanceOf(BuilderApiError);
  });
});

describe('owned deck game handoff', () => {
  it('passes only the saved ID to a configured HTTP(S) destination, clearing unrelated queries/fragments', () => {
    const url = new URL(gameDeckUrl('https://game.example/?token=bad#old', id));
    expect([...url.searchParams.keys()]).toEqual(['deckId']); expect(url.hash).toBe('');
    expect(readDeckHandoff(url.search)).toEqual({ kind: 'requested', id });
    for (const bad of ['javascript:alert(1)', 'file:///secret', 'https://user:pass@game.example/']) expect(() => gameDestination(bad)).toThrow();
    expect(() => gameDeckUrl('https://game.example/', '../bad')).toThrow();
  });
  it('rejects malformed/duplicate IDs and selects only a deck returned by the signed-in account list', () => {
    expect(readDeckHandoff('')).toEqual({ kind: 'none' });
    for (const query of ['?deckId=bad', '?deckId=' + id + '&deckId=' + id]) expect(readDeckHandoff(query)).toEqual({ kind: 'invalid' });
    const handoff = readDeckHandoff('?deckId=' + id);
    expect(ownedHandoffDeck(handoff, [])).toBeUndefined(); expect(ownedHandoffDeck(handoff, [saved])).toEqual(saved);
  });
});
