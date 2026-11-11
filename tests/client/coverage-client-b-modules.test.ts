import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardView, SavedDeck, TargetPointer } from '@card-game/protocol';
import type { PlayerView } from '@card-game/protocol';
import { applyDeltaChanges, removeAtPath, setAtPath } from '@client/store/deltaReducer';
import { readGameLog, writeGameLog, clearGameLogs } from '@client/game-log-storage';
import { setStoredAuth } from '@client/session';
import { loadSavedDecks } from '@client/decks';
import { boardCardWidth, planDensity } from '@client/layout/density';
import { createTargetingState, isLegalTarget, legalTarget, needsTargets, refreshTargeting } from '@client/targeting';
import { createTestRoom, instantiateCard } from '../helpers/client-view-fixture';

const session = {
  protocolVersion: 1 as const, scope: 'game' as const, sessionId: 'session', playerId: 'player1',
  token: 'A'.repeat(43), expiresAt: Date.now() + 60_000, account: null,
};
const deck: SavedDeck = {
  id: '00000000-0000-4000-8000-000000000001', name: 'Deck', format: 'standard',
  cards: [{ cardId: 'land-red', quantity: 60 }], createdAt: 1, updatedAt: 1,
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});
const list = (offset: number, decks: SavedDeck[], total: number, limit = 100) => ({
  protocolVersion: 1, decks, total, offset, limit,
});

