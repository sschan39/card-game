import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { io as connect, type Socket } from 'socket.io-client';
import { AuthResponseSchema, PROTOCOL_VERSION, type AuthResponse, type PlayerView, type SessionInfo } from '@card-game/protocol';
import { createGameApplication } from '@server/application';
import { authConfig } from '@server/config';
import { InMemoryStore } from '@server/rooms/state-store';
import { presetFixture } from '@server/scenarios/presets';
import { tokenDigest } from '@server/auth/session';
import { getSetupPreset } from '@config';

// This file fills the remaining composition-boundary gaps of the real server
// application: startup failures, socket guard rails, lab capability gates and
// life-cycle callbacks. Every case drives the production HTTP/socket surface.
const password = 'coverage-server-a-passphrase-2026';
type App = ReturnType<typeof createGameApplication>;
type ClientView = { socket: Socket; room: PlayerView | undefined; identity: SessionInfo | undefined; errors: string[]; packets: { event: string; data: unknown }[] };

const apps: App[] = [];
const sockets: Socket[] = [];
const directories: string[] = [];

function listen(app: App): Promise<void> {
  return new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
}
function origin(app: App): string {
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Expected an ephemeral TCP port');
  return `http://127.0.0.1:${address.port}`;
}
async function start(options: Parameters<typeof createGameApplication>[0] = {}) {
  const app = createGameApplication({ environment: { NODE_ENV: 'test', DELTA_LOG_PATH: '' }, ...options });
  apps.push(app);
  await app.ready;
  await listen(app);
  return { app, url: origin(app) };
}
async function guest(url: string): Promise<AuthResponse> {
  const response = await fetch(url + '/api/auth/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION }) });
  expect(response.status).toBe(201);
  return AuthResponseSchema.parse(await response.json());
}
async function register(url: string, username: string): Promise<AuthResponse> {
  const response = await fetch(url + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, username, password }) });
  expect(response.status).toBe(201);
  return AuthResponseSchema.parse(await response.json());
}
function once<T>(socket: Socket, event: string, timeout = 2500): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, listener); reject(new Error('Timed out waiting for ' + event)); }, timeout);
    const listener = (value: T) => { clearTimeout(timer); resolve(value); };
    socket.once(event, listener);
  });
}
async function client(url: string, session: AuthResponse, roomId?: string): Promise<ClientView> {
  const socket = connect(url, { transports: ['websocket'], reconnection: false, autoConnect: false,
    auth: { protocolVersion: PROTOCOL_VERSION, token: session.token, ...(roomId ? { roomId } : {}) } });
  sockets.push(socket);
  const view: ClientView = { socket, room: undefined, identity: undefined, errors: [], packets: [] };
  socket.onAny((event, data) => view.packets.push({ event, data }));
  socket.on('roomSnapshot', ({ room }: { room: PlayerView }) => { view.room = room; });
  socket.on('error', ({ message }: { message: string }) => view.errors.push(message));
  const ready = once<SessionInfo>(socket, 'sessionReady');
  socket.connect();
  view.identity = await ready;
  return view;
}
async function rejected(url: string, token: string): Promise<Error> {
  const socket = connect(url, { transports: ['websocket'], reconnection: false, autoConnect: false,
    auth: { protocolVersion: PROTOCOL_VERSION, token } });
  sockets.push(socket);
  const failure = once<Error>(socket, 'connect_error');
  socket.connect();
  return failure;
}
async function createRoom(view: ClientView): Promise<string> {
  const created = once<{ roomId: string }>(view.socket, 'roomCreated');
  view.socket.emit('createRoom', { protocolVersion: PROTOCOL_VERSION });
  return (await created).roomId;
}
async function expectError(view: ClientView, packet: unknown, event: string, text: string): Promise<void> {
  const error = once<{ message: string }>(view.socket, 'error');
  view.socket.emit(event, packet);
  expect((await error).message).toContain(text);
}

afterEach(async () => {
  sockets.splice(0).forEach(socket => socket.disconnect());
  for (const app of apps.splice(0)) {
    await new Promise<void>(resolve => { if (app.server.listening) app.io.close(() => resolve()); else resolve(); });
  }
  directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true }));
  vi.restoreAllMocks();
});

