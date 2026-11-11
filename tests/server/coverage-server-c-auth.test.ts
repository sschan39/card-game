import { describe, expect, it } from 'vitest';
import express, { type ErrorRequestHandler, type Request, type RequestHandler } from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PROTOCOL_VERSION } from '@card-game/protocol';
import { authConfig, type AuthConfig } from '@server/config';
import {
  InMemoryAccountStore,
  sessionOwner,
  subjectKey,
  type AccountRecord,
  type AccountRepository,
  type SeatOwnership,
  type SessionRecord,
} from '@server/auth/account-store';
import { AuthService } from '@server/auth/service';
import { bootstrapAdmin } from '@server/auth/bootstrap';
import { bearerToken, createAuthRouter, inspectorIdentity, requireSession } from '@server/auth/routes';
import { AuthError } from '@server/auth/errors';
import { InMemoryStore } from '@server/rooms/state-store';
import { createTestRoom } from '../helpers/test-room-factory';

const password = 'copper-lantern-river-94!';

const accountRecord = (overrides: Partial<AccountRecord> = {}): AccountRecord => ({
  id: 'account-one',
  username: 'one',
  role: 'player',
  passwordHash: 'stored-hash',
  disabled: false,
  createdAt: 1,
  ...overrides,
});

const seatRecord = (overrides: Partial<SeatOwnership> = {}): SeatOwnership => ({
  roomId: 'room-1',
  playerId: 'player1',
  owner: 'guest:guest-one',
  ...overrides,
});

