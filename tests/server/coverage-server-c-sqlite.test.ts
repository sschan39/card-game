import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { newScenario, type AuditRecord, type DeckInput, type ScenarioRecord } from '@card-game/protocol';
import { SqliteStore } from '@server/stores/sqlite-store';
import { storageDefaults } from '@server/config';
import type { AccountRecord } from '@server/auth/account-store';
import { tokenDigest } from '@server/auth/session';

const deckInput: DeckInput = { name: 'Saved deck', format: 'standard', cards: [{ cardId: 'land-red', quantity: 60 }] };

function accountRecord(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id: randomUUID(),
    username: 'alice',
    role: 'player',
    passwordHash: 'stored-hash',
    disabled: false,
    createdAt: 100,
    ...overrides,
  };
}

function auditRecord(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: randomUUID(),
    timestamp: 500,
    actorId: null,
    action: 'rooms.list',
    target: 'rooms',
    outcome: 'success',
    ...overrides,
  };
}

function scenarioRecord(overrides: Partial<ScenarioRecord> = {}): ScenarioRecord {
  return {
    id: randomUUID(),
    revision: 1,
    scenario: newScenario(),
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  };
}

describe('SQLite store persistence', () => {
  let directory: string;
  let filename: string;
  let stores: SqliteStore[];
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'card-game-server-c-sqlite-'));
    filename = join(directory, 'nested', 'game.sqlite');
    stores = [];
  });
  afterEach(() => {
    stores.forEach(store => store.close());
    rmSync(directory, { recursive: true, force: true });
  });
  const open = (options: { settings?: typeof storageDefaults; identity?: { instanceId: string; purpose: 'development' | 'live' | 'lab' } } = {}) => {
    const store = new SqliteStore(filename, options.settings, options.identity);
    stores.push(store);
    return store;
  };

  it('creates the parent directory and opens an in-memory database without one', () => {
    const memory = new SqliteStore(':memory:');
    stores.push(memory);
    expect(memory.accountCount()).toBe(0);
    const store = open();
    expect(store.accountCount()).toBe(0);
    expect(store.findAccount('missing')).toBeUndefined();
  });

  it('binds the database to a single instance identity and rejects a different one', () => {
    const first = open({ identity: { instanceId: 'live-game', purpose: 'live' } });
    expect(first.accountCount()).toBe(0);
    expect(() => new SqliteStore(filename, undefined, { instanceId: 'isolated-lab', purpose: 'lab' })).toThrow('database instance identity');
    expect(() => new SqliteStore(filename, undefined, { instanceId: 'live-game', purpose: 'lab' })).toThrow('database instance identity');
    const reopened = open({ identity: { instanceId: 'live-game', purpose: 'live' } });
    expect(reopened.accountCount()).toBe(0);
  });

  it('closes the connection and rethrows when the database cannot be opened', () => {
    const corrupt = join(directory, 'corrupt.sqlite');
    writeFileSync(corrupt, 'this is not a sqlite database');
    expect(() => new SqliteStore(corrupt)).toThrow();
    writeFileSync(join(directory, 'invalid.sqlite'), 'still not sqlite');
    expect(() => new SqliteStore(join(directory, 'invalid.sqlite'), { ...storageDefaults, lockTimeoutMs: 50 })).toThrow();
  });

  it('persists account rows with unique usernames and immutable identity', () => {
    const store = open();
    const first = accountRecord();
    expect(store.findAccount(first.id)).toBeUndefined();
    expect(store.findByUsername(first.username)).toBeUndefined();
    expect(store.insertAccount(first)).toBe(true);
    expect(store.insertAccount({ ...first, id: randomUUID() })).toBe(false);
    expect(store.insertAccount(accountRecord({ username: 'bob', id: first.id }))).toBe(false);
    expect(store.findAccount(first.id)).toEqual(first);
    expect(store.findByUsername('alice')).toEqual(first);
    expect(store.accountCount()).toBe(1);

    store.saveAccount({ ...first, disabled: true, role: 'admin' });
    expect(store.findAccount(first.id)).toMatchObject({ disabled: true, role: 'admin' });
    expect(() => store.saveAccount(accountRecord({ id: randomUUID() }))).toThrow('identity cannot change');
    expect(() => store.saveAccount({ ...first, username: 'renamed' })).toThrow('identity cannot change');
    expect(store.activeAdminCount()).toBe(0);
    store.saveAccount({ ...first, disabled: false, role: 'admin' });
    expect(store.activeAdminCount()).toBe(1);
    store.saveAccount({ ...first, disabled: true, role: 'admin' });
    expect(store.activeAdminCount()).toBe(0);
  });

  it('lists accounts in creation order without password hashes', () => {
    const store = open();
    const ids = ['00000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b'];
    store.insertAccount(accountRecord({ id: ids[2], username: 'bob', createdAt: 5 }));
    store.insertAccount(accountRecord({ id: ids[1], username: 'alice', createdAt: 5 }));
    const adminId = ids[0];
    store.insertAccount(accountRecord({ id: adminId, username: 'carol', createdAt: 4, role: 'admin', disabled: true }));
    const page = store.listAccounts(0, 2);
    expect(page.total).toBe(3);
    expect(page.accounts.map(account => account.id)).toEqual([adminId, ids[1]]);
    expect(page.accounts[0]).toEqual({ id: adminId, username: 'carol', role: 'admin', disabled: true, createdAt: 4 });
    expect(page.accounts.some(account => 'passwordHash' in account)).toBe(false);
    expect(store.listAccounts(2, 10).accounts.map(account => account.id)).toEqual([ids[2]]);
  });

  it('round-trips audit rows and only exports them once', () => {
    const store = open();
    const first = auditRecord({ id: randomUUID() }), second = auditRecord({ actorId: randomUUID(), action: 'account.disable', target: 'account', outcome: 'denied' });
    store.appendAudit(first);
    store.appendAudit(second);
    expect(store.pendingAudit(10)).toEqual([first, second]);
    store.markAuditExported(first.id);
    expect(store.pendingAudit(10)).toEqual([second]);
    expect(store.pendingAudit(0)).toEqual([]);
  });

  it('persists legacy, browser and tab sessions with their parent digest', () => {
    const store = open();
    const owner = accountRecord();
    store.insertAccount(owner);
    const legacy = { id: 'legacy', digest: tokenDigest('a'.repeat(43)), subject: { kind: 'guest' as const, id: 'guest-one' }, scope: 'game' as const, createdAt: 1, expiresAt: 2 };
    store.saveSession(legacy);
    expect(store.findSession(legacy.digest)!.kind).toBeUndefined();
    expect(store.findSession(legacy.digest)!.parentDigest).toBeUndefined();
    const browserDigest = tokenDigest('b'.repeat(43));
    store.saveSession({ id: 'browser', digest: browserDigest, subject: { kind: 'account', id: owner.id }, scope: 'game', createdAt: 3, expiresAt: 4, kind: 'browser' });
    store.saveSession({ id: 'tab', digest: tokenDigest('c'.repeat(43)), subject: { kind: 'account', id: owner.id }, scope: 'game', createdAt: 5, expiresAt: 6, kind: 'tab', parentDigest: browserDigest });
    const sessions = store.sessions();
    expect(sessions.map(session => session.kind ?? 'legacy').sort()).toEqual(['browser', 'legacy', 'tab']);
    expect(store.findSession(browserDigest)!.kind).toBe('browser');
    expect(store.findSession(tokenDigest('c'.repeat(43)))!.parentDigest).toBe(browserDigest);
    expect(store.findSession('missing')).toBeUndefined();
    store.deleteSession(legacy.digest);
    expect(store.findSession(legacy.digest)).toBeUndefined();
  });

  it('keeps seats in process memory and restores them after a failed transaction', () => {
    const store = open();
    expect(store.ownedSeat('room', 'account:a')).toBeUndefined();
    expect(store.seatOwner('room', 'player1')).toBeUndefined();
    store.saveSeat({ roomId: 'room', playerId: 'player1', owner: 'account:a', accountId: 'a' });
    store.saveSeat({ roomId: 'room', playerId: 'player2', owner: 'guest:g' });
    store.saveSeat({ roomId: 'other', playerId: 'player1', owner: 'account:a', accountId: 'a' });
    expect(store.accountSeats('a')).toHaveLength(2);
    expect(store.accountSeats('b')).toEqual([]);
    expect(store.ownedSeat('room', 'guest:g')!.playerId).toBe('player2');
    expect(store.ownedSeat('missing', 'guest:g')).toBeUndefined();
    expect(store.seatOwner('room', 'player1')).toBe('account:a');
    expect(store.seatOwner('missing', 'player1')).toBeUndefined();
    expect(() => store.transaction(() => {
      store.saveSeat({ roomId: 'room', playerId: 'player3', owner: 'guest:x' });
      store.deleteSeat('room', 'player1');
      throw new Error('rollback');
    })).toThrow('rollback');
    expect(store.seatOwner('room', 'player1')).toBe('account:a');
    expect(store.seatOwner('room', 'player3')).toBeUndefined();
    expect(store.transaction(() => 'committed')).toBe('committed');
    store.deleteSeat('room', 'player2');
    expect(store.seatOwner('room', 'player2')).toBeUndefined();
    expect(() => store.deleteSeat('missing', 'player2')).not.toThrow();
    store.deleteRoomSeats('room');
    expect(store.ownedSeat('room', 'account:a')).toBeUndefined();
    expect(store.ownedSeat('other', 'account:a')).toBeDefined();
  });

  it('creates, reads, lists, updates and deletes ordered decks', () => {
    const store = open(), owner = accountRecord();
    store.insertAccount(owner);
    const id = randomUUID();
    const record = { ...deckInput, id, createdAt: 10, updatedAt: 10 };
    expect(store.findDeck(owner.id, id)).toBeUndefined();
    expect(store.createDeck(owner.id, record)).toBe(true);
    expect(store.createDeck(owner.id, record)).toBe(false);
    expect(store.findDeck(owner.id, id)).toEqual(record);
    expect(store.findDeck('other', id)).toBeUndefined();
    expect(store.listDecks(owner.id, 0, 10)).toEqual({ total: 1, decks: [record] });
    expect(store.listDecks('other', 0, 10)).toEqual({ total: 0, decks: [] });

    const updated = { name: 'Renamed deck', format: 'standard' as const, cards: [{ cardId: 'land-red', quantity: 30 }, { cardId: 'empire-servant', quantity: 4 }] };
    const after = store.updateDeck(owner.id, id, updated, 20);
    expect(after).toMatchObject({ id, name: 'Renamed deck', cards: updated.cards, createdAt: 10, updatedAt: 20 });
    expect(store.updateDeck('other', id, updated, 30)).toBeUndefined();
    expect(() => store.updateDeck(owner.id, id, { ...updated, cards: [{ cardId: 'land-red', quantity: 1 }, { cardId: 'land-red', quantity: 2 }] }, 40)).toThrow();
    expect(store.findDeck(owner.id, id)).toMatchObject({ name: 'Renamed deck', updatedAt: 20 });
    expect(store.deleteDeck('other', id)).toBe(false);
    expect(store.deleteDeck(owner.id, id)).toBe(true);
    expect(store.findDeck(owner.id, id)).toBeUndefined();
  });

  it('enforces the per-account deck quota, duplicate identifiers and foreign keys', () => {
    const store = new SqliteStore(filename, { ...storageDefaults, maxDecksPerAccount: 1 });
    stores.push(store);
    const owner = accountRecord();
    store.insertAccount(owner);
    const first = { ...deckInput, id: randomUUID(), createdAt: 1, updatedAt: 1 };
    expect(store.createDeck(owner.id, first)).toBe(true);
    expect(store.createDeck(owner.id, { ...deckInput, id: randomUUID(), createdAt: 2, updatedAt: 2 })).toBe(false);
    const other = accountRecord({ username: 'bob' });
    store.insertAccount(other);
    expect(store.createDeck(other.id, first)).toBe(false);
    expect(() => store.createDeck('missing-owner', { ...deckInput, id: randomUUID(), createdAt: 3, updatedAt: 3 })).toThrow();
    expect(store.listDecks(owner.id, 0, 10).total).toBe(1);
  });

  it('stores scenario records with optimistic revisions and paging', () => {
    const store = open();
    expect(store.listScenarios(0, 10)).toEqual({ records: [], total: 0 });
    expect(store.findScenario('missing')).toBeUndefined();
    const first = scenarioRecord({ id: '00000000-0000-4000-8000-00000000000a', updatedAt: 5 }), second = scenarioRecord({ id: '00000000-0000-4000-8000-00000000000b', updatedAt: 9 });
    expect(store.saveScenario(first, 0)).toBe(true);
    expect(store.saveScenario(first, 0)).toBe(false);
    expect(store.saveScenario(second, 0)).toBe(true);
    expect(store.findScenario(first.id)).toEqual(first);
    const page = store.listScenarios(0, 1);
    expect(page.total).toBe(2);
    expect(page.records.map(record => record.id)).toEqual([second.id]);
    expect(store.listScenarios(1, 10).records.map(record => record.id)).toEqual([first.id]);

    const revised = { ...first, revision: 2, updatedAt: 20, scenario: { ...first.scenario, name: 'Revised' } };
    expect(store.saveScenario(revised, 1)).toBe(true);
    expect(store.saveScenario({ ...revised, revision: 3 }, 1)).toBe(false);
    expect(store.findScenario(first.id)).toMatchObject({ revision: 2, updatedAt: 20 });
    expect(store.deleteScenario(first.id, 1)).toBe(false);
    expect(store.deleteScenario(first.id, 2)).toBe(true);
    expect(store.findScenario(first.id)).toBeUndefined();
  });

  it('exposes audit and scenario transactions and backs up committed data', async () => {
    const store = open(), owner = accountRecord();
    store.insertAccount(owner);
    expect(store.auditTransaction(() => 7)).toBe(7);
    expect(store.scenarioTransaction(() => 8)).toBe(8);
    const destination = join(directory, 'snapshot.sqlite');
    await store.backup(destination);
    const restored = new SqliteStore(destination);
    stores.push(restored);
    expect(restored.findByUsername(owner.username)).toEqual(owner);
    store.close();
    expect(() => store.close()).not.toThrow();
  });
});