describe('server application composition guards', { timeout: 20_000 }, () => {
  it('rejects choosing two storage providers at once and a blank database path', () => {
    expect(() => createGameApplication({ store: new InMemoryStore(), databasePath: 'data.sqlite' })).toThrow('Choose one storage provider');
    expect(() => createGameApplication({ databasePath: '   ' })).toThrow('Database path must not be empty');
  });

  it('builds room settings from the configured preset when fixtures are enabled', async () => {
    const { app } = await start({ configuration: { rooms: { preset: 'st01a' } } });
    const created = app.runtime.createRoom('preset-socket', 'preset-player');
    expect(created.room.setup?.developmentDeck).toEqual(getSetupPreset('st01a').developmentDeck);
    expect(created.room.setup?.developmentDeck.length).toBeGreaterThan(0);
  });

  it('reports a failed bootstrap on the HTTP readiness gate and the socket gate, then closes without an audit timer', async () => {
    const app = createGameApplication({ environment: { NODE_ENV: 'test', ADMIN_BOOTSTRAP_USERNAME: 'operator' } });
    try {
      await expect(app.ready).rejects.toThrow('Incomplete or ambiguous admin bootstrap configuration');
      await listen(app);
      const url = origin(app);
      const platform = await fetch(url + '/api/platform');
      expect(platform.status).toBe(500);
      expect(await platform.json()).toMatchObject({ protocolVersion: PROTOCOL_VERSION, message: 'Request could not be completed.' });
      // A socket that connects before bootstrap completes reports the same unavailable state.
      expect((await rejected(url, 'A'.repeat(43))).message).toContain('Authentication unavailable.');
    } finally {
      await new Promise<void>(resolve => app.io.close(() => resolve()));
    }
  });

  it('normalises a non-Error handshake failure into the unavailable connection error', async () => {
    const { app, url } = await start();
    const session = await guest(url);
    vi.spyOn(app.auth.sessions, 'validate').mockImplementationOnce(() => { throw 'opaque rejection'; });
    expect((await rejected(url, session.token)).message).toContain('Authentication unavailable.');
  });
});

