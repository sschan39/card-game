import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminIdentityResponseSchema, type AuthResponse } from '@card-game/protocol';
import { AdminApi } from '@admin/api';
import { adminUi } from '@admin/config';
import { readAdminSession, saveAdminSession, validAdminSession } from '@admin/session';
import { resolveRoute } from '@admin/router';
import App from '@admin/App';
import { RoomInspector } from '@admin/pages/Rooms';
import { subscribeResource } from '@admin/resource';

const now = 1000;
const session = (id = 'admin-session'): AuthResponse => ({ protocolVersion: 1, token: 'a'.repeat(43), sessionId: id, expiresAt: 10000, scope: 'admin', playerId: 'account:operator', account: { id: 'operator', username: 'operator', role: 'admin' } });
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
afterEach(() => vi.unstubAllGlobals());

describe('separate admin session and API logic', () => {
  it('uses only the dedicated storage key and rejects game, expired and malformed sessions', () => {
    const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    values.set('cardgame.authSession', JSON.stringify(session())); expect(readAdminSession(storage, now)).toBeNull();
    saveAdminSession(storage, session()); expect(readAdminSession(storage, now)?.sessionId).toBe('admin-session');
    expect(validAdminSession({ ...session(), scope: 'game' }, now)).toBeNull(); expect(validAdminSession(session(), 10000)).toBeNull();
    values.set(adminUi.storageKey, '{invalid'); expect(readAdminSession(storage, now)).toBeNull();
    saveAdminSession(storage, null); expect(values.has(adminUi.storageKey)).toBe(false); expect(values.has('cardgame.authSession')).toBe(true);
  });
  it('requests a fresh admin login without borrowing or persisting game credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(session())), ended = vi.fn(), api = new AdminApi(() => null, ended, fetcher, () => now);
    expect((await api.login('operator', 'password supplied only to login')).scope).toBe('admin');
    const [path, options] = fetcher.mock.calls[0]; expect(path).toBe('/api/auth/login'); expect(options.headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(options.body)).toEqual({ protocolVersion: 1, username: 'operator', password: 'password supplied only to login', scope: 'admin' });
    fetcher.mockResolvedValue(response({ ...session(), scope: 'game' })); await expect(api.login('operator', 'password')).rejects.toThrow('administrator session');
  });
  it('passes cancellation, validates responses and expires sessions before sending requests', async () => {
    const controller = new AbortController(), fetcher = vi.fn().mockResolvedValue(response({ protocolVersion: 1, account: session().account })), ended = vi.fn();
    const api = new AdminApi(() => session(), ended, fetcher, () => now);
    await expect(api.get('https://external.example/api/admin/me', AdminIdentityResponseSchema)).rejects.toThrow('destination'); expect(fetcher).not.toHaveBeenCalled();
    await api.get('/api/admin/me', AdminIdentityResponseSchema, controller.signal);
    expect(fetcher).toHaveBeenCalledWith('/api/admin/me', { signal: controller.signal, headers: { Authorization: 'Bearer ' + session().token } });
    fetcher.mockResolvedValue(response({ protocolVersion: 9 })); await expect(api.get('/api/admin/me', AdminIdentityResponseSchema)).rejects.toThrow('incompatible');
    const expired = new AdminApi(() => session(), ended, fetcher, () => 10001); fetcher.mockClear(); await expect(expired.get('/api/admin/me', AdminIdentityResponseSchema)).rejects.toThrow('ended'); expect(fetcher).not.toHaveBeenCalled(); expect(ended).toHaveBeenCalled();
  });
  it('does not let a late 401 or logout clear a newer login', async () => {
    let current = session('old'), resolve!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(done => { resolve = done; })), ended = vi.fn();
    const api = new AdminApi(() => current, ended, fetcher, () => now), pending = api.get('/api/admin/me', AdminIdentityResponseSchema);
    current = session('new'); resolve(response({ protocolVersion: 1, message: 'Expired' }, 401)); await expect(pending).rejects.toThrow('Expired'); expect(ended).not.toHaveBeenCalled();
    const logout = api.logout(); current = session('newer'); resolve(response({}, 200)); await logout; expect(ended).not.toHaveBeenCalled();
  });
  it('clears the current login on 401 and on failed sign-out without exposing raw server errors', async () => {
    const ended = vi.fn(), fetcher = vi.fn().mockResolvedValue(response({ privateError: 'internal secret' }, 401));
    const api = new AdminApi(() => session(), ended, fetcher, () => now); await expect(api.get('/api/admin/me', AdminIdentityResponseSchema)).rejects.toThrow('session ended'); expect(ended).toHaveBeenCalledTimes(1);
    fetcher.mockRejectedValue(new Error('network failure')); await expect(api.logout()).rejects.toThrow('network'); expect(ended).toHaveBeenCalledTimes(2);
  });
  it.each([['#rooms', 'rooms'], ['#/logs', 'logs'], ['#accounts', 'accounts'], ['#config', 'config'], ['#unknown', 'rooms']])('resolves the hash route %s', (hash, route) => { expect(resolveRoute(hash)).toBe(route); });
  it('renders an accessible login and escapes authoritative inspector content', () => {
    const html = renderToStaticMarkup(createElement(App)); expect(html).toContain('type="password"'); expect(html).toContain('autoComplete="current-password"'); expect(html).toContain('Administrator access only');
    const inspector = renderToStaticMarkup(createElement(RoomInspector, { room: { player1Id: 'p1', players: { p1: { life: 20, hand: [{ blueprint: { name: '<script>attack()</script>' } }], deck: [] } }, phase: 'stateMainPhase', turnNumber: 1, priorityPlayerId: 'p1' } }));
    expect(inspector).toContain('&lt;script&gt;'); expect(inspector).not.toContain('<script>attack'); expect(inspector).toContain('Full room data'); expect(inspector).toContain('Player 1');
  });
  it.each([['rooms', 'Rooms'], ['logs', 'Game logs'], ['accounts', 'Accounts'], ['config', 'Configuration']])('renders the independent %s route and navigation', (route, title) => {
    const value = { ...session(), expiresAt: Date.now() + 60000 };
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => key === adminUi.storageKey ? JSON.stringify(value) : null });
    vi.stubGlobal('window', { location: { hash: '#' + route } });
    const html = renderToStaticMarkup(createElement(App)); expect(html).toContain('aria-current="page"'); expect(html).toContain(`<h1>${title}</h1>`); expect(html).toContain('Sign out');
  });
  it('cancels stale results and avoids overlapping poll requests', async () => {
    vi.useFakeTimers();
    try {
      const changed = vi.fn(); let resolve!: (value: string) => void, observed!: AbortSignal;
      const load = vi.fn((signal: AbortSignal) => { observed = signal; return new Promise<string>(done => { resolve = done; }); });
      const stop = subscribeResource(load, changed, 1000);
      await vi.advanceTimersByTimeAsync(5000); expect(load).toHaveBeenCalledTimes(1);
      stop(); expect(observed.aborted).toBe(true); resolve('stale room'); await Promise.resolve();
      expect(changed).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(5000); expect(load).toHaveBeenCalledTimes(1);
      const values = vi.fn(), cancel = subscribeResource(async () => 'new room', values); await Promise.resolve();
      expect(values).toHaveBeenLastCalledWith({ data: 'new room', error: null, loading: false }); cancel();
    } finally { vi.useRealTimers(); }
  });
});
