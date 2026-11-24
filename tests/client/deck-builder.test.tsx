import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CardSurface } from '@card-game/ui';
import { validateDeck, type AuthResponse, type CatalogCard, type DeckInput, type SavedDeck } from '@card-game/protocol';
import { PublicSessionClient } from '@card-game/browser-session';
import App, { DeckPreview } from '@builder/App';
import { BuilderApi } from '@builder/api';
import DeckLibrary from '@builder/components/DeckLibrary';
import { builderConfig } from '@builder/config';
import { changeCopies, setCopies, deckCount, editableDeck, exportDeck, filterCatalog, importDeck, newDraft } from '@builder/model';
import { gameDeckUrl, gameDestination } from '@builder/handoff';
import { readDraft, readDraftRecovery, recoverSavedDeck, readSession, writeDraft, writeSession, type StoragePort } from '@builder/storage';
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
  it('commits absolute quantities atomically under both card and total limits', () => {
    const one = { ...deck, cards: [{ cardId: land.id, quantity: 1 }] };
    const sixty = setCopies(one, land.id, 60, catalog);
    expect(sixty.error).toBeNull(); expect(deckCount(sixty.deck)).toBe(60); expect(deckCount(one)).toBe(1);
    expect(setCopies(sixty.deck, land.id, 250, catalog).error).toBeNull();
    for (const quantity of [-1, 0.5, NaN, Infinity, 251]) expect(setCopies(one, land.id, quantity, catalog).deck).toBe(one);
    expect(setCopies(deck, creature.id, 5, catalog).error).toContain('at most 4');
    const full = { ...deck, cards: [{ cardId: land.id, quantity: 246 }, { cardId: creature.id, quantity: 4 }] };
    expect(setCopies(full, land.id, 247, catalog).error).toContain('250 cards');
    expect(setCopies(deck, creature.id, 0, catalog).deck.cards).toEqual([{ cardId: land.id, quantity: 56 }]);
    expect(setCopies(deck, 'missing-card', 1, catalog).deck).toBe(deck);
    expect(setCopies(deck, fixture.id, 1, catalog).deck).toBe(deck);
  });
  it('explains empty and unnamed drafts without relaxing saved-deck validation', () => {
    const html = renderToStaticMarkup(createElement(DeckPreview, { draft: newDraft(), cards }));
    expect(html).toContain('0 / 60 minimum cards'); expect(html).toContain('maximum 250');
    expect(html).toContain('Give your deck a name'); expect(html).not.toContain('Invalid deck structure');
    expect(validateDeck(newDraft(), catalog).valid).toBe(false);
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
  it('excludes unresolved import entries from minimum deck progress', () => {
    const draft = importDeck('59 land-red\n2 missing-card');
    const html = renderToStaticMarkup(createElement(DeckPreview, { draft, cards }));
    expect(html).toContain('59 / 60 minimum cards');
    expect(html).toContain('2 cards need correction');
    expect(html).toContain('missing-card — Unknown card definition.');
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
  it('recovers an edited saved deck only after verifying the same account and owned record', async () => {
    const { storage } = memory(), target = { accountId: 'a', deckId: saved.id };
    const edited = { ...deck, name: 'Renamed after navigation' };
    expect(writeDraft(storage, edited, target)).toBe(true);
    const recovery = readDraftRecovery(storage);
    expect(recovery.draft).toEqual(edited);
    expect(recoverSavedDeck(recovery.target, undefined, [saved])).toBeNull();
    expect(recoverSavedDeck(recovery.target, 'other-account', [saved])).toBeNull();
    expect(recoverSavedDeck(recovery.target, 'a', [])).toBeNull();
    const record = recoverSavedDeck(recovery.target, 'a', [saved]);
    expect(record).toEqual(saved);
    const { token: _token, ...info } = session;
    const identity = { protocolVersion: 1, session: info, csrf: 'c'.repeat(43) };
    const fetcher = vi.fn().mockResolvedValueOnce(response(identity)).mockResolvedValue(response({ protocolVersion: 1, deck: { ...saved, ...edited } }));
    const api = new BuilderApi(new PublicSessionClient(fetcher));
    await api.save(recovery.draft, record!.id);
    expect(fetcher.mock.calls[1][0]).toBe('/api/decks/' + saved.id);
    expect(fetcher.mock.calls[1][1].method).toBe('PUT');
    await api.save(recovery.draft);
    expect(fetcher.mock.calls[2][0]).toBe('/api/decks');
    expect(fetcher.mock.calls[2][1].method).toBe('POST');
    expect(writeDraft(storage, newDraft())).toBe(true);
    expect(readDraftRecovery(storage).target).toBeNull();
  });
  it('migrates legacy drafts without guessing identity and rejects malformed recovery metadata', () => {
    const { storage, values } = memory();
    values.set(builderConfig.draftKey, JSON.stringify(deck));
    expect(readDraftRecovery(storage)).toEqual({ draft: deck, target: null });
    values.set(builderConfig.draftKey, JSON.stringify({ version: 2, draft: deck, target: { accountId: 'a', deckId: '../invalid' } }));
    expect(readDraftRecovery(storage)).toEqual({ draft: newDraft(), target: null });
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
  it('lands in the deck library and offers a public path to create or import a draft', () => {
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain('Deck library');
    expect(html).toContain('New deck');
    expect(html).toContain('>Import</button>');
    expect(html).not.toContain('Card catalog');
    expect(html).not.toContain('/api/admin');
  });
  it('opens details for the selected deck by ID without mixing its Play link with another deck', () => {
    const second = { ...saved, name: 'Other deck', id: '00000000-0000-4000-8000-000000000002', updatedAt: 2 };
    const html = renderToStaticMarkup(createElement(DeckLibrary, {
      decks: [saved, second], catalog, catalogReady: true, signedIn: true, loading: false, loadError: '', busy: false,
      canManage: true, selectedId: saved.id, onSelect: vi.fn(), onSignIn: vi.fn(), onRefresh: vi.fn(), onEdit: vi.fn(),
      onDuplicate: vi.fn(), onExport: vi.fn(), onDelete: vi.fn(), playUrl: deckId => '/play?deckId=' + deckId,
    }));
    expect(html).toContain('<h2>Workshop</h2>');
    expect(html).toContain('Servant &lt;script&gt;');
    expect(html).toContain('href="/play?deckId=' + saved.id + '"');
    expect(html).not.toContain('href="/play?deckId=' + second.id + '"');
  });
  it('renders one shared printed face and escapes catalog text; live validation exposes rule messages', () => {
    const html = renderToStaticMarkup(createElement(CardSurface, { card: creature }));
    expect(html).toContain('class="card"'); expect(html).toContain('Servant &lt;script&gt;'); expect(html).toContain('1/2'); expect(html).not.toContain('<img');
    expect(renderToStaticMarkup(createElement(DeckPreview, { draft: deck, cards }))).toContain('Ready to save and play.');
    expect(renderToStaticMarkup(createElement(DeckPreview, { draft: { ...deck, cards: [{ cardId: 'rock', quantity: 60 }] }, cards }))).toContain('cannot be included');
  });
});

describe('builder API contracts', () => {
  /* The workshop has no bearer path: every call goes through the HttpOnly cookie and
     `PublicSessionClient` derives the CSRF token for writes. These tests therefore
     drive a real client over a fake fetcher rather than a fake client, so the header
     and credential behaviour under test is the behaviour that ships. */
  const csrf = 'c'.repeat(43);
  const identity = { protocolVersion: 1, session: { protocolVersion: 1, sessionId: 'session', expiresAt: 10000, playerId: 'account:a', scope: 'game', account: { id: 'a', username: 'alice', role: 'player' } }, csrf };
  const client = (fetcher: typeof fetch) => new BuilderApi(new PublicSessionClient(fetcher));

  it('pages public catalog data without a credential and validates page counts and identity', async () => {
    const generated = Array.from({ length: 101 }, (_, i) => ({ ...land, id: 'card-' + i }));
    const fetcher = vi.fn().mockResolvedValueOnce(response({ protocolVersion: 1, cards: generated.slice(0, 100), total: 101, offset: 0, limit: 100 }))
      .mockResolvedValueOnce(response({ protocolVersion: 1, cards: generated.slice(100), total: 101, offset: 100, limit: 100 }));
    const controller = new AbortController(); expect(await client(fetcher).catalog(controller.signal)).toHaveLength(101);
    expect(fetcher.mock.calls[0][0]).toBe('/api/cards?offset=0&limit=100'); expect(fetcher.mock.calls[1][0]).toBe('/api/cards?offset=100&limit=100');
    expect(fetcher.mock.calls[0][1].headers).toEqual({}); expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal);
    expect(fetcher.mock.calls[0][1].credentials).toBe('include');
    fetcher.mockResolvedValue(response({ protocolVersion: 1, cards: [land, land], total: 2, offset: 0, limit: 100 })); await expect(client(fetcher).catalog()).rejects.toThrow('Duplicate');
    fetcher.mockResolvedValue(response({ protocolVersion: 1, cards: [], total: 101, offset: 0, limit: 100 })); await expect(client(fetcher).catalog()).rejects.toThrow('pagination');
  });
  it('derives the CSRF token before the first write and never sends a bearer', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(identity)).mockResolvedValueOnce(response({ protocolVersion: 1, deck: saved }));
    const api = client(fetcher);
    expect(await api.save(deck)).toEqual(saved);
    expect(fetcher.mock.calls[0][0]).toBe('/api/browser/me');
    expect(fetcher.mock.calls[1][0]).toBe('/api/decks'); expect(fetcher.mock.calls[1][1].method).toBe('POST');
    expect(fetcher.mock.calls[1][1].headers['X-CSRF-Token']).toBe(csrf);
    expect(fetcher.mock.calls[1][1].headers['X-Card-Game-Client']).toBe('browser-v1');
    expect(fetcher.mock.calls[1][1].headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ protocolVersion: 1, deck });
    /* The token is cached, so a second write must not re-read the identity. */
    fetcher.mockResolvedValueOnce(response({ protocolVersion: 1, deck: saved }));
    expect(await api.save(deck, id)).toEqual(saved);
    expect(fetcher.mock.calls[2][0]).toBe('/api/decks/' + id); expect(fetcher.mock.calls[2][1].method).toBe('PUT');
    expect(fetcher.mock.calls[2][1].headers['X-CSRF-Token']).toBe(csrf);
  });
  it('refuses a write when the browser has no session instead of sending an unauthenticated request', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ protocolVersion: 1, session: null, csrf: null }));
    await expect(client(fetcher).save(deck)).rejects.toMatchObject({ status: 401, message: 'Sign in to continue.' });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toBe('/api/browser/me');
  });
  it('deletes only a saved deck ID using the browser session', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(identity)).mockResolvedValueOnce(response(null, 204));
    const api = client(fetcher);
    await expect(api.remove('../invalid')).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(api.remove(id)).resolves.toBeUndefined();
    expect(fetcher.mock.calls[1][0]).toBe('/api/decks/' + id);
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: 'DELETE', headers: { 'X-CSRF-Token': csrf } });
  });
  it('pages saved decks and propagates validation/denial without treating failure as success', async () => {
    /* Path-aware: the first write of a fresh client reads the identity for its CSRF
       token, so a blanket mock would answer that read with a deck envelope. */
    let answer: () => Response = () => response({ protocolVersion: 1, deck: saved });
    const fetcher = vi.fn(async (input: string) => input === '/api/browser/me' ? response(identity) : answer());
    const api = client(fetcher as unknown as typeof fetch);
    const first = Array.from({ length: 100 }, (_, i) => ({ ...saved, id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}` }));
    let page = 0;
    answer = () => response(page++ === 0
      ? { protocolVersion: 1, decks: first, total: 101, offset: 0, limit: 100 }
      : { protocolVersion: 1, decks: [{ ...saved, id: '00000000-0000-4000-8000-000000000101' }], total: 101, offset: 100, limit: 100 });
    expect(await api.decks()).toHaveLength(101);
    answer = () => response({ protocolVersion: 1, message: 'Deck is invalid.', issues: [{ code: 'copy_limit', message: 'Use at most 4 copies.' }] }, 400); await expect(api.save(deck)).rejects.toThrow('Use at most 4');
    answer = () => response({ protocolVersion: 1, message: 'Sign in again.' }, 401); await expect(api.decks()).rejects.toMatchObject({ status: 401 });
    answer = () => response({ protocolVersion: 1, deck: { ...saved, id: '00000000-0000-4000-8000-000000000002' } }); await expect(api.save(deck, id)).rejects.toThrow('identity');
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
