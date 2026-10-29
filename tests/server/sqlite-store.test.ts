import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SqliteStore } from '@server/stores/sqlite-store';
import { migrate, migrations } from '@server/stores/migrations';
import { backupDatabase } from '@server/stores/backup';
import { AuthService } from '@server/auth/service';
import { InMemoryStore } from '@server/rooms/state-store';
import { authConfig } from '@server/config';
import { hashPassword } from '@server/auth/password';
import type { AccountRecord } from '@server/auth/account-store';
import { tokenDigest } from '@server/auth/session';
import type { DeckInput } from '@card-game/protocol';
import { createRoom } from '@engine/room-factory';

const requireServer = createRequire(resolve('apps/server/package.json'));
const Database = requireServer('better-sqlite3') as typeof import('better-sqlite3');
const password = 'copper lantern river orchard';
const input: DeckInput = { name: 'Saved', format: 'standard', cards: [{ cardId: 'land-red', quantity: 60 }] };

describe('SQLite persistence and atomic auth', () => {
  let directory: string, filename: string, stores: SqliteStore[];
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'card-game-m3-')); filename = join(directory, 'game.sqlite'); stores = []; });
  afterEach(() => { vi.restoreAllMocks(); stores.forEach(store => store.close()); rmSync(directory, { recursive: true, force: true }); });
  const open = () => { const store = new SqliteStore(filename); stores.push(store); return store; };
  const account = (store: SqliteStore): AccountRecord => {
    const value: AccountRecord = { id: randomUUID(), username: 'alice', role: 'player', disabled: false, passwordHash: 'stored-hash', createdAt: 100 };
    expect(store.insertAccount(value)).toBe(true); return value;
  };

  it('persists accounts, scoped sessions and ordered decks but drops rooms and seats', async () => {
    let store = open();
    const service = new AuthService(store, new InMemoryStore(store, store), authConfig, () => 1000); await service.ready;
    const registered = await service.register({ username: 'alice', password });
    store.saveSeat({ roomId: 'ephemeral', playerId: 'seat', owner: 'account:' + registered.account!.id });
    const id = randomUUID(), record = { ...input, id, createdAt: 1000, updatedAt: 1000 };
    expect(store.createDeck(registered.account!.id, record)).toBe(true);
    store.close(); store = open();
    const restored = new AuthService(store, new InMemoryStore(store, store), authConfig, () => 1001); await restored.ready;
    expect(restored.sessions.validate(registered.token)?.subject.id).toBe(registered.account!.id);
    expect(store.findByUsername('alice')?.passwordHash).toMatch(/^\$argon2id/);
    expect(store.findDeck(registered.account!.id, id)).toEqual(record);
    expect(store.ownedSeat('ephemeral', 'account:' + registered.account!.id)).toBeUndefined();
    expect(new InMemoryStore(store, store).listRooms()).toEqual([]);
    const db = new Database(filename, { readonly: true });
    expect(db.prepare('SELECT digest FROM sessions').get()).toEqual({ digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    db.close();
    expect(readFileSync(filename).includes(Buffer.from(registered.token))).toBe(false);
  });

  it('retains expiry, logout and rotation across close/reopen, including admin scope', async () => {
    let store = open(), clock = 1000;
    let auth = new AuthService(store, new InMemoryStore(store, store), authConfig, () => clock); await auth.ready;
    await auth.bootstrapAdmin('operator', password);
    const first = await auth.login({ username: 'operator', password });
    const second = await auth.login({ username: 'operator', password });
    const admin = await auth.login({ username: 'operator', password, scope: 'admin' });
    auth.logout(second.token);
    store.close(); store = open(); auth = new AuthService(store, new InMemoryStore(store, store), authConfig, () => clock); await auth.ready;
    expect(auth.sessions.validate(first.token)).toBeUndefined(); expect(auth.sessions.validate(second.token)).toBeUndefined();
    expect(auth.sessions.validate(admin.token)?.scope).toBe('admin');
    clock = admin.expiresAt; expect(auth.sessions.validate(admin.token)).toBeUndefined();
    store.close(); store = open(); expect(store.sessions()).toHaveLength(0);
  });

  it('does not leave an account or revoke a valid login when session insertion fails', async () => {
    const store = open(), rooms = new InMemoryStore(store, store), auth = new AuthService(store, rooms, authConfig); await auth.ready;
    const session = await auth.register({ username: 'alice', password });
    const guest = auth.guest(); rooms.saveRoom(createRoom('waiting', guest.playerId));
    auth.claimSeat(auth.sessions.validate(guest.token)!, 'waiting', guest.playerId);
    const revoked = vi.fn(); auth.sessions.onRevoke(revoked);
    vi.spyOn(store, 'saveSession').mockImplementation(() => { throw new Error('Simulated disk failure'); });
    await expect(auth.register({ username: 'bob', password, roomId: 'waiting' }, guest.token)).rejects.toThrow('disk failure');
    expect(store.findByUsername('bob')).toBeUndefined(); expect(store.accountCount()).toBe(1);
    expect(store.seatOwner('waiting', guest.playerId)).toBe(guest.playerId); expect(auth.sessions.validate(guest.token)).toBeDefined();
    await expect(auth.login({ username: 'alice', password })).rejects.toThrow('disk failure');
    expect(auth.sessions.validate(session.token)).toBeDefined(); expect(revoked).not.toHaveBeenCalled();
  });

  it('enforces unique accounts and foreign keys and rolls back partial deck replacement', () => {
    const store = open(), owner = account(store), id = randomUUID();
    expect(store.insertAccount({ ...owner, id: randomUUID() })).toBe(false);
    expect(() => store.createDeck('missing-owner', { ...input, id, createdAt: 0, updatedAt: 0 })).toThrow();
    const record = { ...input, id, createdAt: 0, updatedAt: 0 }; store.createDeck(owner.id, record);
    expect(() => store.updateDeck(owner.id, id, { ...input, cards: [{ cardId: 'land-red', quantity: 30 }, { cardId: 'land-red', quantity: 30 }] }, 10)).toThrow();
    expect(store.findDeck(owner.id, id)).toEqual(record);
    expect(store.findDeck('other', id)).toBeUndefined(); expect(store.deleteDeck('other', id)).toBe(false);
    expect(store.updateDeck('other', id, input, 10)).toBeUndefined(); expect(store.listDecks('other', 0, 10).total).toBe(0);
  });

  it('reapplies migrations safely and rolls failed migrations back', () => {
    const db = new Database(':memory:');
    try {
      migrate(db); migrate(db);
      expect(() => migrate(db, [...migrations, { version: 4, sql: 'CREATE TABLE partial_write (id TEXT); INSERT INTO missing VALUES (1);' }])).toThrow();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='partial_write'").get()).toBeUndefined();
      expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
      db.prepare('INSERT INTO schema_migrations VALUES (99,0)').run(); expect(() => migrate(db)).toThrow('Unsupported');
    } finally { db.close(); }
  });

  it('persists browser families and child credentials and revokes the whole family after reopen', async () => {
    let store = open(), auth = new AuthService(store, new InMemoryStore(store, store), authConfig); await auth.ready;
    const parent = await auth.register({ username: 'alice', password }, undefined, true), child = auth.gameTab(auth.sessions.validate(parent.token)!);
    expect(auth.sessions.validate(child.token)?.parentDigest).toBe(tokenDigest(parent.token)); store.close();
    store = open(); auth = new AuthService(store, new InMemoryStore(store, store), authConfig); await auth.ready;
    expect(auth.sessions.validate(parent.token)?.kind).toBe('browser'); expect(auth.sessions.validate(child.token)?.kind).toBe('tab');
    const revoked = vi.fn(); auth.sessions.onRevoke(revoked); auth.logout(parent.token);
    expect(auth.sessions.validate(child.token)).toBeUndefined(); expect(revoked).toHaveBeenCalledTimes(2);
    expect(readFileSync(filename).includes(Buffer.from(child.token))).toBe(false); expect(readFileSync(filename).includes(Buffer.from(parent.token))).toBe(false);
  });

  it('upgrades the old schema without changing a valid legacy bearer identity', async () => {
    const old = new Database(filename), token = 'L'.repeat(43), id = randomUUID(); migrate(old, migrations.slice(0, 2));
    old.prepare('INSERT INTO accounts(id,username,role,password_hash,disabled,created_at) VALUES (?,?,?,?,?,?)').run(id, 'legacy', 'player', 'stored-hash', 0, 100);
    old.prepare('INSERT INTO sessions(digest,id,subject_kind,subject_id,account_id,scope,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)').run(tokenDigest(token), 'legacy-session', 'account', id, id, 'game', 100, Date.now() + 60000); old.close();
    const store = open(), auth = new AuthService(store, new InMemoryStore(store, store), authConfig); await auth.ready;
    expect(auth.sessions.validate(token)?.id).toBe('legacy-session'); expect(auth.sessions.validate(token)?.kind).toBeUndefined();
    expect(auth.playerId(auth.sessions.validate(token)!)).toBe('account:' + id);
  });
  it('binds an application database to one instance and refuses accidental live/lab reuse', () => {
    let store = new SqliteStore(filename, undefined, { instanceId: 'live-game', purpose: 'live' }); stores.push(store); store.close();
    expect(() => new SqliteStore(filename, undefined, { instanceId: 'isolated-lab', purpose: 'lab' })).toThrow('database instance identity');
    expect(() => new SqliteStore(filename, undefined, { instanceId: 'live-game', purpose: 'lab' })).toThrow('database instance identity');
    store = new SqliteStore(filename, undefined, { instanceId: 'live-game', purpose: 'live' }); stores.push(store); expect(store.accountCount()).toBe(0);
  });

  it('reuses a configured admin without changing its hash or promoting an existing player', async () => {
    const store = open(), auth = new AuthService(store, new InMemoryStore(store, store), authConfig); await auth.ready;
    await auth.bootstrapAdmin('operator', password);
    const original = store.findByUsername('operator'); await auth.bootstrapAdmin('operator', password);
    expect(store.findByUsername('operator')).toEqual(original);
    await expect(auth.bootstrapAdmin('operator', 'another sufficiently long password')).rejects.toThrow('do not match');
    store.insertAccount({ ...original!, id: randomUUID(), username: 'player', role: 'player', passwordHash: await hashPassword(password) });
    await expect(auth.bootstrapAdmin('player', password)).rejects.toThrow('unavailable');
    expect(store.findByUsername('player')?.role).toBe('player');
  });

  it('backs up committed WAL content without overwriting files or creating a missing source', async () => {
    const store = open(), owner = account(store), id = randomUUID();
    store.createDeck(owner.id, { ...input, id, createdAt: 1, updatedAt: 1 });
    const destination = join(directory, 'backups', 'snapshot.sqlite');
    await backupDatabase(filename, destination);
    const backup = new SqliteStore(destination); stores.push(backup);
    expect(backup.findDeck(owner.id, id)?.cards).toEqual(input.cards);
    await expect(backupDatabase(filename, destination)).rejects.toThrow('new file');
    await expect(backupDatabase(join(directory, 'absent'), join(directory, 'new'))).rejects.toThrow('does not exist');
  });
});