beforeEach(() => {
  const data: Record<string, string> = {};
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value; },
    get length() { return Object.keys(data).length; },
    key: (index: number) => Object.keys(data)[index] ?? null,
    removeItem: (key: string) => { delete data[key]; },
    clear: () => { for (const key of Object.keys(data)) delete data[key]; },
  });
  setStoredAuth(session);
});
afterEach(() => {
  setStoredAuth(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('delta reducer', () => {
  it('sets, inserts and removes values at object and array paths without mutating the source', () => {
    const source = { players: { p1: { hand: [{ id: 'a' }, { id: 'b' }] } }, battlefield: [{ id: 'x' }] };
    const updated = setAtPath(source, 'players.p1.hand[1].id', 'B');
    expect(updated.players.p1.hand[1].id).toBe('B');
    expect(source.players.p1.hand[1].id).toBe('b');

    const inserted = setAtPath(source, 'players.p1.hand[0]', { id: 'z' }, true);
    expect(inserted.players.p1.hand.map(card => card.id)).toEqual(['z', 'a', 'b']);

    const replaced = setAtPath(source, 'players.p1.hand[0]', { id: 'r' });
    expect(replaced.players.p1.hand.map(card => card.id)).toEqual(['r', 'b']);

    const added = setAtPath(source, 'battlefield[1]', { id: 'y' }, true);
    expect(added.battlefield.map(card => card.id)).toEqual(['x', 'y']);

    expect(removeAtPath(source, 'players.p1.hand[0]').players.p1.hand.map(card => card.id)).toEqual(['b']);
    expect(removeAtPath(source, 'players.p1.hand[0].id').players.p1.hand[0]).toEqual({});
    expect(removeAtPath(source, 'players.p1.hand[5]').players.p1.hand).toHaveLength(2);
    expect(removeAtPath(source, 'players.p1.hand[0]').players.p1.hand).not.toBe(source.players.p1.hand);
  });

  it('creates missing containers, recurses through arrays and leaves empty paths untouched', () => {
    expect(setAtPath({}, '', 1)).toEqual({});
    expect(removeAtPath({}, '')).toEqual({});
    expect(setAtPath({}, 'a.b.c', 3)).toEqual({ a: { b: { c: 3 } } });
    expect(setAtPath({}, 'a[0].b', 4)).toEqual({ a: [{ b: 4 }] });
    expect(setAtPath({ a: [] }, 'a[0].b', 5)).toEqual({ a: [{ b: 5 }] });
    expect(setAtPath({ a: [{}] }, 'a[0].b.c', 6)).toEqual({ a: [{ b: { c: 6 } }] });
    const missing = { a: 1 };
    expect(removeAtPath(missing, 'b.c')).toBe(missing);
    expect(removeAtPath({ a: [{ b: 1 }] }, 'a[0].b')).toEqual({ a: [{}] });
  });

  it('rejects prototype-polluting paths and applies ordered change lists', () => {
    expect(() => setAtPath({}, '__proto__.polluted', true)).toThrow('Unsafe delta path');
    expect(() => removeAtPath({}, 'a.constructor')).toThrow('Unsafe delta path');
    const room = { log: [{ seq: 1 }], players: { p1: { life: 20 } } };
    const next = applyDeltaChanges(room, [
      { op: 'update', path: 'players.p1.life', value: 18 },
      { op: 'add', path: 'log[0]', value: { seq: 0 } },
      { op: 'remove', path: 'log[2]' },
    ]);
    expect(next.players.p1.life).toBe(18);
    expect(next.log[0]).toEqual({ seq: 0 });
    expect(next.log).toHaveLength(2);
  });
});

describe('saved deck pagination', () => {
  it('aborts before requesting and pages until the declared total is reached', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(loadSavedDecks('token', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();

    const first = Array.from({ length: 100 }, (_, index) => ({ ...deck, id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` }));
    const second = [deck];
    fetcher.mockResolvedValueOnce(json(list(0, first, 101))).mockResolvedValueOnce(json(list(100, second, 101)));
    await expect(loadSavedDecks('token')).resolves.toHaveLength(101);
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/decks?offset=0&limit=100', expect.objectContaining({
      headers: { Authorization: 'Bearer token' },
    }));
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/decks?offset=100&limit=100', expect.anything());
  });

  it('reports server failures and incompatible pages', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    fetcher.mockResolvedValueOnce(json({}, 500));
    await expect(loadSavedDecks('token')).rejects.toThrow('Unable to load saved decks');

    for (const body of [
      list(0, [deck], 1001),
      list(1, [deck], 1),
      list(0, Array.from({ length: 101 }, () => deck), 101),
      { protocolVersion: 1, decks: [] },
      list(0, [], 0, 99),
    ]) {
      fetcher.mockResolvedValueOnce(json(body));
      await expect(loadSavedDecks('token')).rejects.toThrow('incompatible deck list');
    }
  });

  it('stops on an empty final page and accepts a complete page', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    fetcher.mockResolvedValueOnce(json(list(0, [deck], 1)));
    await expect(loadSavedDecks('token')).resolves.toEqual([deck]);

    fetcher.mockResolvedValueOnce(json(list(0, [], 10)));
    await expect(loadSavedDecks('token')).resolves.toEqual([]);
  });
});

describe('tab-local game log validation', () => {
  const key = 'cardgame.gameLog.session.room.player1';

  it('rejects primitive and malformed stored entries', () => {
    sessionStorage.setItem(key, JSON.stringify([null]));
    expect(readGameLog('room', 'player1', 10)).toEqual([]);
    sessionStorage.setItem(key, JSON.stringify({}));
    expect(readGameLog('room', 'player1', 10)).toEqual([]);
    sessionStorage.setItem(key, JSON.stringify([{ seq: 1, changes: 0, action: 42 }]));
    expect(readGameLog('room', 'player1', 10)).toEqual([]);
    sessionStorage.setItem(key, JSON.stringify([{ seq: -1, changes: 0 }]));
    expect(readGameLog('room', 'player1', 10)).toEqual([]);
    sessionStorage.setItem(key, JSON.stringify([{ seq: 1.5, changes: 0 }]));
    expect(readGameLog('room', 'player1', 10)).toEqual([]);
    sessionStorage.setItem(key, JSON.stringify([{ seq: 1, changes: 0, summary: 'x'.repeat(8001) }]));
    expect(readGameLog('room', 'player1', 10)).toEqual([]);
    sessionStorage.setItem(key, JSON.stringify([{ seq: 1, changes: 0, summary: 'ok' }]));
    expect(readGameLog('room', 'player1', 10)).toEqual([{ seq: 1, changes: 0, summary: 'ok' }]);
  });

  it('ignores oversized storage and works without a session', () => {
    sessionStorage.setItem(key, 'x'.repeat(1_000_001));
    expect(readGameLog('room', 'player1', 10)).toEqual([]);
    setStoredAuth(null);
    expect(readGameLog('room', 'player1', 10)).toEqual([]);
    expect(() => writeGameLog('room', 'player1', [{ seq: 1, changes: 0 }])).not.toThrow();
  });

  it('clears only this tab history and tolerates missing storage', () => {
    sessionStorage.setItem(key, JSON.stringify([{ seq: 1, changes: 0 }]));
    sessionStorage.setItem('other', 'keep');
    clearGameLogs();
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(sessionStorage.getItem('other')).toBe('keep');

    vi.stubGlobal('sessionStorage', undefined);
    expect(() => clearGameLogs()).not.toThrow();
  });
});

describe('battlefield density', () => {
  it('plans normal, dense, crowded, multi-row dense and extreme layouts', () => {
    expect(planDensity({ count: 0, availableWidth: 100, cardWidth: 100 }).rows).toEqual([]);
    expect(planDensity({ count: 1, availableWidth: 100, cardWidth: 100 })).toMatchObject({ mode: 'normal', scroll: false });
    expect(planDensity({ count: 2, availableWidth: 0, cardWidth: 100 })).toMatchObject({ mode: 'normal', scroll: false });
    expect(planDensity({ count: 3, availableWidth: 1000, cardWidth: 100 })).toMatchObject({ mode: 'normal', scroll: false });

    const dense = planDensity({ count: 10, availableWidth: 700, cardWidth: 92, gap: 10 });
    expect(dense.mode).toBe('dense');
    expect(dense.rows).toHaveLength(1);

    const crowded = planDensity({ count: 10, availableWidth: 430, cardWidth: 92, gap: 10 });
    expect(crowded.mode).toBe('crowded');

    const multiDense = planDensity({ count: 10, availableWidth: 370, cardWidth: 92, gap: 10 });
    expect(multiDense.mode).toBe('dense');
    expect(multiDense.rows.length).toBeGreaterThan(1);

    const extreme = planDensity({ count: 10, availableWidth: 100, cardWidth: 92, gap: 10 });
    expect(extreme.mode).toBe('extreme');
    expect(extreme.scroll).toBe(true);

    const multiCrowded = planDensity({ count: 10, availableWidth: 300, cardWidth: 92, gap: 10 });
    expect(multiCrowded.mode).toBe('crowded');
    expect(multiCrowded.rows.length).toBeGreaterThan(1);

    const singlePerRow = planDensity({ count: 2, availableWidth: 100, cardWidth: 92 });
    expect(singlePerRow.mode).toBe('extreme');
  });

  it('sizes board cards from height, width and bands with floors and ceilings', () => {
    expect(boardCardWidth({ width: 1440, height: 900 })).toBeGreaterThan(0);
    expect(boardCardWidth({ width: 1440, height: 900, bands: 2 })).toBeGreaterThan(0);
    expect(boardCardWidth({ width: 1440, height: 0 })).toBe(92);
    expect(boardCardWidth({ width: 1440, height: 900, min: 50, max: 60 })).toBe(60);
  });
});

describe('targeting drafts', () => {
  const target = (cardUuid: string, zoneRevision = 1): TargetPointer => ({ targetType: 'permanent', cardUuid, zoneRevision });
  function handCard(groups: CardView['targetGroups']) {
    return { ...instantiateCard('empire-servant'), targetGroups: groups };
  }
  function battlefieldCard(groups: CardView['targetGroups']) {
    return { ...instantiateCard('empire-servant'), targetGroups: groups };
  }

  it('creates drafts for cast and activated-ability target groups only', () => {
    const card = handCard({
      cast_spell: [{ id: 'g1', targeting: { type: 'permanent', required: true }, legalTargets: [target('a')] }],
      'activate_ability:draw': [{ id: 'g2', targeting: { type: 'player', required: true }, legalTargets: [] }],
    });
    expect(createTargetingState(card, 'hand', 'cast_spell')).toMatchObject({ cardUuid: card.uuid, groupIndex: 0 });
    expect(createTargetingState(card, 'hand', 'activate_ability', { abilityId: 'draw' })).toMatchObject({ groupIndex: 0 });
    expect(createTargetingState(card, 'hand', 'cast_spell', undefined, {} as PlayerView)).not.toBeNull();
    expect(createTargetingState({ ...card, targetGroups: {} }, 'hand', 'cast_spell')).toBeNull();
    expect(createTargetingState({ ...card, targetGroups: { cast_spell: [] } }, 'hand', 'cast_spell')).toBeNull();
  });

  it('resolves and checks legal targets', () => {
    const state = createTargetingState(handCard({
      cast_spell: [{ id: 'g1', targeting: { type: 'permanent', required: true }, legalTargets: [target('a')] }],
    }), 'hand', 'cast_spell');
    expect(legalTarget(state, target('a'))).toEqual(target('a'));
    expect(isLegalTarget(state, target('a'))).toBe(true);
    expect(isLegalTarget(state, target('b'))).toBe(false);
    expect(isLegalTarget(null, target('a'))).toBe(false);
    expect(legalTarget({ ...state!, groupIndex: undefined }, target('a'))).toEqual(target('a'));
  });

  it('reports cast targeting needs', () => {
    const card = handCard({ cast_spell: [{ id: 'g1', targeting: { type: 'permanent', required: true }, legalTargets: [] }] });
    expect(needsTargets(card)).toEqual({ type: 'permanent', required: true });
    expect(needsTargets({ ...card, targetGroups: {} })).toBeNull();
  });

  it('rebases drafts on fresh hand or battlefield cards and drops stale pointers', () => {
    const groups = { cast_spell: [{ id: 'g1', targeting: { type: 'permanent', required: true }, legalTargets: [target('a'), target('b')] }] };
    const card = handCard(groups);
    const room = createTestRoom();
    room.players.player1.hand = [card];
    const state = { cardUuid: card.uuid, zone: 'hand' as const, actionId: 'cast_spell' as const, groups: card.targetGroups.cast_spell,
      groupIndex: 0, completedGroups: [], targeting: groups.cast_spell[0].targeting, collected: [target('a')] };
    expect(refreshTargeting(state, room)).toMatchObject({ collected: [target('a')] });

    expect(refreshTargeting(null, room)).toBeNull();
    expect(refreshTargeting(state, { ...room, status: 'gameOver' })).toBeNull();
    expect(refreshTargeting(state, { ...room, players: { ...room.players, player1: { ...room.players.player1, hand: [] } } })).toBeNull();
    expect(refreshTargeting({ ...state, groups: [] }, room)).toBeNull();
    expect(refreshTargeting({ ...state, groups: [{ ...groups.cast_spell[0], id: 'other' }] }, room)).toBeNull();

    const stale = { ...state, completedGroups: [{ id: 'g1', targets: [target('z')] }] };
    expect(refreshTargeting(stale, room)?.groups).toEqual(card.targetGroups.cast_spell);

    const collectedMissing = { ...state, collected: [target('z')] };
    expect(refreshTargeting(collectedMissing, room)?.collected).toEqual([]);
    expect(refreshTargeting({ ...state, groupIndex: undefined }, room)?.groupIndex).toBeUndefined();

    const battlefield = { ...battlefieldCard(groups), uuid: card.uuid };
    const battleRoom = { ...room, battlefield: [battlefield] };
    const battleState = { ...state, zone: 'battlefield' as const };
    expect(refreshTargeting(battleState, battleRoom)?.groups).toEqual(card.targetGroups.cast_spell);
  });

  it('keeps matching targets with and without matching zone revisions', () => {
    const groups = { cast_spell: [{ id: 'g1', targeting: { type: 'permanent', required: true }, legalTargets: [target('a', 3)] }] };
    const card = handCard(groups);
    const room = createTestRoom();
    room.players.player1.hand = [card];
    const base = { cardUuid: card.uuid, zone: 'hand' as const, actionId: 'cast_spell' as const, groups: card.targetGroups.cast_spell,
      groupIndex: 0, completedGroups: [], targeting: groups.cast_spell[0].targeting, collected: [] };
    expect(refreshTargeting({ ...base, collected: [{ targetType: 'permanent', cardUuid: 'a' }] }, room)?.collected).toEqual([target('a', 3)]);
    expect(refreshTargeting({ ...base, collected: [target('a', 9)] }, room)?.collected).toEqual([]);
  });
});
