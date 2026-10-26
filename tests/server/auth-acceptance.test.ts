import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { AuthResponseSchema, PROTOCOL_VERSION, type AuthResponse, type PlayerView, type SessionInfo, type ViewDelta } from '@card-game/protocol';
import { createGameApplication } from '@server/application';
import { authConfig } from '@server/config';
import { gameConfig } from '@config';
import { applyDeltaChanges } from '@client/store/deltaReducer';

const password = 'copper-lantern-river-94!';
describe('focused authenticated HTTP and socket boundary', { timeout: 10_000 }, () => {
  let application: ReturnType<typeof createGameApplication>, url: string;
  let clock: number;
  let environment: NodeJS.ProcessEnv;
  const sockets: Socket[] = [];
  const originalSetup = gameConfig.setup;
  beforeEach(async () => {
    clock = Date.now();
    gameConfig.setup = { ...originalSetup, developmentDeck: Array(8).fill('land-red'), openingHandSize: 1, shuffleDevelopmentDeck: false };
    environment = { DELTA_LOG_PATH: '', INSPECTOR_ENABLED: 'true' };
    application = createGameApplication({ environment, now: () => clock });
    await application.ready;
    await new Promise<void>(resolve => application.server.listen(0, '127.0.0.1', resolve));
    const address = application.server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
    url = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    sockets.splice(0).forEach(socket => socket.disconnect());
    if (application) await new Promise<void>(resolve => application.io.close(() => resolve()));
    gameConfig.setup = originalSetup; vi.restoreAllMocks();
  });
  const json = (path: string, body: unknown, token?: string) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  async function register(username: string) {
    const response = await json('/api/auth/register', { protocolVersion: PROTOCOL_VERSION, username, password });
    expect(response.status).toBe(201); return AuthResponseSchema.parse(await response.json());
  }
  async function guest() { return AuthResponseSchema.parse(await (await json('/api/auth/guest', { protocolVersion: PROTOCOL_VERSION })).json()); }
  function once<T>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const listener = (data: T) => { clearTimeout(timer); resolve(data); };
      const timer = setTimeout(() => { socket.off(event, listener); reject(new Error('Timed out: ' + event)); }, 1500);
      socket.once(event, listener);
    });
  }
  async function client(session: AuthResponse, roomId?: string, claimedPlayerId?: string) {
    const socket = connect(url, { transports: ['websocket'], reconnection: false, autoConnect: false, auth: {
      protocolVersion: PROTOCOL_VERSION, token: session.token, ...(roomId ? { roomId } : {}), ...(claimedPlayerId ? { playerId: claimedPlayerId } : {}),
    } }); sockets.push(socket);
    const view = { socket, room: undefined as PlayerView | undefined, identity: undefined as SessionInfo | undefined, seq: 0, errors: [] as string[] };
    socket.on('sessionReady', data => { view.identity = data; });
    socket.on('roomSnapshot', ({ room, seq }) => { view.room = room; view.seq = seq; });
    socket.on('stateDelta', (delta: ViewDelta) => { if (view.room) view.room = applyDeltaChanges(view.room, delta.changes); view.seq = delta.seq; });
    socket.on('error', ({ message }) => view.errors.push(message));
    const ready = once<SessionInfo>(socket, 'sessionReady'); socket.connect(); await ready; return view;
  }
  async function rejected(token: string, origin?: string) {
    const socket = connect(url, { transports: ['websocket'], reconnection: false, autoConnect: false,
      auth: { protocolVersion: PROTOCOL_VERSION, token }, ...(origin ? { extraHeaders: { Origin: origin } } : {}) }); sockets.push(socket);
    const failure = once<Error>(socket, 'connect_error'); socket.connect(); return failure;
  }
  async function create(view: Awaited<ReturnType<typeof client>>) {
    const created = once<{ roomId: string }>(view.socket, 'roomCreated'); view.socket.emit('createRoom', { protocolVersion: PROTOCOL_VERSION });
    const result = await created; await vi.waitFor(() => expect(view.room?.roomId).toBe(result.roomId)); return result.roomId;
  }
  async function command(view: Awaited<ReturnType<typeof client>>, roomId: string, actionId: string, data: Record<string, unknown> = {}) {
    const prior = view.seq, errors = view.errors.length;
    view.socket.emit('playerAction', { protocolVersion: PROTOCOL_VERSION, roomId, actionId, ...data });
    await vi.waitFor(() => { expect(view.errors.slice(errors)).toEqual([]); expect(view.seq).toBeGreaterThan(prior); });
  }
  async function playTurn(a: Awaited<ReturnType<typeof client>>, b: Awaited<ReturnType<typeof client>>, roomId: string) {
    b.socket.emit('joinRoom', { protocolVersion: PROTOCOL_VERSION, roomId });
    await vi.waitFor(() => { expect(a.room?.status).toBe('RPS'); expect(b.room?.status).toBe('RPS'); });
    for (const view of [a, b]) {
      const playerId = view.identity!.playerId, rock = view.room!.players[playerId].hand.find(card => card.definitionId === 'rock')!;
      await command(view, roomId, 'rpsPlay', { cardUuid: rock.uuid });
    }
    await vi.waitFor(() => expect(a.room?.status).toBe('playing'));
    const actor = () => a.room!.priorityPlayerId === a.identity!.playerId ? a : b;
    for (let count = 0; count < 4; count++) await command(actor(), roomId, 'pass_priority');
    expect(a.room!.phase).toBe('stateMainPhase');
    const active = a.room!.activeTurnPlayerId === a.identity!.playerId ? a : b;
    const land = active.room!.players[active.identity!.playerId].hand[0];
    await command(active, roomId, 'play_land', { cardUuid: land.uuid, zoneRevision: land.state.zoneRevision });
    const initialTurn = a.room!.turnNumber;
    // Complete the turn through ordinary passes and an empty attack declaration.
    for (let count = 0; count < 28 && a.room!.turnNumber === initialTurn; count++) {
      if (a.room!.declarationPlayerId) {
        const declaring = a.room!.declarationPlayerId === a.identity!.playerId ? a : b;
        await command(declaring, roomId, a.room!.phase === 'declareAttackersStep' ? 'declare_attackers' : 'declare_blockers', a.room!.phase === 'declareAttackersStep' ? { attackers: [] } : { assignments: [] });
      } else await command(actor(), roomId, 'pass_priority');
    }
    expect(a.room!.turnNumber).toBe(initialTurn + 1);
  }
  it('registers, rotates on login, plays a turn, logs out and rejects the token immediately', async () => {
    const registered = await register('alice');
    const response = await json('/api/auth/login', { protocolVersion: PROTOCOL_VERSION, username: 'alice', password });
    const account = AuthResponseSchema.parse(await response.json());
    expect((await rejected(registered.token)).message).toContain('revoked');
    const a = await client(account), b = await client(await register('bob')), roomId = await create(a);
    await playTurn(a, b, roomId);
    const disconnected = once(a.socket, 'disconnect');
    expect((await json('/api/auth/logout', { protocolVersion: PROTOCOL_VERSION }, account.token)).status).toBe(200);
    await disconnected; expect((await rejected(account.token)).message).toContain('revoked');
    expect((await fetch(url + '/api/auth/me', { headers: { Authorization: 'Bearer ' + account.token } })).status).toBe(401);
  });
  it('ignores forged player IDs and does not let another account rejoin the owner seat', async () => {
    const owner = await register('owner'), attacker = await register('other');
    const a = await client(owner, undefined, 'chosen-by-browser'), roomId = await create(a);
    expect(a.identity!.playerId).toBe('account:' + owner.account!.id);
    const b = await client(attacker, roomId, a.identity!.playerId);
    await vi.waitFor(() => expect(b.room).toBeUndefined());
    expect(b.identity!.playerId).not.toBe(a.identity!.playerId);
    const error = once<{ message: string }>(b.socket, 'error');
    b.socket.emit('playerAction', { protocolVersion: PROTOCOL_VERSION, roomId, actionId: 'pass_priority', playerId: a.identity!.playerId });
    expect((await error).message).toBeTruthy(); expect(application.store.getRoom(roomId)!.player1Id).toBe(a.identity!.playerId);
  });
  it('links a guest after a turn and reconnects to the same seat with only the account token', async () => {
    const credential = await guest(), a = await client(credential), b = await client(await guest()), roomId = await create(a);
    await playTurn(a, b, roomId); const before = structuredClone(a.room), seatId = a.identity!.playerId;
    const ended = once(a.socket, 'disconnect');
    const response = await json('/api/auth/register', { protocolVersion: PROTOCOL_VERSION, username: 'guest-linked', password, roomId }, credential.token);
    const account = AuthResponseSchema.parse(await response.json()); await ended;
    expect(account.playerId).toBe(seatId); expect((await rejected(credential.token)).message).toContain('revoked');
    const restored = await client(account, roomId, 'forged');
    await vi.waitFor(() => expect(restored.room).toEqual(before)); expect(restored.identity!.playerId).toBe(seatId);
  });
  it('preserves a waiting guest room while registration replaces its credential', async () => {
    const session = await guest(), view = await client(session), roomId = await create(view);
    const response = await json('/api/auth/register', { protocolVersion: PROTOCOL_VERSION, username: 'waiting', password, roomId }, session.token);
    const account = AuthResponseSchema.parse(await response.json());
    expect(application.store.getRoom(roomId)?.status).toBe('waiting');
    const restored = await client(account, roomId); await vi.waitFor(() => expect(restored.room?.status).toBe('waiting'));
  });
  it('requires fresh admin-scoped login and the inspection flag, while game sessions remain separate', async () => {
    await application.auth.bootstrapAdmin('operator', password);
    const login = async (scope: 'game' | 'admin') => AuthResponseSchema.parse(await (await json('/api/auth/login', { protocolVersion: PROTOCOL_VERSION, username: 'operator', password, scope })).json());
    const game = await login('game'), admin = await login('admin'), roomView = await client(await guest()), roomId = await create(roomView);
    const get = (path: string, token: string) => fetch(url + path, { headers: { Authorization: 'Bearer ' + token } });
    expect((await get('/api/admin/rooms', game.token)).status).toBe(403);
    expect((await get('/api/debug/room/' + roomId, game.token)).status).toBe(401);
    const list = await get('/api/admin/rooms', admin.token); expect(list.status).toBe(200); expect((await list.json()).rooms[0].roomId).toBe(roomId);
    const inspected = await get('/api/debug/room/' + roomId, admin.token); expect(inspected.status).toBe(200);
    expect((await inspected.json()).room).toHaveProperty('continuousEffectPool');
    expect((await rejected(admin.token)).message).toContain('game session');
    environment.INSPECTOR_ENABLED = 'false';
    expect((await get('/api/debug/room/' + roomId, admin.token)).status).toBe(404);
    expect((await get('/api/admin/rooms', admin.token)).status).toBe(404);
    environment.INSPECTOR_ENABLED = 'true';
    await json('/api/auth/logout', { protocolVersion: PROTOCOL_VERSION }, admin.token);
    expect((await get('/api/admin/rooms', admin.token)).status).toBe(401);
    expect((await get('/api/auth/me', game.token)).status).toBe(200);
    const normal = await register('normal');
    expect((await json('/api/auth/login', { protocolVersion: PROTOCOL_VERSION, username: 'normal', password, scope: 'admin' })).status).toBe(403);
  });
  it('rejects unlisted HTTP preflights and WebSocket origins', async () => {
    const denied = await fetch(url + '/api/auth/login', { method: 'OPTIONS', headers: { Origin: 'https://unlisted.example', 'Access-Control-Request-Method': 'POST' } });
    expect(denied.status).toBe(403); expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    const allowed = await fetch(url + '/api/auth/login', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } });
    expect(allowed.status).toBe(204); expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect((await rejected((await guest()).token, 'https://unlisted.example')).message).toBeTruthy();
  });
  it('never logs credentials, tokens or hashes during login and rejects malformed privileged registration', async () => {
    const account = await register('audit'), hash = application.store.auth.findAccount(account.account!.id)!.passwordHash;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const response = await json('/api/auth/login', { protocolVersion: PROTOCOL_VERSION, username: 'audit', password });
    const issued = AuthResponseSchema.parse(await response.json()), text = JSON.stringify(log.mock.calls);
    expect(text).toContain('auth:login');
    for (const secret of [password, hash, issued.token, account.token]) expect(text).not.toContain(secret);
    const escalation = await json('/api/auth/register', { protocolVersion: PROTOCOL_VERSION, username: 'bad-role', password, role: 'admin' });
    expect(escalation.status).toBe(400); expect(await escalation.text()).not.toContain(password);
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it('expires active sockets and rejects subsequent HTTP and socket token reuse', async () => {
    const session = await guest(), view = await client(session), ended = once(view.socket, 'disconnect');
    clock += authConfig.guestTtlMs + 1;
    view.socket.emit('createRoom', { protocolVersion: PROTOCOL_VERSION }); await ended;
    expect(application.store.listRooms()).toEqual([]); expect((await rejected(session.token)).message).toContain('revoked');
  });
  it('limits credential attempts before hashing and rejects oversized/malformed bodies without echoing them', async () => {
    for (let count = 0; count < authConfig.rateLimit.limit; count++) expect((await json('/api/auth/login', {})).status).toBe(400);
    const limited = await json('/api/auth/login', { password });
    expect(limited.status).toBe(429); expect(limited.headers.get('ratelimit')).toBeTruthy(); expect(await limited.text()).not.toContain(password);
    const large = await json('/api/auth/register', { protocolVersion: PROTOCOL_VERSION, username: 'large', password: password.repeat(1000) });
    expect(large.status).toBe(413); expect(await large.text()).not.toContain(password);
    const malformed = await fetch(url + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"private-input", broken' });
    expect(malformed.status).toBe(400); expect(await malformed.text()).not.toContain('private-input');
  });
});