describe('server application socket guard rails', { timeout: 20_000 }, () => {
  it('acknowledges auto-pass preferences only for the seated socket and rejects malformed or foreign ones', async () => {
    const { url } = await start();
    const session = await guest(url), view = await client(url, session);
    const roomId = await createRoom(view);
    const status = once<{ roomId: string; enabled: boolean; passAt: number | null }>(view.socket, 'autoPassStatus');
    view.socket.emit('setAutoPass', { protocolVersion: PROTOCOL_VERSION, roomId, enabled: true });
    expect(await status).toMatchObject({ roomId, enabled: true, passAt: null });
    await expectError(view, { roomId, enabled: true }, 'setAutoPass', 'Invalid auto-pass preference or room membership.');
    await expectError(view, { protocolVersion: PROTOCOL_VERSION, roomId: randomUUID(), enabled: false }, 'setAutoPass', 'Invalid auto-pass preference or room membership.');
  });

  it('validates leave packets, ignores rooms this tab is not seated in and releases a real seat', async () => {
    const { app, url } = await start();
    const session = await guest(url), seated = await client(url, session);
    const roomId = await createRoom(seated);
    await expectError(seated, 'not-a-packet', 'leaveRoom', 'Invalid leave room packet');
    await expectError(seated, { protocolVersion: 2, roomId }, 'leaveRoom', 'Invalid leave room packet');
    await expectError(seated, { protocolVersion: PROTOCOL_VERSION }, 'leaveRoom', 'Invalid leave room packet');
    await expectError(seated, { protocolVersion: PROTOCOL_VERSION, roomId: 42 }, 'leaveRoom', 'Invalid leave room packet');
    const before = seated.packets.length;
    seated.socket.emit('leaveRoom', { protocolVersion: PROTOCOL_VERSION, roomId: randomUUID() });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(seated.packets.slice(before).some(packet => packet.event === 'roomLeft')).toBe(false);
    expect(app.store.getRoom(roomId)).toBeDefined();

    const idle = await client(url, session);
    const idleLeft = once<{ roomId: string }>(idle.socket, 'roomLeft');
    idle.socket.emit('leaveRoom', { protocolVersion: PROTOCOL_VERSION, roomId: randomUUID() });
    expect((await idleLeft).roomId).toBeTruthy();
    await expectError(idle, { protocolVersion: PROTOCOL_VERSION, roomId }, 'leaveRoom', 'Not seated in this room');

    const departed = once<{ roomId: string }>(seated.socket, 'roomLeft');
    const sessionReady = once<SessionInfo>(seated.socket, 'sessionReady');
    seated.socket.emit('leaveRoom', { protocolVersion: PROTOCOL_VERSION, roomId });
    expect((await departed).roomId).toBe(roomId);
    expect((await sessionReady).playerId).toBe(session.playerId);
    expect(app.store.getRoom(roomId)).toBeUndefined();
    expect(seated.room?.roomId).toBe(roomId);
  });

  it('guards create and join with current-room, deck, not-found, duplicate-seat and capacity outcomes', async () => {
    const { app, url } = await start();
    const host = await client(url, await guest(url)), roomId = await createRoom(host);
    await expectError(host, { protocolVersion: PROTOCOL_VERSION }, 'createRoom', 'Leave the current room first.');
    const savedDeckGuest = await client(url, await guest(url));
    await expectError(savedDeckGuest, { protocolVersion: PROTOCOL_VERSION, deckId: randomUUID() }, 'createRoom', 'Sign in to play a saved deck.');
    await expectError(savedDeckGuest, {}, 'joinRoom', 'Invalid join room packet');
    await expectError(savedDeckGuest, { protocolVersion: PROTOCOL_VERSION, roomId: randomUUID() }, 'joinRoom', 'Room not found');
    await expectError(host, { protocolVersion: PROTOCOL_VERSION, roomId: randomUUID() }, 'joinRoom', 'Leave the current room first.');

    const second = await client(url, await guest(url));
    second.socket.emit('joinRoom', { protocolVersion: PROTOCOL_VERSION, roomId });
    await vi.waitFor(() => expect(host.room?.status).toBe('RPS'), { timeout: 4000 });
    const third = await client(url, await guest(url));
    const full = once<{ protocolVersion: number }>(third.socket, 'roomFull');
    third.socket.emit('joinRoom', { protocolVersion: PROTOCOL_VERSION, roomId });
    expect((await full).protocolVersion).toBe(PROTOCOL_VERSION);

    // Seat bookkeeping can disappear while the runtime still owns the membership;
    // the duplicate join is refused from the authoritative room rather than a seat row.
    const duplicate = await client(url, await guest(url)), duplicateRoom = await createRoom(duplicate);
    app.store.auth.deleteRoomSeats(duplicateRoom);
    await expectError(duplicate, { protocolVersion: PROTOCOL_VERSION, roomId: duplicateRoom }, 'joinRoom', 'Already seated in this room');

    const decode = once<{ message: string; commandId?: string; action?: string }>(host.socket, 'error');
    host.socket.emit('playerAction', { protocolVersion: PROTOCOL_VERSION, roomId, commandId: 'decode-command', actionId: 'activate_ability', abilityId: 'ability:forged', cardUuid: randomUUID() });
    expect(await decode).toMatchObject({ message: 'Invalid action option', commandId: 'decode-command', action: 'activate_ability' });
    await expectError(host, null, 'playerAction', 'Invalid player action packet');
  });

  it('reports unexpected deck failures without leaking details on create and join', async () => {
    const { app, url } = await start();
    const host = await client(url, await guest(url)), roomId = await createRoom(host);
    const owner = await client(url, await register(url, 'deck-failure-owner'));
    vi.spyOn(app.decks, 'matchCards').mockImplementation(() => { throw new Error('private deck store failure'); });
    const created = once<{ message: string }>(owner.socket, 'error');
    owner.socket.emit('createRoom', { protocolVersion: PROTOCOL_VERSION, deckId: randomUUID() });
    expect((await created).message).toBe('Deck selection failed.');
    const joiner = await client(url, await register(url, 'deck-failure-joiner'));
    const joined = once<{ message: string }>(joiner.socket, 'error');
    joiner.socket.emit('joinRoom', { protocolVersion: PROTOCOL_VERSION, roomId, deckId: randomUUID() });
    expect((await joined).message).toBe('Deck selection failed.');
  });
});

