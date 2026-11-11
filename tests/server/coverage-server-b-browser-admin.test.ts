import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AdminRoomsResponseSchema, AuthResponseSchema, PROTOCOL_VERSION } from '@card-game/protocol';
import { createGameApplication } from '@server/application';
import { browserCookieName } from '@server/auth/browser-routes';
import { createTestRoom } from '../helpers/test-room-factory';

const password = 'copper lantern river orchard';
const origin = 'http://localhost:5173';
const browserHeaders = { Origin: origin, 'X-Card-Game-Client': 'browser-v1' };

describe('browser and administrative HTTP boundaries', () => {
  let application: ReturnType<typeof createGameApplication>, url: string;

  beforeEach(async () => {
    application = createGameApplication({
      environment: { NODE_ENV: 'test', DELTA_LOG_PATH: '', INSPECTOR_ENABLED: 'true' },
    });
    await application.ready;
    await new Promise<void>(resolve => application.server.listen(0, '127.0.0.1', resolve));
    const address = application.server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    url = 'http://127.0.0.1:' + address.port;
    await application.auth.bootstrapAdmin('operator', password);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (application) await new Promise<void>(resolve => application.io.close(() => resolve()));
  });

  const request = (path: string, token?: string, body?: unknown) =>
    fetch(url + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  const auditRecords = () => application.store.audit.pendingAudit(100);

  async function login(username: string) {
    const response = await request('/api/auth/login', undefined, {
      protocolVersion: PROTOCOL_VERSION,
      username,
      password,
      scope: 'admin',
    });
    expect(response.status).toBe(200);
    return AuthResponseSchema.parse(await response.json());
  }

  function browser() {
    const cookies = new Map<string, string>();
    const call = async (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) => {
      const cookie = [...cookies].map(([key, value]) => key + '=' + value).join('; ');
      const response = await fetch(url + path, {
        method,
        headers: {
          ...headers,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      for (const setCookie of response.headers.getSetCookie()) {
        const [pair] = setCookie.split(';'), separator = pair.indexOf('=');
        const key = pair.slice(0, separator), value = pair.slice(separator + 1);
        if (value) cookies.set(key, value);
        else cookies.delete(key);
      }
      return response;
    };
    return { call, cookies };
  }

  it('ignores a malformed browser cookie and rejects malformed tab and sign-out bodies', async () => {
    const name = browserCookieName(application.config);
    const anonymous = await (await fetch(url + '/api/browser/me', { headers: { Cookie: name + '=too-short' } })).json();
    expect(anonymous).toMatchObject({ session: null, csrf: null });

    const web = browser();
    const registered = await web.call(
      '/api/browser/register',
      'POST',
      { protocolVersion: PROTOCOL_VERSION, username: 'browser-user', password },
      browserHeaders,
    );
    expect(registered.status).toBe(201);
    const identity = await (await web.call('/api/browser/me', 'GET')).json();
    expect(identity.session.account.username).toBe('browser-user');

    const csrf = { 'X-CSRF-Token': identity.csrf };
    expect((await web.call('/api/browser/tab', 'POST', {}, { ...browserHeaders, ...csrf })).status).toBe(400);
    expect((await web.call('/api/browser/logout', 'POST', {}, { ...browserHeaders, ...csrf })).status).toBe(400);
    expect(await (await web.call('/api/browser/me', 'GET')).json()).toMatchObject({
      session: { account: { username: 'browser-user' } },
    });
  });

  it('audits an unauthenticated admin denial and rejects unusable account disable targets', async () => {
    const guest = AuthResponseSchema.parse(
      await (await request('/api/auth/guest', undefined, { protocolVersion: PROTOCOL_VERSION })).json(),
    );
    expect((await request('/api/admin/me', guest.token)).status).toBe(403);
    expect(auditRecords().filter(record => record.action === 'admin.denied')).toEqual([
      expect.objectContaining({ actorId: null, target: 'admin', outcome: 'denied' }),
    ]);

    const admin = await login('operator'), missing = randomUUID();
    expect((await request('/api/admin/accounts/not-a-uuid/disable', admin.token, { protocolVersion: PROTOCOL_VERSION })).status).toBe(400);
    expect((await request('/api/admin/accounts/' + missing + '/disable', admin.token, { protocolVersion: PROTOCOL_VERSION })).status).toBe(404);
    expect(auditRecords().filter(record => record.action === 'account.disable')).toEqual([
      expect.objectContaining({ actorId: admin.account!.id, target: 'invalid-target', outcome: 'denied' }),
      expect.objectContaining({ actorId: admin.account!.id, target: missing, outcome: 'not_found' }),
    ]);
  });

  it('summarizes waiting and active rooms and refuses unusable room identifiers', async () => {
    const admin = await login('operator');
    const waiting = { ...createTestRoom({ roomId: 'waiting-room' }), player2Id: null, turnNumber: undefined };
    const active = createTestRoom({ roomId: 'active-room', turnNumber: 3 }), oversized = createTestRoom({ roomId: 'x'.repeat(129) });
    for (const room of [waiting, active, oversized]) application.store.saveRoom(room);

    const list = AdminRoomsResponseSchema.parse(await (await request('/api/admin/rooms', admin.token)).json());
    expect(list.total).toBe(3);
    const byId = new Map(list.rooms.map(room => [room.roomId, room]));
    expect(byId.get('waiting-room')).toMatchObject({ turnNumber: 0, players: 1 });
    expect(byId.get('active-room')).toMatchObject({ turnNumber: 3, players: 2 });
    expect((await request('/api/admin/rooms/not-a-room', admin.token)).status).toBe(404);
    expect((await request('/api/admin/rooms/' + oversized.roomId, admin.token)).status).toBe(404);
    expect(auditRecords().filter(record => record.action === 'room.inspect')).toEqual([
      expect.objectContaining({ target: 'unknown-room', outcome: 'not_found' }),
      expect.objectContaining({ target: 'invalid-target', outcome: 'not_found' }),
    ]);
  });

  it('omits a room that disappears between listing and reading it', async () => {
    const admin = await login('operator');
    application.store.saveRoom(createTestRoom({ roomId: 'listed-room' }));
    const listed = application.store.listRooms();
    vi.spyOn(application.store, 'listRooms').mockReturnValue([...listed, 'vanished-room']);
    const list = AdminRoomsResponseSchema.parse(await (await request('/api/admin/rooms', admin.token)).json());
    expect(list.rooms.map(room => room.roomId)).toEqual(['listed-room']);
    expect(list.total).toBe(2);
  });

  it('rejects an invalid diagnostic log page before reading the file', async () => {
    const admin = await login('operator');
    expect((await request('/api/admin/deltas?limit=0', admin.token)).status).toBe(400);
    expect(auditRecords().filter(record => record.action === 'logs.read')).toEqual([
      expect.objectContaining({ target: 'diagnostic-log', outcome: 'denied' }),
    ]);
  });

  it('hides the single-room view when inspection is switched off', async () => {
    const admin = await login('operator');
    application.store.saveRoom(createTestRoom({ roomId: 'inspect-room' }));
    const disabled = createGameApplication({
      store: application.store,
      environment: { NODE_ENV: 'test', DELTA_LOG_PATH: '', INSPECTOR_ENABLED: 'false' },
    });
    try {
      await disabled.ready;
      await new Promise<void>(resolve => disabled.server.listen(0, '127.0.0.1', resolve));
      const address = disabled.server.address();
      if (!address || typeof address === 'string') throw new Error('Missing port');
      const response = await fetch('http://127.0.0.1:' + address.port + '/api/admin/rooms/inspect-room', {
        headers: { Authorization: 'Bearer ' + admin.token },
      });
      expect(response.status).toBe(404);
      expect(await response.text()).toContain('Inspection disabled');
    } finally {
      await new Promise<void>(resolve => disabled.io.close(() => resolve()));
    }
  });
});
