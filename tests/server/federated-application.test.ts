import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { createGameApplication } from '@server/application';
import { PublicSessionClient } from '@card-game/browser-session';
import { PlaytestCredentialsSchema, PlaytestStateSchema } from '@card-game/protocol';

const projectId = '3c209c39-138e-4024-8845-c4180acf9e3a';
const accountId = '64934bef-d344-4afa-8495-7e9adf3a07e9';
const foreignId = '9e4d2331-814c-4dd7-b86c-e12d55281f2c';
const credential = 'a4_' + 'a'.repeat(32) + '.' + 'b'.repeat(43);
const remote = 'a4s_' + 'c'.repeat(32) + '.' + 'd'.repeat(43);
const foreignRemote = 'a4s_' + 'e'.repeat(32) + '.' + 'f'.repeat(43);
const identityOrigin = 'https://identity.example';
const webOrigin = 'http://localhost:5173';
const password = 'copper lantern river orchard';

describe('4A-backed game application', () => {
  let app: ReturnType<typeof createGameApplication>, url: string;
  let state: 'current' | 'unavailable' | 'project_forbidden' | 'revoked', role: 'user' | 'tester' | 'admin';
  let clock: number;
  let cookie: string;
  const sockets: Socket[] = [];
  let requests: string[];
  const openGameSocket = async (token: string) => {
    const socket = connect(url, { transports: ['websocket'], reconnection: false, autoConnect: false,
      auth: { protocolVersion: 1, token } });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('sessionReady', () => resolve());
      socket.once('connect_error', reject);
      socket.connect();
    });
    return socket;
  };

  const fetchAccounts: typeof fetch = async (input, init) => {
    const address = new URL(String(input));
    expect(address.origin).toBe(identityOrigin);
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer ' + credential);
    requests.push(address.pathname);
    if (state === 'unavailable') return Response.json({ code: 'unavailable' }, { status: 503 });
    if (state === 'project_forbidden' && address.pathname === '/v1/sessions/verify')
      return Response.json({ code: 'project_forbidden' }, { status: 403 });
    if (address.pathname === '/v1/projects/' + projectId)
      return Response.json({ id: projectId, status: 'active' });
    const foreign = headers.get('X-Accounts-Session') === foreignRemote ||
      address.pathname === '/v1/sessions' && JSON.parse(String(init?.body)).username === 'outsider';
    const account = { id: foreign ? foreignId : accountId, username: foreign ? 'outsider' : 'sample', role, disabled: false };
    const rights = role === 'admin' ? ['play', 'lab.operate', 'accounts.manage', 'audit.read'] : role === 'tester' ? ['play', 'lab.operate'] : ['play'];
    const session = { account, rights, idle_expires_at: new Date(clock + 3600000).toISOString(),
      expires_at: new Date(clock + 7200000).toISOString() };
    if (address.pathname === '/v1/accounts') {
      expect(headers.get('Idempotency-Key')).toBeTruthy();
      expect(JSON.parse(String(init?.body))).toEqual({ username: 'sample', password });
      return Response.json(account, { status: 201 });
    }
    if (address.pathname === '/v1/sessions') return Response.json({ ...session, session: foreign ? foreignRemote : remote }, { status: 201 });
    expect(headers.get('X-Accounts-Session')).toBe(foreign ? foreignRemote : remote);
    if (address.pathname === '/v1/sessions/logout') return new Response(null, { status: 204 });
    if (state === 'revoked') return Response.json({ code: 'invalid_session' }, { status: 401 });
    return Response.json(session);
  };

  const browserFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Origin', webOrigin);
    if (cookie) headers.set('Cookie', cookie);
    const response = await fetch(url + input, { ...init, headers });
    const updated = response.headers.get('Set-Cookie');
    if (updated) cookie = updated.split(';')[0];
    return response;
  };

  beforeEach(async () => {
    clock = Date.now(); state = 'current'; role = 'user'; cookie = ''; requests = [];
    app = createGameApplication({
      environment: { NODE_ENV: 'test', DELTA_LOG_PATH: '', ACCOUNTS_URL: identityOrigin,
        ACCOUNTS_PROJECT_ID: projectId, ACCOUNTS_PROJECT_KEY: credential },
      accountsFetch: fetchAccounts,
      now: () => clock,
      configuration: { lab: { enabled: true }, inspectionEnabled: true, navigation: { purpose: 'lab' } },
    });
    await app.ready;
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Test socket has no address');
    url = 'http://127.0.0.1:' + address.port;
  });

  afterEach(async () => {
    sockets.splice(0).forEach(socket => socket.disconnect());
    await new Promise<void>(resolve => app.io.close(() => resolve()));
  });

  it('keeps browser signup local and checks 4A for decks and renewed tab access', async () => {
    const web = new PublicSessionClient(browserFetch);
    const created = await web.authenticate('register', 'sample', password);
    expect(created.session?.account?.id).toBe(accountId);
    expect(JSON.stringify(created)).not.toContain(remote);
    expect(app.auth.repository.findAccount(accountId)?.passwordHash).toBe('');
    expect(requests).toContain('/v1/accounts');
    const deck = { name: 'Retained deck', format: 'standard', cards: [{ cardId: 'land-red', quantity: 60 }] };
    await web.request('/api/decks', { method: 'POST', body: { protocolVersion: 1, deck } });
    state = 'unavailable';
    expect(await web.me()).toMatchObject({ authorityUnavailable: true, session: { account: { id: accountId } } });
    expect((await browserFetch('/api/decks')).status).toBe(503);
    await expect(web.request('/api/decks', { method: 'POST', body: { protocolVersion: 1, deck } })).rejects.toMatchObject({ status: 503 });
    state = 'current';
    expect(await web.request('/api/decks')).toMatchObject({ total: 1 });
    await web.tab();
    state = 'revoked';
    expect((await web.me()).session).toBeNull();
    expect((await browserFetch('/api/decks')).status).toBe(401);
  });

  it('ends existing game connections when 4A invalidates their account sessions', async () => {
    const web = new PublicSessionClient(browserFetch);
    await web.authenticate('login', 'sample', password);
    const tab = await web.tab();
    const connection = await openGameSocket(tab.token);
    state = 'revoked';
    clock += 20_000;
    const ended = await new Promise<{ reason: string }>(resolve => connection.once('sessionEnded', resolve));
    expect(ended.reason).toBe('expired');
  }, 8000);

  it('ends the browser session, reports unconfirmed 4A sign-out, and retries it on recovery', async () => {
    const web = new PublicSessionClient(browserFetch);
    await web.authenticate('login', 'sample', password);
    const tab = await web.tab();
    const socket = await openGameSocket(tab.token);
    const ended = new Promise(resolve => socket.once('sessionEnded', resolve));
    state = 'unavailable';
    await expect(web.logout()).rejects.toMatchObject({ status: 503, message: expect.stringContaining('Signed out of the game') });
    await expect(ended).resolves.toMatchObject({ reason: 'logout' });
    expect(cookie).toMatch(/=$/);
    expect((await web.me()).session).toBeNull();
    expect(app.auth.sessions.validate(tab.token)).toBeUndefined();
    expect(requests.filter(path => path === '/v1/sessions/logout')).toHaveLength(1);
    state = 'current';
    await vi.waitFor(() => expect(requests.filter(path => path === '/v1/sessions/logout')).toHaveLength(2), { timeout: 6000 });
  }, 8000);

  it('plays from the local decision, pauses both seats on expiry, and resumes on the same sockets', async () => {
    const web = new PublicSessionClient(browserFetch);
    await web.authenticate('login', 'sample', password);
    const tab = await web.tab();
    const [owner, opponent] = await Promise.all([openGameSocket(tab.token), openGameSocket(app.auth.guest().token)]);
    const created = new Promise<{ roomId: string }>(resolve => owner.once('roomCreated', resolve));
    owner.emit('createRoom', { protocolVersion: 1 });
    const { roomId } = await created;
    const room = () => app.store.getRoom(roomId)!;
    const request = { protocolVersion: 1, roomId };
    const joined = new Promise(resolve => opponent.once('roomSnapshot', resolve));
    opponent.emit('joinRoom', request);
    await joined;
    const started = new Promise(resolve => owner.once('startGame', resolve));
    owner.emit('submitRps', { ...request, pick: 'rock' });
    opponent.emit('submitRps', { ...request, pick: 'scissors' });
    await started;
    const action = { ...request, actionId: 'pass_priority' };
    const view = { ...request, zone: 'hand', cardUuid: 'not-a-card' };
    const verifyCount = () => requests.filter(path => path === '/v1/sessions/verify').length;
    const before = verifyCount();
    state = 'unavailable';
    await expect(owner.timeout(1500).emitWithAck('getOptions', view)).resolves.toMatchObject({ options: [] });
    await expect(owner.timeout(1500).emitWithAck('playerAction', action)).resolves.toMatchObject({ accepted: true });
    expect(verifyCount()).toBe(before);
    await expect(opponent.timeout(1500).emitWithAck('playerAction', action)).resolves.toMatchObject({ accepted: true });

    clock += 30_000;
    const paused = [owner, opponent].map(socket => new Promise(resolve => socket.once('matchAccess', resolve)));
    const beforePause = room();
    await expect(opponent.timeout(1500).emitWithAck('playerAction', action)).resolves.toMatchObject({
      accepted: false, message: expect.stringContaining('resume automatically'),
    });
    for (const message of await Promise.all(paused)) expect(message).toMatchObject({ roomId, paused: true });
    await expect(owner.timeout(1500).emitWithAck('playerAction', action)).resolves.toMatchObject({ accepted: false });
    expect(room()).toBe(beforePause);
    expect(owner.connected && opponent.connected).toBe(true);

    const priority = room().player1Id === room().priorityPlayerId ? owner : opponent;
    const scheduled = new Promise(resolve => priority.once('autoPassStatus', resolve));
    expect(app.runtime.setAutoPass(priority.id!, roomId, false, room().turnNumber)).toBe(true);
    expect(await scheduled).toMatchObject({ passAt: null });
    expect(room()).toBe(beforePause);
    const autoPassed = new Promise(resolve => priority.once('stateDelta', resolve));
    const resumed = [owner, opponent].map(socket => new Promise(resolve => socket.once('matchAccess', resolve)));
    state = 'current';
    for (const message of await Promise.all(resumed)) expect(message).toMatchObject({ roomId, paused: false });
    expect(await autoPassed).toMatchObject({ action: 'pass_priority' });
    const next = room().player1Id === room().priorityPlayerId ? owner : opponent;
    await expect(next.timeout(1500).emitWithAck('playerAction', action)).resolves.toMatchObject({ accepted: true });
    expect(owner.connected && opponent.connected).toBe(true);
  }, 10_000);

  it('checks current Admin rights before serving admin data', async () => {
    role = 'admin';
    const signedIn = await fetch(url + '/api/auth/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ protocolVersion: 1, username: 'sample', password, scope: 'admin' }) });
    expect(signedIn.status).toBe(200);
    const { token } = await signedIn.json();
    const headers = { Authorization: 'Bearer ' + token };
    expect((await fetch(url + '/api/admin/me', { headers })).status).toBe(200);
    expect((await fetch(url + '/api/admin/accounts', { headers })).status).toBe(403);
    expect((await fetch(url + '/api/admin/accounts/' + accountId + '/disable', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{"protocolVersion":1}',
    })).status).toBe(403);
    state = 'project_forbidden';
    expect((await fetch(url + '/api/admin/me', { headers })).status).toBe(503);
    expect(app.store.audit.pendingAudit(20)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'admin.unavailable', outcome: 'unavailable' }),
    ]));
    expect(app.store.audit.pendingAudit(20)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'admin.denied' }),
    ]));
    state = 'current';
    expect((await fetch(url + '/api/admin/me', { headers })).status).toBe(200);
    role = 'user';
    expect((await fetch(url + '/api/admin/me', { headers })).status).toBe(403);
  });

  it('resumes a retained Test Room with fresh controls after expiry, preserving board edits', async () => {
    role = 'tester';
    const web = new PublicSessionClient(browserFetch);
    await web.authenticate('login', 'sample', password);
    expect((await web.me()).labOperator).toBe(true);
    const rooms = '/api/lab/operator/rooms';
    const playtest = PlaytestCredentialsSchema.parse(await web.request(rooms, { method: 'POST' }));
    const id = playtest.run.roomId;
    const connectSeat = async (token: string, event: 'roomSnapshot' | 'connect_error') => {
      const socket = connect(url, { transports: ['websocket'], reconnection: false, autoConnect: false,
        auth: { protocolVersion: 1, playtestToken: token, roomId: id } });
      sockets.push(socket);
      const result = await new Promise<unknown>((resolve, reject) => {
        socket.once(event, resolve);
        if (event !== 'connect_error') socket.once('connect_error', reject);
        socket.connect();
      });
      return { socket, result };
    };
    const [seatA, seatB] = await Promise.all(playtest.seats.map(token => connectSeat(token, 'roomSnapshot')));
    expect(seatA.result).toMatchObject({ room: { roomId: id } });
    expect(seatB.result).toMatchObject({ room: { roomId: id } });
    const passed = new Promise(resolve => seatA.socket.once('stateDelta', resolve));
    seatA.socket.emit('setAutoPass', { protocolVersion: 1, roomId: id, enabled: false, untilTurn: 1 });
    expect(await passed).toMatchObject({ action: 'pass_priority' });
    expect(requests).not.toContain('/v1/sessions/activity');
    const editor = (token: string, body?: object) => fetch(url + '/api/lab/playtest/' + id, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify({ protocolVersion: 1, ...body }) } : {}),
    });
    const initial = PlaytestStateSchema.parse(await (await editor(playtest.editor)).json());
    state = 'project_forbidden';
    expect((await editor(playtest.editor)).status).toBe(503);
    expect(await web.me()).toMatchObject({ authorityUnavailable: true, session: { account: { id: accountId } } });
    const paused = new Promise(resolve => seatA.socket.once('matchAccess', resolve));
    await expect(seatA.socket.timeout(1500).emitWithAck('playerAction', {
      protocolVersion: 1, roomId: id, actionId: 'pass_priority',
    })).resolves.toMatchObject({ accepted: false });
    expect(await paused).toMatchObject({ roomId: id, paused: true });
    expect(seatA.socket.connected && seatB.socket.connected).toBe(true);
    state = 'current';
    const resumedAccess = new Promise(resolve => seatA.socket.once('matchAccess', resolve));
    expect(await seatA.socket.timeout(1500).emitWithAck('getOptions', {
      protocolVersion: 1, roomId: id, cardUuid: 'not-a-card', zone: 'hand',
    })).toMatchObject({ options: [] });
    expect(await resumedAccess).toMatchObject({ roomId: id, paused: false });
    const editing = PlaytestStateSchema.parse(await (await editor(playtest.editor, { kind: 'edit', expectedRevision: initial.revision })).json());
    const edit = { kind: 'player', seat: 0, life: 17, mana: editing.players[0].mana };
    expect((await editor(playtest.editor, { edit, expectedRevision: editing.revision })).status).toBe(200);
    expect(requests).toContain('/v1/sessions/activity');

    const ended = Promise.all([seatA, seatB].map(({ socket }) => new Promise(resolve => socket.once('sessionEnded', resolve))));
    state = 'revoked';
    expect((await editor(playtest.editor)).status).toBe(401);
    await ended;
    expect((await web.me()).session).toBeNull();
    state = 'current';
    await web.authenticate('login', 'outsider', password);
    expect(await web.request(rooms)).toMatchObject({ rooms: [] });
    await expect(web.request(rooms + '/' + id + '/resume', { method: 'POST' })).rejects.toMatchObject({ status: 404 });
    await web.authenticate('login', 'sample', password);
    expect(await web.request(rooms)).toMatchObject({ rooms: [{ roomId: id }] });
    const resumed = PlaytestCredentialsSchema.parse(await web.request(rooms + '/' + id + '/resume', { method: 'POST' }));
    expect(resumed.editor).not.toBe(playtest.editor);
    expect(resumed.seats).not.toEqual(playtest.seats);
    expect((await editor(playtest.editor)).status).toBe(403);
    expect((await connectSeat(playtest.seats[0], 'connect_error')).result).toMatchObject({ message: expect.stringContaining('no longer available') });
    const board = PlaytestStateSchema.parse(await (await editor(resumed.editor)).json());
    expect(board.players[0].life).toBe(17);
    expect(board.editing).toBe(true);

    role = 'user';
    expect((await editor(resumed.editor)).status).toBe(403);
    expect((await browserFetch(rooms)).status).toBe(403);
    role = 'tester';
    await web.logout();
    clock += 25 * 3600000;
    await web.authenticate('login', 'sample', password);
    expect(await web.request(rooms)).toMatchObject({ rooms: [] });
  }, 8000);
});