/** Expose one repository method with a deterministic substitute for a race window. */
function proxyRepository(store: InMemoryAccountStore, overrides: Partial<AccountRepository> = {}): AccountRepository {
  return new Proxy(store, {
    get(target, property) {
      if (Object.prototype.hasOwnProperty.call(overrides, property)) {
        return (overrides as Record<PropertyKey, unknown>)[property as string];
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }) as AccountRepository;
}

function makeAuth(overrides: Partial<AuthConfig> = {}, repository: AccountRepository = new InMemoryAccountStore()) {
  const store = new InMemoryStore(repository);
  return { auth: new AuthService(repository, store, { ...authConfig, ...overrides }), store, repository };
}

function sessionOf(auth: AuthService, token: unknown): SessionRecord {
  const session = auth.sessions.validate(token);
  if (!session) throw new Error('Expected a valid session');
  return session;
}

async function withAuthServer<T>(
  auth: AuthService,
  config: AuthConfig,
  run: (base: string) => Promise<T>,
  limited: RequestHandler = (_request, _response, next) => next(),
): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter(auth, config, limited));
  const errors: ErrorRequestHandler = (error, _request, response, _next) => {
    const status = error instanceof AuthError ? error.status : 500;
    response.status(status).json({ message: error instanceof Error ? error.message : 'Request failed.' });
  };
  app.use(errors);
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

describe('in-memory account repository', () => {
  it('commits successful transactions and restores every table after a failure', () => {
    const store = new InMemoryAccountStore();
    expect(store.transaction(() => 42)).toBe(42);
    store.insertAccount(accountRecord());
    store.saveSeat(seatRecord());
    expect(() =>
      store.transaction(() => {
        store.insertAccount(accountRecord({ id: 'account-two', username: 'two' }));
        store.saveSession({ id: 's1', digest: 'digest', subject: { kind: 'guest', id: 'g' }, scope: 'game', createdAt: 1, expiresAt: 2 });
        store.saveSeat(seatRecord({ playerId: 'player2' }));
        throw new Error('rollback');
      }),
    ).toThrow('rollback');
    expect(store.accountCount()).toBe(1);
    expect(store.findByUsername('two')).toBeUndefined();
    expect(store.sessions()).toEqual([]);
    expect(store.seatOwner('room-1', 'player2')).toBeUndefined();
    expect(store.seatOwner('room-1', 'player1')).toBe('guest:guest-one');
  });

  it('returns defensive copies of accounts and refuses identity changes', () => {
    const store = new InMemoryAccountStore();
    const account = accountRecord();
    expect(store.insertAccount(account)).toBe(true);
    account.username = 'mutated-outside';
    const found = store.findAccount('account-one')!;
    expect(found.username).toBe('one');
    found.username = 'mutated-copy';
    expect(store.findAccount('account-one')!.username).toBe('one');
    expect(store.findByUsername('missing')).toBeUndefined();
    expect(store.findByUsername('one')!.id).toBe('account-one');
    expect(() => store.saveAccount(accountRecord({ id: 'unknown' }))).toThrow('identity cannot change');
    expect(() => store.saveAccount(accountRecord({ username: 'renamed' }))).toThrow('identity cannot change');
    store.saveAccount(accountRecord({ disabled: true }));
    expect(store.findAccount('account-one')!.disabled).toBe(true);
  });

  it('rejects duplicate usernames and account identifiers', () => {
    const store = new InMemoryAccountStore();
    store.insertAccount(accountRecord());
    expect(store.insertAccount(accountRecord({ id: 'other' }))).toBe(false);
    expect(store.insertAccount(accountRecord({ username: 'other' }))).toBe(false);
    expect(store.accountCount()).toBe(1);
  });

  it('lists accounts in creation order without password hashes and counts active admins', () => {
    const store = new InMemoryAccountStore();
    store.insertAccount(accountRecord({ id: 'b', username: 'b', createdAt: 1 }));
    store.insertAccount(accountRecord({ id: 'a', username: 'a', createdAt: 1 }));
    store.insertAccount(accountRecord({ id: 'c', username: 'c', createdAt: 0 }));
    store.insertAccount(accountRecord({ id: 'admin', username: 'admin', role: 'admin', createdAt: 2 }));
    store.insertAccount(accountRecord({ id: 'off', username: 'off', role: 'admin', disabled: true, createdAt: 3 }));
    const page = store.listAccounts(0, 2);
    expect(page.total).toBe(5);
    expect(page.accounts.map(account => account.id)).toEqual(['c', 'a']);
    expect(page.accounts.some(account => 'passwordHash' in account)).toBe(false);
    expect(store.listAccounts(4, 10).accounts.map(account => account.id)).toEqual(['off']);
    expect(store.activeAdminCount()).toBe(1);
  });

  it('stores session rows as clones and deletes them by digest', () => {
    const store = new InMemoryAccountStore();
    const session: SessionRecord = { id: 's1', digest: 'digest-1', subject: { kind: 'guest', id: 'g' }, scope: 'game', createdAt: 1, expiresAt: 2 };
    store.saveSession(session);
    session.expiresAt = 99;
    const stored = store.findSession('digest-1')!;
    expect(stored.expiresAt).toBe(2);
    stored.expiresAt = 100;
    expect(store.sessions()[0].expiresAt).toBe(2);
    expect(store.findSession('unknown')).toBeUndefined();
    store.deleteSession('digest-1');
    expect(store.sessions()).toEqual([]);
  });

  it('tracks seat ownership per room, account and player', () => {
    const store = new InMemoryAccountStore();
    store.saveSeat(seatRecord({ roomId: 'room-1', playerId: 'player1', owner: 'account:acct', accountId: 'acct' }));
    store.saveSeat(seatRecord({ roomId: 'room-1', playerId: 'player2' }));
    store.saveSeat(seatRecord({ roomId: 'room-2', playerId: 'player1', owner: 'account:acct', accountId: 'acct' }));
    expect(store.accountSeats('acct').map(seat => seat.roomId + '/' + seat.playerId).sort()).toEqual(['room-1/player1', 'room-2/player1']);
    expect(store.accountSeats('other')).toEqual([]);
    expect(store.ownedSeat('room-1', 'guest:guest-one')!.playerId).toBe('player2');
    expect(store.ownedSeat('room-1', 'nobody')).toBeUndefined();
    expect(store.ownedSeat('missing-room', 'guest:guest-one')).toBeUndefined();
    expect(store.seatOwner('room-1', 'player1')).toBe('account:acct');
    expect(store.seatOwner('missing-room', 'player1')).toBeUndefined();
    expect(store.seatOwner('room-1', 'player3')).toBeUndefined();
    store.deleteSeat('room-1', 'player2');
    expect(store.seatOwner('room-1', 'player2')).toBeUndefined();
    expect(() => store.deleteSeat('missing-room', 'player1')).not.toThrow();
    store.deleteRoomSeats('room-1');
    expect(store.ownedSeat('room-1', 'account:acct')).toBeUndefined();
    expect(store.ownedSeat('room-2', 'account:acct')).toBeDefined();
  });

  it('derives stable subject keys and distinguishes tab owners', () => {
    expect(subjectKey({ kind: 'account', id: 'a' })).toBe('account:a');
    expect(subjectKey({ kind: 'guest', id: 'g' })).toBe('guest:g');
    const base: SessionRecord = { id: 's1', digest: 'digest', subject: { kind: 'account', id: 'a' }, scope: 'game', createdAt: 1, expiresAt: 2 };
    expect(sessionOwner(base)).toBe('account:a');
    expect(sessionOwner({ ...base, kind: 'tab' })).toBe('tab:s1');
  });
});

describe('operator admin bootstrap', () => {
  it('does nothing without configuration and rejects partial or ambiguous settings', async () => {
    const { auth, store } = makeAuth();
    await bootstrapAdmin(auth, {});
    expect(store.auth.accountCount()).toBe(0);
    await expect(bootstrapAdmin(auth, { ADMIN_BOOTSTRAP_PASSWORD: password })).rejects.toThrow('configuration');
    await expect(bootstrapAdmin(auth, { ADMIN_BOOTSTRAP_USERNAME: 'operator' })).rejects.toThrow('configuration');
    await expect(
      bootstrapAdmin(auth, { ADMIN_BOOTSTRAP_USERNAME: 'operator', ADMIN_BOOTSTRAP_PASSWORD: password, ADMIN_BOOTSTRAP_PASSWORD_FILE: 'file' }),
    ).rejects.toThrow('configuration');
  });

  it('rejects an oversized password file before reading it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'card-game-coverage-bootstrap-'));
    const file = join(directory, 'password');
    try {
      writeFileSync(file, 'x'.repeat(4097));
      const { auth } = makeAuth();
      await expect(bootstrapAdmin(auth, { ADMIN_BOOTSTRAP_USERNAME: 'operator', ADMIN_BOOTSTRAP_PASSWORD_FILE: file })).rejects.toThrow(
        'input limit',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects credentials that violate the shared account policy', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'card-game-coverage-bootstrap-'));
    const file = join(directory, 'password');
    try {
      writeFileSync(file, 'short\r\n');
      const { auth, store } = makeAuth();
      await expect(bootstrapAdmin(auth, { ADMIN_BOOTSTRAP_USERNAME: 'operator', ADMIN_BOOTSTRAP_PASSWORD_FILE: file })).rejects.toThrow(
        'account policy',
      );
      await expect(
        bootstrapAdmin(auth, { ADMIN_BOOTSTRAP_USERNAME: 'ab', ADMIN_BOOTSTRAP_PASSWORD: password }),
      ).rejects.toThrow('account policy');
      expect(store.auth.accountCount()).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('provisions from a newline-terminated file and is idempotent for the same operator password', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'card-game-coverage-bootstrap-'));
    const file = join(directory, 'password');
    try {
      writeFileSync(file, password + '\r\n');
      const { auth, store } = makeAuth();
      await bootstrapAdmin(auth, { ADMIN_BOOTSTRAP_USERNAME: 'Operator', ADMIN_BOOTSTRAP_PASSWORD_FILE: file });
      const account = store.auth.findByUsername('operator')!;
      expect(account.role).toBe('admin');
      await bootstrapAdmin(auth, { ADMIN_BOOTSTRAP_USERNAME: 'operator', ADMIN_BOOTSTRAP_PASSWORD: password });
      expect(store.auth.accountCount()).toBe(1);
      await expect(bootstrapAdmin(auth, { ADMIN_BOOTSTRAP_USERNAME: 'operator', ADMIN_BOOTSTRAP_PASSWORD: 'another-copper-river-94!' })).rejects.toThrow(
        'do not match',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects an existing identity that is not an active administrator', async () => {
    const { auth, store } = makeAuth();
    store.auth.insertAccount(accountRecord({ id: 'player', username: 'player', role: 'player' }));
    await expect(bootstrapAdmin(auth, { ADMIN_BOOTSTRAP_USERNAME: 'player', ADMIN_BOOTSTRAP_PASSWORD: password })).rejects.toThrow(
      'unavailable',
    );
    store.auth.insertAccount(accountRecord({ id: 'admin', username: 'admin', role: 'admin', disabled: true }));
    await expect(bootstrapAdmin(auth, { ADMIN_BOOTSTRAP_USERNAME: 'admin', ADMIN_BOOTSTRAP_PASSWORD: password })).rejects.toThrow(
      'unavailable',
    );
  });
});

describe('authentication HTTP routes', () => {
  it('serves guest, register, login, session inspection and logout with validation failures', async () => {
    const { auth, store } = makeAuth();
    const post = (base: string, path: string, body: unknown, token?: string) =>
      fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify(body),
      });
    await withAuthServer(auth, authConfig, async base => {
      expect((await post(base, '/api/auth/guest', {})).status).toBe(400);
      const guestResponse = await post(base, '/api/auth/guest', { protocolVersion: PROTOCOL_VERSION });
      expect(guestResponse.status).toBe(201);
      expect(guestResponse.headers.get('cache-control')).toBe('no-store');
      const guest = (await guestResponse.json()) as { token: string };

      expect((await post(base, '/api/auth/register', {})).status).toBe(400);
      expect(
        (
          await post(base, '/api/auth/register', {
            protocolVersion: PROTOCOL_VERSION,
            username: 'route-user',
            password,
          })
        ).status,
      ).toBe(201);
      const duplicate = await post(base, '/api/auth/register', { protocolVersion: PROTOCOL_VERSION, username: 'route-user', password });
      expect(duplicate.status).toBe(409);
      expect(await duplicate.text()).not.toContain(password);

      expect((await post(base, '/api/auth/login', {})).status).toBe(400);
      expect(
        (await post(base, '/api/auth/login', { protocolVersion: PROTOCOL_VERSION, username: 'route-user', password: 'wrong-password-value-1!' })).status,
      ).toBe(401);
      const login = await post(base, '/api/auth/login', { protocolVersion: PROTOCOL_VERSION, username: 'route-user', password });
      expect(login.status).toBe(200);
      const account = (await login.json()) as { token: string };

      const me = (token?: string) => fetch(base + '/api/auth/me', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
      expect((await me()).status).toBe(401);
      expect((await me(guest.token)).status).toBe(200);
      const browser = await auth.login({ username: 'route-user', password }, undefined, true);
      expect((await me(browser.token)).status).toBe(403);

      expect((await post(base, '/api/auth/logout', {})).status).toBe(400);
      expect((await post(base, '/api/auth/logout', { protocolVersion: PROTOCOL_VERSION })).status).toBe(401);
      expect((await post(base, '/api/auth/logout', { protocolVersion: PROTOCOL_VERSION }, account.token)).status).toBe(200);
      expect((await post(base, '/api/auth/logout', { protocolVersion: PROTOCOL_VERSION }, account.token)).status).toBe(401);
      expect(store.auth.accountCount()).toBe(1);
    });
  });

  it('restricts sign-out-all to public account sessions and validates request bodies', async () => {
    const { auth } = makeAuth();
    const post = (base: string, body: unknown, token?: string) =>
      fetch(base + '/api/auth/logout-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify(body),
      });
    await withAuthServer(auth, authConfig, async base => {
      expect((await post(base, {})).status).toBe(400);
      const guest = auth.guest();
      expect((await post(base, { protocolVersion: PROTOCOL_VERSION }, guest.token)).status).toBe(403);
      const login = await auth.login({ username: 'sign-out-user', password }).catch(() => undefined);
      expect(login).toBeUndefined();
      const registered = await auth.register({ username: 'sign-out-user', password });
      expect((await post(base, { protocolVersion: PROTOCOL_VERSION }, registered.token)).status).toBe(200);
      expect(auth.sessions.validate(registered.token)).toBeUndefined();
    });
  });

  it('applies the dedicated guest-session rate limit with a JSON 429', async () => {
    const { auth } = makeAuth();
    const config: AuthConfig = { ...authConfig, guestRateLimit: { windowMs: 900_000, limit: 1 } };
    await withAuthServer(auth, config, async base => {
      const body = JSON.stringify({ protocolVersion: PROTOCOL_VERSION });
      const headers = { 'Content-Type': 'application/json' };
      expect((await fetch(base + '/api/auth/guest', { method: 'POST', headers, body })).status).toBe(201);
      const limited = await fetch(base + '/api/auth/guest', { method: 'POST', headers, body });
      expect(limited.status).toBe(429);
      expect(await limited.json()).toMatchObject({ message: 'Too many guest sessions. Try again later.' });
    });
  });

  it('reports a guest-route failure instead of a success document', async () => {
    const { auth } = makeAuth({ maxSessions: 1 });
    await withAuthServer(auth, authConfig, async base => {
      const body = JSON.stringify({ protocolVersion: PROTOCOL_VERSION });
      const headers = { 'Content-Type': 'application/json' };
      expect((await fetch(base + '/api/auth/guest', { method: 'POST', headers, body })).status).toBe(201);
      const exhausted = await fetch(base + '/api/auth/guest', { method: 'POST', headers, body });
      expect(exhausted.status).toBe(503);
      expect(await exhausted.json()).toMatchObject({ message: 'Session capacity reached. Try again later.' });
    });
  });

  it('identifies inspectors only for active admin account sessions and parses bearer headers strictly', async () => {
    const { auth, store } = makeAuth();
    await auth.bootstrapAdmin('inspector', password);
    const admin = await auth.login({ username: 'inspector', password, scope: 'admin' });
    const game = await auth.login({ username: 'inspector', password });
    const guest = auth.guest();
    const request = (token?: string) => ({ headers: token ? { authorization: 'Bearer ' + token } : {} }) as unknown as Pick<Request, 'headers'>;
    expect(bearerToken(request())).toBeUndefined();
    expect(bearerToken({ headers: { authorization: ['Bearer abc'] } } as unknown as Pick<Request, 'headers'>)).toBeUndefined();
    expect(bearerToken({ headers: { authorization: 'Basic abc' } } as unknown as Pick<Request, 'headers'>)).toBeUndefined();
    expect(bearerToken({ headers: { authorization: 'Bearer short' } } as unknown as Pick<Request, 'headers'>)).toBeUndefined();
    expect(bearerToken(request(admin.token))).toBe(admin.token);

    expect(inspectorIdentity(auth, { headers: {} } as Request)).toBeNull();
    expect(inspectorIdentity(auth, request(game.token) as Request)).toBeNull();
    expect(inspectorIdentity(auth, request(guest.token) as Request)).toBeNull();
    expect(inspectorIdentity(auth, request(admin.token) as Request)).toEqual({ accountId: admin.account!.id, roles: ['admin'] });

    expect(() => requireSession(auth, { headers: {} } as Request)).toThrow('Authentication required');
    const browser = await auth.login({ username: 'inspector', password }, undefined, true);
    expect(() => requireSession(auth, request(browser.token) as Request)).toThrow('browser-session interface');
    expect(requireSession(auth, request(game.token) as Request).id).toBe(sessionOf(auth, game.token).id);

    const record = store.auth.findAccount(admin.account!.id)!;
    store.auth.saveAccount({ ...record, disabled: true });
    expect(inspectorIdentity(auth, request(admin.token) as Request)).toBeNull();
  });
});

describe('authentication service room and session policy', () => {
  it('derives guest and account player identifiers from owned seats', async () => {
    const { auth, store } = makeAuth();
    const room = createTestRoom({ roomId: 'room-seat' });
    store.saveRoom(room);
    const guest = auth.guest();
    const guestSession = sessionOf(auth, guest.token);
    expect(auth.playerId(guestSession)).toBe('guest:' + guestSession.subject.id);
    expect(auth.playerId(guestSession, room.roomId)).toBe('guest:' + guestSession.subject.id);
    auth.claimSeat(guestSession, room.roomId, 'player1');
    expect(auth.playerId(guestSession, room.roomId)).toBe('player1');
    expect(auth.info(guestSession, room.roomId).roomId).toBe(room.roomId);
    expect(auth.info(guestSession, 'missing-room').roomId).toBeUndefined();
    expect(auth.info(guestSession).account).toBeNull();
  });

  it('allows a guest to join but blocks an account that already occupies another live room', async () => {
    const { auth, store } = makeAuth();
    const first = createTestRoom({ roomId: 'room-first' });
    const second = createTestRoom({ roomId: 'room-second' });
    store.saveRoom(first);
    store.saveRoom(second);
    const guest = auth.guest();
    expect(() => auth.assertRoomAvailable(sessionOf(auth, guest.token), second.roomId)).not.toThrow();
    const account = await auth.register({ username: 'room-owner', password });
    const accountSession = sessionOf(auth, account.token);
    auth.claimSeat(accountSession, first.roomId, 'player1');
    expect(() => auth.assertRoomAvailable(accountSession, first.roomId)).not.toThrow();
    expect(() => auth.assertRoomAvailable(accountSession, second.roomId)).toThrow('already has a room');
    expect(auth.info(accountSession, first.roomId)).toMatchObject({ roomId: first.roomId, playerId: 'player1' });
  });

  it('rejects seats for browser and admin sessions and seats owned by another subject', async () => {
    const { auth, store } = makeAuth();
    const room = createTestRoom({ roomId: 'room-claims' });
    store.saveRoom(room);
    const guest = auth.guest();
    auth.claimSeat(sessionOf(auth, guest.token), room.roomId, 'player1');
    await expect(auth.register({ username: 'claim-user', password }, guest.token)).resolves.toBeDefined();
    const browser = await auth.login({ username: 'claim-user', password }, undefined, true);
    expect(() => auth.claimSeat(sessionOf(auth, browser.token), room.roomId, 'player2')).toThrow('game session');

    const adminAuth = makeAuth();
    await adminAuth.auth.bootstrapAdmin('claim-admin', password);
    const admin = await adminAuth.auth.login({ username: 'claim-admin', password, scope: 'admin' });
    expect(() => adminAuth.auth.claimSeat(sessionOf(adminAuth.auth, admin.token), room.roomId, 'player2')).toThrow('game session');

    const second = auth.guest();
    expect(() => auth.claimSeat(sessionOf(auth, second.token), room.roomId, 'player1')).toThrow('another account');
    expect(() => auth.claimSeat(sessionOf(auth, second.token), room.roomId, 'player2')).not.toThrow();
  });

  it('rejects a second game tab claiming the account seat of a different tab', async () => {
    const { auth, store } = makeAuth();
    const room = createTestRoom({ roomId: 'room-tabs' });
    store.saveRoom(room);
    const account = await auth.register({ username: 'tab-owner', password });
    const browser = await auth.login({ username: 'tab-owner', password }, undefined, true);
    const parent = sessionOf(auth, browser.token);
    const first = auth.gameTab(parent);
    const second = auth.gameTab(parent, undefined);
    const firstSession = sessionOf(auth, first.token), secondSession = sessionOf(auth, second.token);
    auth.claimSeat(firstSession, room.roomId, 'player1');
    expect(() => auth.claimSeat(secondSession, room.roomId, 'player2')).toThrow('Another game tab');
    expect(auth.sessions.validate(account.token)).toBeDefined();
  });

  it('requires complete guest ownership before linking a seat on registration', async () => {
    const { auth, store } = makeAuth();
    const room = createTestRoom({ roomId: 'room-link' });
    store.saveRoom(room);
    const guest = auth.guest();
    const noSeat = await auth.register({ username: 'no-seat', password, roomId: room.roomId }, guest.token).catch(error => error);
    expect(noSeat).toBeInstanceOf(AuthError);
    expect((noSeat as AuthError).message).toContain('does not own this seat');
    const playerSession = await auth.register({ username: 'player-prior', password });
    const bound = await auth.register({ username: 'account-prior', password, roomId: room.roomId }, playerSession.token);
    expect(bound.roomId).toBeUndefined();
    const noRoom = await auth.register({ username: 'no-room', password, roomId: 'missing-room' }, guest.token);
    expect(noRoom.roomId).toBeUndefined();
  });

  it('refuses to link a second seat in a room that the account already occupies', async () => {
    const { auth, store } = makeAuth();
    const room = createTestRoom({ roomId: 'room-conflict' });
    store.saveRoom(room);
    const guest = auth.guest();
    auth.claimSeat(sessionOf(auth, guest.token), room.roomId, 'player1');
    await auth.register({ username: 'linked-conflict', password, roomId: room.roomId }, guest.token);
    const other = auth.guest();
    auth.claimSeat(sessionOf(auth, other.token), room.roomId, 'player2');
    const conflict = await auth.login({ username: 'linked-conflict', password, roomId: room.roomId }, other.token).catch(error => error);
    expect((conflict as AuthError).status).toBe(409);
    expect((conflict as AuthError).message).toContain('another seat');
  });

  it('enforces session and account capacity before writing new rows', async () => {
    const { auth, store } = makeAuth({ maxSessions: 1 });
    const guest = auth.guest();
    await expect(auth.register({ username: 'capacity-user', password })).rejects.toThrow('capacity');
    expect(store.auth.findByUsername('capacity-user')).toBeUndefined();

    const room = createTestRoom({ roomId: 'room-capacity' });
    const big = makeAuth({ maxSessions: 3 });
    big.store.saveRoom(room);
    const account = await big.auth.register({ username: 'capacity-login', password });
    big.auth.logout(account.token);
    big.auth.guest();
    big.auth.guest();
    big.auth.guest();
    await expect(big.auth.login({ username: 'capacity-login', password })).rejects.toThrow('capacity');

    const accounts = makeAuth({ maxAccounts: 1 });
    await accounts.auth.register({ username: 'first-account', password });
    await expect(accounts.auth.register({ username: 'second-account', password })).rejects.toThrow('Account capacity');
    expect(accounts.store.auth.accountCount()).toBe(1);
    expect(guest.token).toBeTruthy();
  });

  it('reports an unavailable username when the repository insert loses a race', async () => {
    const repository = proxyRepository(new InMemoryAccountStore(), { insertAccount: () => false });
    const { auth } = makeAuth({}, repository);
    await expect(auth.register({ username: 'race-user', password })).rejects.toThrow('unavailable');
  });

  it('fails logins for unknown, disabled and concurrently changed accounts', async () => {
    const { auth, store } = makeAuth();
    await assertRejects(auth.login({ username: 'unknown', password }), 'Invalid username or password');
    const account = await auth.register({ username: 'changed-user', password });
    const record = store.auth.findAccount(account.account!.id)!;
    store.auth.saveAccount({ ...record, disabled: true });
    await assertRejects(auth.login({ username: 'changed-user', password }), 'Invalid username or password');
    store.auth.saveAccount({ ...record, disabled: false });

    const registered = await auth.register({ username: 'vanishing', password });
    const disappearing = proxyRepository(store.auth as InMemoryAccountStore, { findAccount: () => undefined });
    const second = makeAuth({}, disappearing);
    await assertRejects(second.auth.login({ username: 'vanishing', password }), 'Invalid username or password');
    expect(store.auth.accountCount()).toBe(2);
    expect(registered.token).toBeTruthy();
  });

  it('does not complete a login after the stored hash changes in flight', async () => {
    const { auth, store } = makeAuth();
    const account = await auth.register({ username: 'hash-race', password });
    const pending = auth.login({ username: 'hash-race', password });
    const record = store.auth.findAccount(account.account!.id)!;
    store.auth.saveAccount({ ...record, passwordHash: record.passwordHash.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')) });
    await assertRejects(pending, 'Invalid username or password');
  });

  it('rotates or preserves browser credentials according to their kind', async () => {
    const { auth } = makeAuth();
    const account = await auth.register({ username: 'browser-user', password });
    const first = await auth.login({ username: 'browser-user', password }, account.token, true);
    expect(auth.sessions.validate(account.token)).toBeDefined();
    const second = await auth.login({ username: 'browser-user', password }, first.token, true);
    expect(auth.sessions.validate(first.token)).toBeUndefined();
    expect(auth.sessions.validate(second.token)?.kind).toBe('browser');
    const adminAuth = makeAuth();
    await adminAuth.auth.bootstrapAdmin('browser-admin', password);
    const adminLogin = await adminAuth.auth.login({ username: 'browser-admin', password, scope: 'admin' });
    await assertRejects(
      adminAuth.auth.login({ username: 'browser-admin', password, scope: 'admin' }, adminLogin.token, true),
      'Public account session required',
    );
  });

  it('bounds concurrent password work and rejects admin scope for normal players', async () => {
    const { auth } = makeAuth({ maxPasswordOperations: 1 });
    await auth.ready;
    const pending = auth.register({ username: 'parallel-one', password });
    await expect(auth.register({ username: 'parallel-two', password })).rejects.toThrow('busy');
    await pending;
    const player = await auth.register({ username: 'normal-player', password });
    expect(player.scope).toBe('game');
    await assertRejects(auth.login({ username: 'normal-player', password, scope: 'admin' }), 'Admin role required');
  });

  it('refuses admin bootstrap when account or identity capacity is unavailable', async () => {
    const full = makeAuth({ maxAccounts: 1 });
    await full.auth.register({ username: 'existing-account', password });
    await expect(bootstrapAdmin(full.auth, { ADMIN_BOOTSTRAP_USERNAME: 'ops-capacity', ADMIN_BOOTSTRAP_PASSWORD: password })).rejects.toThrow(
      'Account capacity',
    );
    const raced = makeAuth({}, proxyRepository(new InMemoryAccountStore(), { insertAccount: () => false }));
    await expect(bootstrapAdmin(raced.auth, { ADMIN_BOOTSTRAP_USERNAME: 'ops-race', ADMIN_BOOTSTRAP_PASSWORD: password })).rejects.toThrow(
      'identity already exists',
    );
  });

  it('reuses a game tab only while it still owns the requested seat', async () => {
    const { auth, store } = makeAuth();
    const room = createTestRoom({ roomId: 'room-tab-owner' });
    store.saveRoom(room);
    const guest = auth.guest();
    auth.claimSeat(sessionOf(auth, guest.token), room.roomId, 'player1');
    await auth.register({ username: 'tab-seat-user', password });
    const login = await auth.login({ username: 'tab-seat-user', password }, undefined, true);
    const browserSession = sessionOf(auth, login.token);
    const issued = auth.gameTab(browserSession, guest.token, room.roomId);
    expect(issued.playerId).toBe('player1');
    expect(auth.gameTab(browserSession, issued.token, room.roomId).token).toBe(issued.token);
    const otherRoom = createTestRoom({ roomId: 'room-tab-foreign' });
    store.saveRoom(otherRoom);
    expect(() => auth.gameTab(browserSession, issued.token, otherRoom.roomId)).toThrow('does not own that room seat');
  });

  it('logs out a single session and signs out every game session for an account', async () => {
    const { auth } = makeAuth();
    const guest = auth.guest();
    expect(() => auth.logout('not-a-token')).toThrow('Authentication required');
    auth.logout(guest.token);
    expect(auth.sessions.validate(guest.token)).toBeUndefined();
    expect(() => auth.logoutAll('not-a-token')).toThrow('Authentication required');

    const account = await auth.register({ username: 'sign-out', password });
    const browser = await auth.login({ username: 'sign-out', password }, undefined, true);
    expect(() => auth.logoutAll(browser.token)).toThrow('Use a public account session');
    const gameTab = auth.gameTab(sessionOf(auth, browser.token));
    expect(() => auth.logoutAll(account.token)).not.toThrow();
    expect(auth.sessions.validate(account.token)).toBeUndefined();
    expect(auth.sessions.validate(gameTab.token)).toBeUndefined();
    const browserAgain = await auth.login({ username: 'sign-out', password }, undefined, true);
    expect(auth.sessions.validate(browserAgain.token)).toBeDefined();
    auth.logoutAll(browserAgain.token, true);
    expect(auth.sessions.validate(browserAgain.token)).toBeUndefined();
  });

  it('opens game tabs from a browser session without inventing seats', async () => {
    const { auth, store } = makeAuth();
    const room = createTestRoom({ roomId: 'room-game-tab' });
    store.saveRoom(room);
    const account = await auth.register({ username: 'game-tab', password });
    const browser = await auth.login({ username: 'game-tab', password }, undefined, true);
    const browserSession = sessionOf(auth, browser.token);
    const plain = auth.gameTab(browserSession);
    expect(plain.roomId).toBeUndefined();
    expect(auth.sessions.validate(plain.token)?.kind).toBe('tab');
    expect(auth.gameTab(browserSession, plain.token).token).toBe(plain.token);
    expect(auth.gameTab(browserSession, plain.token, 'missing-room').token).toBe(plain.token);
    expect(() => auth.gameTab(sessionOf(auth, account.token))).toThrow('Browser sign-in required');
    store.auth.deleteSession(browserSession.digest);
    expect(() => auth.gameTab(browserSession)).toThrow('Browser sign-in required');
  });

  it('rejects game-tab parents that are not live browser sessions', async () => {
    const { auth, store } = makeAuth();
    const account = await auth.register({ username: 'fake-parent', password });
    const game = sessionOf(auth, account.token);
    expect(() => auth.gameTab({ ...game, kind: 'browser', subject: { kind: 'guest', id: 'g' } })).toThrow('Browser sign-in required');
    const browser = await auth.login({ username: 'fake-parent', password }, undefined, true);
    expect(() => auth.gameTab(sessionOf(auth, browser.token), undefined, undefined)).not.toThrow();
    store.auth.saveSession({ ...game, kind: 'browser', subject: { kind: 'guest', id: 'g' }, digest: 'forged-digest' });
    expect(() => auth.gameTab({ ...game, kind: 'browser', subject: { kind: 'guest', id: 'g' }, digest: 'forged-digest' })).toThrow(
      'Browser sign-in required',
    );
  });

  it('requires the prior game session to prove ownership of the requested room seat', async () => {
    const { auth, store } = makeAuth();
    const room = createTestRoom({ roomId: 'room-proof' });
    store.saveRoom(room);
    await auth.register({ username: 'proof-user', password });
    const browser = await auth.login({ username: 'proof-user', password }, undefined, true);
    const browserSession = sessionOf(auth, browser.token);
    expect(() => auth.gameTab(browserSession, undefined, room.roomId)).toThrow('does not own that room seat');
    expect(() => auth.gameTab(browserSession, browser.token, room.roomId)).toThrow('does not own that room seat');
    const guest = auth.guest();
    expect(() => auth.gameTab(browserSession, guest.token, room.roomId)).toThrow('does not own that room seat');
    const other = await auth.register({ username: 'proof-other', password });
    expect(() => auth.gameTab(browserSession, other.token, room.roomId)).toThrow('does not own that room seat');
    expect(auth.gameTab(browserSession, undefined, 'missing-room').token).toBeDefined();
  });

  it('migrates a guest seat to the new game tab and revokes the guest token', async () => {
    const { auth, store } = makeAuth();
    const room = createTestRoom({ roomId: 'room-migrate' });
    store.saveRoom(room);
    const guest = auth.guest();
    auth.claimSeat(sessionOf(auth, guest.token), room.roomId, 'player1');
    const account = await auth.register({ username: 'migrate-user', password });
    const browser = await auth.login({ username: 'migrate-user', password }, undefined, true);
    const guest2 = auth.guest();
    auth.claimSeat(sessionOf(auth, guest2.token), room.roomId, 'player2');
    const issued = auth.gameTab(sessionOf(auth, browser.token), guest2.token, room.roomId);
    expect(issued.playerId).toBe('player2');
    expect(auth.sessions.validate(guest2.token)).toBeUndefined();
    expect(store.auth.seatOwner(room.roomId, 'player2')).toBe(sessionOwner(sessionOf(auth, issued.token)));
    expect(auth.sessions.validate(account.token)).toBeDefined();
  });

  it('rejects game tabs whose account already owns a different seat in the room', async () => {
    const { auth, store } = makeAuth();
    const room = createTestRoom({ roomId: 'room-tab-conflict' });
    store.saveRoom(room);
    const guest = auth.guest();
    auth.claimSeat(sessionOf(auth, guest.token), room.roomId, 'player1');
    await auth.register({ username: 'occupied-tab', password, roomId: room.roomId }, guest.token);
    const browser = await auth.login({ username: 'occupied-tab', password }, undefined, true);
    const guest2 = auth.guest();
    auth.claimSeat(sessionOf(auth, guest2.token), room.roomId, 'player2');
    expect(() => auth.gameTab(sessionOf(auth, browser.token), guest2.token, room.roomId)).toThrow('another seat');
  });

  it('does not reuse a tab from a different browser or another account', async () => {
    const { auth, store } = makeAuth();
    const room = createTestRoom({ roomId: 'room-other-account' });
    store.saveRoom(room);
    const account = await auth.register({ username: 'primary-tab', password });
    const firstBrowser = await auth.login({ username: 'primary-tab', password }, undefined, true);
    const secondBrowser = await auth.login({ username: 'primary-tab', password }, undefined, true);
    const tab = auth.gameTab(sessionOf(auth, firstBrowser.token));
    expect(() => auth.gameTab(sessionOf(auth, secondBrowser.token), tab.token, room.roomId)).toThrow('does not own that room seat');
    const otherAccount = await auth.register({ username: 'other-tab', password });
    expect(() =>
      auth.gameTab(sessionOf(auth, secondBrowser.token), otherAccount.token, room.roomId),
    ).toThrow('does not own that room seat');
    expect(auth.sessions.validate(otherAccount.token)).toBeDefined();
    expect(auth.sessions.validate(account.token)).toBeDefined();
  });

  it('opens a tab for a game session belonging to the same account', async () => {
    const { auth, store } = makeAuth();
    const room = createTestRoom({ roomId: 'room-same-account' });
    store.saveRoom(room);
    const guest = auth.guest();
    auth.claimSeat(sessionOf(auth, guest.token), room.roomId, 'player1');
    const account = await auth.register({ username: 'same-account', password, roomId: room.roomId }, guest.token);
    const gameSession = sessionOf(auth, account.token);
    const browser = await auth.login({ username: 'same-account', password }, undefined, true);
    const issued = auth.gameTab(sessionOf(auth, browser.token), account.token, room.roomId);
    expect(issued.playerId).toBe('player1');
    expect(auth.sessions.validate(account.token)).toBeUndefined();
    expect(gameSession.id).toBeDefined();
  });

  it('refuses admin-scoped prior sessions while keeping the admin session active', async () => {
    const { auth, store } = makeAuth();
    await auth.bootstrapAdmin('admin-tab', password);
    const admin = await auth.login({ username: 'admin-tab', password, scope: 'admin' });
    const browser = await auth.login({ username: 'admin-tab', password }, undefined, true);
    const room = createTestRoom({ roomId: 'room-admin-tab' });
    store.saveRoom(room);
    expect(() => auth.gameTab(sessionOf(auth, browser.token), admin.token, room.roomId)).toThrow('does not own that room seat');
    expect(auth.sessions.validate(admin.token)).toBeDefined();
  });
});

async function assertRejects(promise: Promise<unknown>, message: string): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AuthError);
  expect((error as AuthError).message).toContain(message);
}
