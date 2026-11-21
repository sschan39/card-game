import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  let state: 'current' | 'unavailable' | 'revoked', role: 'user' | 'tester' | 'admin';
  let clock: number;
  let cookie: string;
  const sockets: Socket[] = [];
  let requests: string[];

  const fetchAccounts: typeof fetch = async (input, init) => {
    const address = new URL(String(input));
    expect(address.origin).toBe(identityOrigin);
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer ' + credential);
    requests.push(address.pathname);
    if (state === 'unavailable') return Response.json({ code: 'unavailable' }, { status: 503 });
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
    expect((await browserFetch('/api/browser/me')).status).toBe(503);
    expect((await browserFetch('/api/decks')).status).toBe(503);
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
    const connection = connect(url, { transports: ['websocket'], reconnection: false, autoConnect: false,
      auth: { protocolVersion: 1, token: tab.token } });
    sockets.push(connection);
    await new Promise<void>((resolve, reject) => {
      connection.once('sessionReady', () => resolve());
      connection.once('connect_error', reject);
      connection.connect();
    });
    state = 'revoked';
    const ended = await new Promise<{ reason: string }>(resolve => connection.once('sessionEnded', resolve));
    expect(ended.reason).toBe('expired');
  }, 8000);

  it('checks current Admin rights before serving admin data', async () => {
    role = 'admin';
    const signedIn = await fetch(url + '/api/auth/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ protocolVersion: 1, username: 'sample', password, scope: 'admin' }) });
    expect(signedIn.status).toBe(200);
    const { token } = await signedIn.json();
    const headers = { Authorization: 'Bearer ' + token };
    expect((await fetch(url + '/api/admin/me', { headers })).status).toBe(200);
    expect((await fetch(url + '/api/admin/accounts/' + accountId + '/disable', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{"protocolVersion":1}',
    })).status).toBe(403);
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
