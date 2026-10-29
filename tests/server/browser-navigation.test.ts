import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { AuthResponseSchema, type AuthResponse, type DeckInput } from '@card-game/protocol';
import { PublicSessionClient, verifyRoomResume } from '@card-game/browser-session';
import { createGameApplication } from '@server/application';
import { tokenDigest } from '@server/auth/session';
import { browserCookieName } from '@server/auth/browser-routes';
import { BuilderApi } from '@builder/api';
import { declarationPlayer } from '@rules/turn-utils';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const origin = 'http://localhost:5173', password = 'copper lantern river orchard';
const deck: DeckInput = { name: 'Browser deck', format: 'standard', cards: [{ cardId: 'land-red', quantity: 60 }] };
describe('Milestone 6 public browser families and tab ownership', () => {
  let application: ReturnType<typeof createGameApplication>, url: string, clock: number;
  const sockets: Socket[] = [];
  beforeEach(async () => {
    clock = Date.now(); application = createGameApplication({ now: () => clock, environment: { NODE_ENV: 'test', DELTA_LOG_PATH: '' }, configuration: { auth: { maxBrowserSessionsPerAccount: 2, maxTabsPerBrowser: 2 } } });
    await application.ready; await new Promise<void>(resolve => application.server.listen(0, '127.0.0.1', resolve));
    const address = application.server.address(); if (!address || typeof address === 'string') throw new Error('No address'); url = 'http://127.0.0.1:' + address.port;
  });
  afterEach(async () => { vi.restoreAllMocks(); sockets.splice(0).forEach(socket => socket.disconnect()); await new Promise<void>(resolve => application.io.close(() => resolve())); });
  function browser() {
    const cookies = new Map<string, string>(), headers: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const requestHeaders = new Headers(init?.headers); requestHeaders.set('Origin', origin);
      if (cookies.size) requestHeaders.set('Cookie', [...cookies].map(([key, value]) => key + '=' + value).join('; '));
      const result = await fetch(url + input, { ...init, headers: requestHeaders });
      for (const cookie of result.headers.getSetCookie()) {
        headers.push(cookie); const [key, value] = cookie.split(';')[0].split('='); if (value) cookies.set(key, value); else cookies.delete(key);
      }
      return result;
    };
    return { client: new PublicSessionClient(fetcher), fetcher, cookies, headers };
  }
  const request = (path: string, method = 'GET', headers: Record<string, string> = {}, body?: unknown) => fetch(url + path, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  function once<T>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.off(event, received); reject(new Error('Timed out: ' + event)); }, 2000);
      const received = (value: T) => { clearTimeout(timer); resolve(value); }; socket.once(event, received);
    });
  }
  async function socketFor(session: AuthResponse, roomId?: string) {
    const socket = connect(url, { transports: ['websocket'], reconnection: false, autoConnect: false, auth: { protocolVersion: 1, token: session.token, roomId } }); sockets.push(socket);
    const ready = once(socket, 'sessionReady'); socket.connect(); await ready; return socket;
  }

  it('shares public account access through an HttpOnly host cookie without exposing its bearer', async () => {
    const web = browser(); expect((await web.client.me()).session).toBeNull();
    const identity = await web.client.authenticate('register', 'alice', password);
    expect(identity.session?.account?.username).toBe('alice'); expect(identity).not.toHaveProperty('token');
    expect(web.headers[0]).toContain('HttpOnly'); expect(web.headers[0]).toContain('SameSite=Strict'); expect(web.headers[0]).toContain('Path=/'); expect(web.headers[0]).not.toContain('Domain=');
    const builder = new PublicSessionClient(web.fetcher); expect((await builder.me()).session?.sessionId).toBe(identity.session?.sessionId);
    const saved = await builder.request('/api/decks', { method: 'POST', body: { protocolVersion: 1, deck } }) as { deck: { id: string } }; expect(saved.deck.id).toBeTruthy();
    expect((await web.client.platform()).capabilities.scenarios).toBe(false);
    const raw = web.cookies.get(browserCookieName(application.config))!;
    const socket = connect(url, { transports: ['websocket'], reconnection: false, autoConnect: false, auth: { protocolVersion: 1, token: raw } }); sockets.push(socket);
    const rejected = once<Error>(socket, 'connect_error'); socket.connect(); expect((await rejected).message).toContain('game session');
    expect((await request('/api/admin/me', 'GET', { Cookie: [...web.cookies].map(([key, value]) => key + '=' + value).join('; ') })).status).toBe(401);
  });

  it('rejects CSRF, missing/foreign origins, simple requests, duplicate cookies and invalid explicit bearers', async () => {
    const web = browser(), identity = await web.client.authenticate('register', 'alice', password);
    const cookie = [...web.cookies].map(([key, value]) => key + '=' + value).join('; '), body = { protocolVersion: 1, deck };
    for (const headers of [
      { Cookie: cookie }, { Cookie: cookie, Origin: origin },
      { Cookie: cookie, Origin: origin, 'X-Card-Game-Client': 'browser-v1' },
      { Cookie: cookie, Origin: origin, 'X-Card-Game-Client': 'browser-v1', 'X-CSRF-Token': 'é'.repeat(43) },
      { Cookie: cookie, Origin: 'http://evil.example', 'X-Card-Game-Client': 'browser-v1', 'X-CSRF-Token': identity.csrf! },
    ]) expect((await request('/api/decks', 'POST', headers, body)).status).toBe(403);
    expect((await request('/api/decks', 'GET', { Cookie: cookie + '; ' + cookie })).status).toBe(401);
    expect((await request('/api/decks', 'GET', { Cookie: cookie, Authorization: 'Bearer ' + 'x'.repeat(43) })).status).toBe(401);
    expect((await request('/api/browser/login', 'POST', { Origin: origin }, { protocolVersion: 1, username: 'alice', password })).status).toBe(403);
    expect((await request('/api/browser/login', 'POST', { Origin: origin, 'X-Card-Game-Client': 'browser-v1' }, { protocolVersion: 1, username: 'alice', password, scope: 'admin' })).status).toBe(400);
    expect((await web.client.request('/api/decks', { method: 'POST', body })) as object).toHaveProperty('deck');
  });

  it('creates distinct bounded game seats, reuses a tab credential and refuses sibling room claims', async () => {
    const web = browser(); await web.client.authenticate('register', 'alice', password);
    const a = await web.client.tab(), b = await web.client.tab(); expect(a.playerId).not.toBe(b.playerId);
    expect((await web.client.tab(a)).token).toBe(a.token);
    await expect(web.client.tab()).rejects.toMatchObject({ status: 409 });
    const socket = await socketFor(a), created = once<{ roomId: string }>(socket, 'roomCreated');
    const saved = await web.client.request('/api/decks', { method: 'POST', body: { protocolVersion: 1, deck } }) as { deck: { id: string } };
    socket.emit('createRoom', { protocolVersion: 1, deckId: saved.deck.id }); const roomId = (await created).roomId;
    expect((await verifyRoomResume(roomId, a, undefined, (input, init) => fetch(url + input, init))).playerId).toBe(a.playerId);
    await expect(verifyRoomResume(roomId, b, undefined, (input, init) => fetch(url + input, init))).rejects.toThrow('unavailable');
    await expect(web.client.tab(b, roomId)).rejects.toMatchObject({ status: 403 });
    expect((await request('/api/rooms/' + roomId + '/resume')).status).toBe(401);
    expect((await request('/api/rooms/not-owned/resume', 'GET', { Authorization: 'Bearer ' + a.token })).status).toBe(404);
    expect(application.auth.sessions.validate(a.token)).toBeDefined();
  });

  it('supports local tab logout, browser-family logout and fixed parent expiry', async () => {
    const web = browser(); await web.client.authenticate('register', 'alice', password);
    const a = await web.client.tab(), b = await web.client.tab();
    expect((await request('/api/auth/logout', 'POST', { Authorization: 'Bearer ' + a.token }, { protocolVersion: 1 })).status).toBe(200);
    expect(application.auth.sessions.validate(a.token)).toBeUndefined(); expect(application.auth.sessions.validate(b.token)).toBeDefined(); expect((await web.client.me()).session).not.toBeNull();
    const live = await socketFor(b), ended = once(live, 'disconnect'); await web.client.logout(); await ended;
    expect(application.auth.sessions.validate(b.token)).toBeUndefined(); expect((await web.client.me()).session).toBeNull();
    await web.client.authenticate('login', 'alice', password); const child = await web.client.tab(); clock = child.expiresAt + 1;
    expect((await web.client.me()).session).toBeNull(); expect(application.auth.sessions.validate(child.token)).toBeUndefined();
  });

  it('bounds independent browser sessions and global public logout preserves admin scope', async () => {
    await application.auth.bootstrapAdmin('operator', password);
    const a = browser(), b = browser(), c = browser();
    await a.client.authenticate('login', 'operator', password); await b.client.authenticate('login', 'operator', password);
    await expect(c.client.authenticate('login', 'operator', password)).rejects.toMatchObject({ status: 409 });
    const admin = await application.auth.login({ username: 'operator', password, scope: 'admin' });
    const x = await a.client.tab(), y = await b.client.tab();
    await a.client.logout(true);
    expect(application.auth.sessions.validate(x.token)).toBeUndefined(); expect(application.auth.sessions.validate(y.token)).toBeUndefined();
    expect(application.auth.sessions.validate(admin.token)?.scope).toBe('admin'); expect((await b.client.me()).session).toBeNull();
  });
  it('lets a legacy account explicitly end all public sessions without a browser cookie', async () => {
    const legacy = await application.auth.register({ username: 'alice', password }), web = browser(); await web.client.authenticate('login', 'alice', password); const child = await web.client.tab();
    expect((await request('/api/auth/logout-all', 'POST', { Authorization: 'Bearer ' + legacy.token }, { protocolVersion: 1 })).status).toBe(200);
    expect(application.auth.sessions.validate(child.token)).toBeUndefined(); expect((await web.client.me()).session).toBeNull();
    const guest = application.auth.guest(); expect((await request('/api/auth/logout-all', 'POST', { Authorization: 'Bearer ' + guest.token }, { protocolVersion: 1 })).status).toBe(403);
  });

  it('rolls back family revocation and notifications if durable deletion fails', async () => {
    const web = browser(); await web.client.authenticate('register', 'alice', password); const child = await web.client.tab();
    const events = vi.fn(), unsubscribe = application.auth.sessions.onRevoke(events);
    const original = application.auth.repository.deleteSession.bind(application.auth.repository);
    const parent = [...web.cookies.values()][0];
    vi.spyOn(application.auth.repository, 'deleteSession').mockImplementation(digest => { if (digest === tokenDigest(parent)) throw new Error('storage failed'); original(digest); });
    await expect(web.client.logout()).rejects.toMatchObject({ status: 500 });
    expect(application.auth.sessions.validate(child.token)).toBeDefined(); expect(events).not.toHaveBeenCalled(); unsubscribe();
  });

  it('links a seated guest into one new tab identity without giving siblings its seat', async () => {
    const guest = AuthResponseSchema.parse(await (await request('/api/auth/guest', 'POST', {}, { protocolVersion: 1 })).json());
    const socket = await socketFor(guest), created = once<{ roomId: string }>(socket, 'roomCreated'); socket.emit('createRoom', { protocolVersion: 1 }); const roomId = (await created).roomId;
    const web = browser(); await web.client.authenticate('register', 'alice', password);
    const linked = await web.client.tab(guest, roomId); expect(linked.playerId).toBe(guest.playerId); expect(linked.roomId).toBe(roomId);
    expect(application.auth.sessions.validate(guest.token)).toBeUndefined();
    expect((await verifyRoomResume(roomId, linked, undefined, (input, init) => fetch(url + input, init))).playerId).toBe(guest.playerId);
    expect((await verifyRoomResume(roomId, { ...linked, playerId: 'tab:default' }, undefined, (input, init) => fetch(url + input, init))).playerId).toBe(guest.playerId);
    const sibling = await web.client.tab(); await expect(web.client.tab(sibling, roomId)).rejects.toMatchObject({ status: 403 });
    const reconnected = await socketFor(linked, roomId); expect(reconnected.connected).toBe(true);
  });

  it('signs in once, saves in the builder, plays a complete turn, then updates without revoking its seat', async () => {
    const web = browser(), other = browser();
    const identity = await web.client.authenticate('register', 'alice', password); await other.client.authenticate('register', 'bob', password);
    const builder = new BuilderApi(undefined, web.client), saved = await builder.save(undefined, deck);
    const a = await web.client.tab(), b = await other.client.tab(), p1 = await socketFor(a), p2 = await socketFor(b);
    const created = once<{ roomId: string }>(p1, 'roomCreated'); p1.emit('createRoom', { protocolVersion: 1, deckId: saved.id }); const roomId = (await created).roomId;
    const bDeck = await new BuilderApi(undefined, other.client).save(undefined, deck);
    const joined = once(p2, 'roomJoined'); p2.emit('joinRoom', { protocolVersion: 1, roomId, deckId: bDeck.id }); await joined;
    const room = () => application.store.getRoom(roomId)!;
    async function action(socket: Socket, actionId: string, data: Record<string, unknown> = {}) {
      const commandId = randomUUID();
      const result = new Promise<void>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); socket.off('stateDelta', updated); socket.off('error', failed); };
        const updated = (value: { commandId?: string }) => { if (value.commandId === commandId) { cleanup(); resolve(); } };
        const failed = (value: { message: string }) => { cleanup(); reject(new Error(value.message)); };
        const timer = setTimeout(() => { cleanup(); reject(new Error('No command result')); }, 2000); socket.on('stateDelta', updated); socket.on('error', failed);
      });
      socket.emit('playerAction', { protocolVersion: 1, roomId, commandId, actionId, ...data }); await result;
    }
    for (const [session, socket] of [[a, p1], [b, p2]] as const) {
      const rock = room().players[session.playerId].hand.find(card => card.blueprint.id === 'rock')!; await action(socket, 'rpsPlay', { cardUuid: rock.uuid });
    }
    expect(room().status).toBe('playing');
    const actor = () => room().priorityPlayerId === a.playerId ? p1 : p2;
    for (let i = 0; room().phase !== 'stateMainPhase' && i < 12; i++) await action(actor(), 'pass_priority');
    expect(room().phase).toBe('stateMainPhase');
    const initialTurn = room().turnNumber!, active = room().activeTurnPlayerId;
    const land = room().players[active].hand.find(card => card.blueprint.id === 'land-red')!;
    await action(active === a.playerId ? p1 : p2, 'play_land', { cardUuid: land.uuid, zoneRevision: land.state.zoneRevision ?? 0 });
    expect((await builder.save(undefined, { ...deck, name: 'Edited while playing' }, saved.id)).name).toBe('Edited while playing');
    expect((await web.client.me()).session?.sessionId).toBe(identity.session?.sessionId);
    expect(application.auth.sessions.validate(a.token)).toBeDefined(); expect(p1.connected).toBe(true);
    expect((await verifyRoomResume(roomId, a, undefined, (input, init) => fetch(url + input, init))).playerId).toBe(a.playerId);
    for (let i = 0; room().turnNumber === initialTurn && i < 30; i++) {
      const declaring = declarationPlayer(room());
      if (declaring) await action(declaring === a.playerId ? p1 : p2, room().phase === 'declareAttackersStep' ? 'declare_attackers' : 'declare_blockers', room().phase === 'declareAttackersStep' ? { attackers: [] } : { assignments: [] });
      else await action(actor(), 'pass_priority');
    }
    expect(room().turnNumber).toBe(initialTurn + 1); expect(web.headers).toHaveLength(1);
    expect(room().setup!.playerDecks![a.playerId]).toHaveLength(60);
  });

  it('uses separate instance identity/cookie names and rejects live credentials in a lab instance', async () => {
    const live = browser(); await live.client.authenticate('register', 'alice', password); const child = await live.client.tab();
    const lab = createGameApplication({ environment: { NODE_ENV: 'test', DELTA_LOG_PATH: '' }, configuration: { navigation: { instanceId: 'isolated-lab', purpose: 'lab', label: 'Local Test Lab' } } });
    await lab.ready; await new Promise<void>(resolve => lab.server.listen(0, '127.0.0.1', resolve));
    try {
      const address = lab.server.address(); if (!address || typeof address === 'string') throw new Error('No lab address'); const labUrl = 'http://127.0.0.1:' + address.port;
      const metadata = await (await fetch(labUrl + '/api/platform')).json(); expect(metadata.navigation.instanceId).toBe('isolated-lab'); expect(metadata.capabilities.scenarios).toBe(false);
      const token = [...live.cookies.values()][0];
      const me = await (await fetch(labUrl + '/api/browser/me', { headers: { Cookie: browserCookieName(lab.config) + '=' + token } })).json(); expect(me.session).toBeNull();
      expect((await fetch(labUrl + '/api/auth/me', { headers: { Authorization: 'Bearer ' + child.token } })).status).toBe(401);
      expect(lab.auth.repository.findByUsername('alice')).toBeUndefined();
      const labBrowser = await lab.auth.register({ username: 'lab-admin', password }, undefined, true);
      const labChild = lab.auth.gameTab(lab.auth.sessions.validate(labBrowser.token)!);
      expect((await request('/api/auth/me', 'GET', { Authorization: 'Bearer ' + labChild.token })).status).toBe(401);
      const liveMe = await (await request('/api/browser/me', 'GET', { Cookie: browserCookieName(application.config) + '=' + labBrowser.token })).json(); expect(liveMe.session).toBeNull();
    } finally { await new Promise<void>(resolve => lab.io.close(() => resolve())); }
  });

  it('disabling an account revokes its cookie family and child socket immediately', async () => {
    const web = browser(), identity = await web.client.authenticate('register', 'alice', password), child = await web.client.tab(), socket = await socketFor(child);
    await application.auth.bootstrapAdmin('operator', password); const admin = await application.auth.login({ username: 'operator', password, scope: 'admin' });
    const ended = once(socket, 'disconnect');
    expect((await request('/api/admin/accounts/' + identity.session!.account!.id + '/disable', 'POST', { Authorization: 'Bearer ' + admin.token }, { protocolVersion: 1 })).status).toBe(200); await ended;
    expect((await web.client.me()).session).toBeNull(); expect(application.auth.sessions.validate(child.token)).toBeUndefined(); expect(application.auth.sessions.validate(admin.token)).toBeDefined();
  });

  it('does not let a legacy player-ID collision inherit a seat transferred to a tab', async () => {
    const legacy = await application.auth.register({ username: 'alice', password }), original = await socketFor(legacy);
    const created = once<{ roomId: string }>(original, 'roomCreated'); original.emit('createRoom', { protocolVersion: 1 }); const roomId = (await created).roomId;
    const web = browser(); await web.client.authenticate('login', 'alice', password); const linked = await web.client.tab(legacy, roomId);
    expect(linked.playerId).toBe(legacy.playerId);
    const fresh = await application.auth.login({ username: 'alice', password }); expect(fresh.playerId).toBe(linked.playerId);
    await expect(verifyRoomResume(roomId, fresh, undefined, (input, init) => fetch(url + input, init))).rejects.toThrow('unavailable');
    const socket = connect(url, { transports: ['websocket'], reconnection: false, autoConnect: false, auth: { protocolVersion: 1, token: fresh.token, roomId } }); sockets.push(socket);
    const snapshot = vi.fn(); socket.on('roomSnapshot', snapshot); const denied = once(socket, 'rejoinFailed'); socket.connect(); await denied;
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('sets production host-only Secure cookie flags and serves compatible public routes without swallowing APIs', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'card-game-public-shell-')); writeFileSync(join(directory, 'index.html'), '<!doctype html><h1>public-shell</h1>');
    const app = createGameApplication({ publicClientDirectory: directory, environment: { NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://game.example', DELTA_LOG_PATH: '' } });
    await app.ready; await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    try {
      const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('No address'); const base = 'http://127.0.0.1:' + address.port;
      const registered = await fetch(base + '/api/browser/register', { method: 'POST', headers: { Origin: 'https://game.example', 'Content-Type': 'application/json', 'X-Card-Game-Client': 'browser-v1' }, body: JSON.stringify({ protocolVersion: 1, username: 'secure-user', password }) });
      expect(registered.status).toBe(201); const cookie = registered.headers.getSetCookie()[0];
      expect(cookie).toContain('__Host-cardgame-live-game='); expect(cookie).toContain('Secure'); expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict'); expect(cookie).not.toContain('Domain=');
      for (const path of ['/', '/home', '/home/', '/play', '/play/', '/play/rooms/opaque-room']) {
        const result = await fetch(base + path); expect(result.status).toBe(200); expect(await result.text()).toContain('public-shell');
      }
      const missing = await fetch(base + '/api/missing'); expect(missing.status).toBe(404); expect(await missing.json()).toMatchObject({ protocolVersion: 1 });
      expect((await fetch(base + '/admin/')).status).toBe(404);
    } finally { await new Promise<void>(resolve => app.io.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
  });
  it('shares the password-attempt limit across cookie and legacy login endpoints', async () => {
    const app = createGameApplication({ environment: { NODE_ENV: 'test', DELTA_LOG_PATH: '' }, configuration: { auth: { rateLimit: { limit: 2 } } } }); await app.ready;
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    try {
      const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('No address'); const base = 'http://127.0.0.1:' + address.port;
      const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Card-Game-Client': 'browser-v1' }, body = JSON.stringify({ protocolVersion: 1, username: 'alice', password });
      expect((await fetch(base + '/api/browser/register', { method: 'POST', headers, body })).status).toBe(201);
      expect((await fetch(base + '/api/auth/login', { method: 'POST', headers, body })).status).toBe(200);
      expect((await fetch(base + '/api/browser/login', { method: 'POST', headers, body })).status).toBe(429);
    } finally { await new Promise<void>(resolve => app.io.close(() => resolve())); }
  });
});