describe('server application rejoin and account room ownership', { timeout: 20_000 }, () => {
  it('restores an owned seat through joinRoom without a handshake room hint', async () => {
    const { app, url } = await start();
    const account = await register(url, 'restoring-owner');
    const first = await client(url, account), roomId = await createRoom(first);
    expect(app.store.auth.ownedSeat(roomId, 'account:' + account.account!.id)).toBeDefined();
    first.socket.disconnect();
    const second = await client(url, account);
    expect(second.identity!.roomId).toBeUndefined();
    const rejoined = once<{ roomId: string; playerId: string }>(second.socket, 'rejoined');
    second.socket.emit('joinRoom', { protocolVersion: PROTOCOL_VERSION, roomId });
    expect((await rejoined).roomId).toBe(roomId);
    await vi.waitFor(() => expect(second.room?.roomId).toBe(roomId), { timeout: 4000 });
    expect(app.store.getRoom(roomId)).toBeDefined();
  });

  it('falls back to the ordinary join path when a reclaimed seat no longer matches the departed player', async () => {
    const { app, url } = await start();
    const account = await register(url, 'departed-owner');
    const owner = await client(url, account), roomId = await createRoom(owner);
    const opponent = await client(url, await guest(url));
    opponent.socket.emit('joinRoom', { protocolVersion: PROTOCOL_VERSION, roomId });
    await vi.waitFor(() => expect(opponent.room?.status).toBe('RPS'), { timeout: 4000 });
    const left = once<{ roomId: string }>(owner.socket, 'roomLeft');
    owner.socket.emit('leaveRoom', { protocolVersion: PROTOCOL_VERSION, roomId });
    expect((await left).roomId).toBe(roomId);
    expect(app.store.auth.ownedSeat(roomId, 'account:' + account.account!.id)).toBeUndefined();
    // The seat claim is restored by policy, but the room's departure record still rejects it.
    app.auth.claimSeat(app.auth.sessions.validate(account.token)!, roomId, account.account!.id);
    const returning = await client(url, account);
    const refused = once<{ protocolVersion: number }>(returning.socket, 'roomFull');
    returning.socket.emit('joinRoom', { protocolVersion: PROTOCOL_VERSION, roomId });
    expect((await refused).protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('refuses a sibling tab joining the room another tab of the same account owns', async () => {
    const { app, url } = await start();
    const account = await register(url, 'sibling-owner');
    const parent = app.auth.sessions.issue({ kind: 'account', id: account.account!.id }, 'game', { kind: 'browser' });
    const first = app.auth.gameTab(parent.record), second = app.auth.gameTab(parent.record);
    const owner = await client(url, first), roomId = await createRoom(owner);
    const sibling = await client(url, second);
    const denied = once<{ message: string }>(sibling.socket, 'error');
    sibling.socket.emit('joinRoom', { protocolVersion: PROTOCOL_VERSION, roomId });
    expect((await denied).message).toContain('Another game tab owns this account');
    expect(app.store.getRoom(roomId)?.player2Id).toBeNull();
  });
});

describe('server application lab capability and session expiry', { timeout: 20_000 }, () => {
  it('gates lab claims behind the capability, a strict body and a game session, and refuses ordinary test-room joins', async () => {
    const { app, url } = await start({ configuration: { lab: { enabled: true, maxRooms: 2 }, inspectionEnabled: true,
      navigation: { instanceId: 'coverage-server-a-lab', purpose: 'lab' } } });
    const one = await app.auth.register({ username: 'lab-one', password }), two = await app.auth.register({ username: 'lab-two', password });
    const record = app.scenarios.save(presetFixture('development').scenario);
    const run = app.scenarios.launch(record.id, record.revision, [one.account!.id, two.account!.id], one.account!.id);
    const claim = (body: unknown, token?: string) => fetch(`${url}/api/lab/rooms/${run.roomId}/claim`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
    expect((await claim({ protocolVersion: PROTOCOL_VERSION })).status).toBe(401);
    expect((await claim({ protocolVersion: PROTOCOL_VERSION, extra: true })).status).toBe(400);
    expect((await claim({ protocolVersion: 2 })).status).toBe(400);
    expect((await claim({ protocolVersion: PROTOCOL_VERSION }, one.token)).status).toBe(200);

    const ordinary = await client(url, await guest(url));
    await expectError(ordinary, { protocolVersion: PROTOCOL_VERSION, roomId: run.roomId }, 'joinRoom', 'Claim an assigned test seat before reconnecting.');

    const plain = await start();
    const disabled = await fetch(`${plain.url}/api/lab/rooms/${run.roomId}/claim`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION }) });
    expect(disabled.status).toBe(404);
  });

  it('reschedules a live expiry timer and ends the socket when the session expires', async () => {
    let clock = Date.now();
    const { app, url } = await start({ settings: { ...authConfig, guestTtlMs: 150, sessionTtlMs: 150 }, now: () => clock });
    const session = await guest(url), view = await client(url, session);
    const validated = vi.spyOn(app.auth.sessions, 'validateDigest');
    // While the clock is frozen the timer keeps observing a live session and reschedules itself.
    await vi.waitFor(() => expect(validated.mock.calls.length).toBeGreaterThan(0), { timeout: 3000 });
    const ended = once<{ reason: string }>(view.socket, 'sessionEnded'), disconnected = once<void>(view.socket, 'disconnect');
    clock += 151;
    expect((await ended).reason).toBe('expired');
    await disconnected;
    expect(view.socket.connected).toBe(false);
    expect(app.store.listRooms()).toEqual([]);
  });

  it('retires a connected socket on its next packet when the session row disappeared without a revocation event', async () => {
    const { app, url } = await start();
    const session = await guest(url), view = await client(url, session);
    app.store.auth.deleteSession(tokenDigest(session.token));
    const disconnected = once<void>(view.socket, 'disconnect');
    view.socket.emit('createRoom', { protocolVersion: PROTOCOL_VERSION });
    await disconnected;
    expect(view.socket.connected).toBe(false);
    expect(app.store.listRooms()).toEqual([]);
  });
});
