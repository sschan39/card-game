import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicSessionClient, resolvePublicRoute, safeReturnPath, verifyRoomResume } from '@card-game/browser-session';
import { NavigationConfigSchema, BrowserIdentitySchema, type AuthResponse } from '@card-game/protocol';
import { WorkspaceHeader, workspaceLinks } from '@card-game/ui';
import App from '@client/App';
import { useSocket } from '@client/hooks/useSocket';
import { useGameStore } from '@client/store/gameStore';

vi.mock('@client/socket', () => ({ default: { emit: vi.fn(), on: vi.fn(), off: vi.fn() }, connectWithSession: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@client/hooks/useSocket', () => ({ useSocket: vi.fn() }));
vi.mock('@client/store/gameStore', async importOriginal => {
  const actual = await importOriginal<typeof import('@client/store/gameStore')>();
  return { ...actual, useGameStore: Object.assign((selector: (state: ReturnType<typeof actual.useGameStore.getState>) => unknown) => selector(actual.useGameStore.getState()), actual.useGameStore) };
});
const navigation = { instanceId: 'local-game', purpose: 'development' as const, label: 'Local development', home: 'http://localhost:5173/home', play: 'http://localhost:5173/play', decks: 'http://localhost:5175/deck-builder/', admin: 'http://localhost:5174/admin/', lab: null };
const account = { id: 'a', username: 'alice', role: 'player' as const };
const tab: AuthResponse = { protocolVersion: 1, token: 't'.repeat(43), sessionId: 'tab', playerId: 'tab:p', expiresAt: Date.now() + 60000, scope: 'game', account };
const { token: _token, ...info } = tab;
const identity = { protocolVersion: 1, session: info, csrf: 'c'.repeat(43) };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('public-session transport', () => {
  it('uses cookie-managed sign-in and CSRF headers without storage or a bearer URL', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(identity)).mockResolvedValueOnce(response({ protocolVersion: 1, deck: {} }));
    const client = new PublicSessionClient(fetcher); await client.authenticate('login', 'alice', 'private-password');
    expect(fetcher.mock.calls[0][0]).toBe('/api/browser/login'); expect(fetcher.mock.calls[0][1].credentials).toBe('include');
    expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty('Authorization'); expect(fetcher.mock.calls[0][1].headers['X-Card-Game-Client']).toBe('browser-v1');
    await client.request('/api/decks', { method: 'POST', body: { protocolVersion: 1, deck: {} } });
    expect(fetcher.mock.calls[1][1].headers['X-CSRF-Token']).toBe(identity.csrf); expect(fetcher.mock.calls[1][1].headers).not.toHaveProperty('Authorization');
  });
  it('restores the CSRF token with a read before cookie writes and forwards cancellation', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(identity)).mockResolvedValueOnce(response(tab));
    const client = new PublicSessionClient(fetcher); expect(await client.tab()).toEqual(tab);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/browser/me', '/api/browser/tab']);
    const controller = new AbortController(); fetcher.mockResolvedValue(response({ protocolVersion: 1, navigation, capabilities: { scenarios: false } }));
    await client.platform(controller.signal); expect(fetcher.mock.calls.at(-1)![1].signal).toBe(controller.signal);
    expect(BrowserIdentitySchema.safeParse({ ...identity, session: { ...info, scope: 'admin' } }).success).toBe(false);
  });
  it('does not let a late old identity replace the CSRF token of a newer login', async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(response({ ...identity, csrf: 'n'.repeat(43) })).mockResolvedValue(response({ ok: true }));
    const client = new PublicSessionClient(fetcher), pending = client.me();
    await client.authenticate('login', 'alice', 'password'); finish(response(identity)); expect((await pending).csrf).toBe('n'.repeat(43));
    await client.request('/api/decks', { method: 'POST', body: {} }); expect(fetcher.mock.calls.at(-1)![1].headers['X-CSRF-Token']).toBe('n'.repeat(43));
  });
  it('rejects public API escapes and malformed sign-in replies with safe errors', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ passwordHash: 'do-not-display' })), client = new PublicSessionClient(fetcher);
    for (const path of ['https://external.example/api/decks', '/api/admin/me', '/api/decks/../admin/me', '/api/decks/%2e%2e/admin', '/api/decks/%2fadmin']) await expect(client.request(path, { method: 'POST' })).rejects.toThrow('destination');
    expect(fetcher).not.toHaveBeenCalled(); await expect(client.authenticate('login', 'alice', 'password')).rejects.toThrow('incompatible sign-in response');
  });
  it('clears CSRF state on global logout and refuses subsequent writes when the browser session is gone', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(identity)).mockResolvedValueOnce(response({ protocolVersion: 1, ok: true })).mockResolvedValue(response({ protocolVersion: 1, session: null, csrf: null }));
    const client = new PublicSessionClient(fetcher); await client.logout(true); expect(fetcher.mock.calls[1][0]).toBe('/api/browser/logout-all');
    await expect(client.request('/api/decks', { method: 'POST' })).rejects.toMatchObject({ status: 401 }); expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe('navigation registry, routes and room authority', () => {
  it('keeps administrator destinations conditional and game workspace links in new tabs', () => {
    expect(workspaceLinks(navigation, false).map(link => link.id)).toEqual(['home', 'play', 'decks']);
    expect(workspaceLinks(navigation, true).map(link => link.id)).toEqual(['home', 'play', 'decks', 'admin']);
    const html = renderToStaticMarkup(createElement(WorkspaceHeader, { navigation, current: 'play', account: { ...account, role: 'admin' }, activeRoomId: 'room-1' }));
    expect(html).toContain('Local development'); expect(html).toContain('Test Lab — unavailable'); expect(html).toContain('rel="noopener noreferrer"'); expect(html).toContain('target="_blank"'); expect(html).not.toContain('/api/admin');
  });
  it('accepts configured workspace subpages without adding them to the main menu', () => {
    const configured = NavigationConfigSchema.parse({ ...navigation, extraPages: [{ id: 'help', label: 'Play help', workspace: 'play', href: '/play/help', adminOnly: false }] });
    const html = renderToStaticMarkup(createElement(WorkspaceHeader, { navigation: configured, current: 'play', account }));
    expect(html).toContain('aria-label="Workspace pages"'); expect(html).toContain('Play help'); expect(workspaceLinks(configured, false)).toHaveLength(3);
    expect(NavigationConfigSchema.safeParse({ ...navigation, extraPages: [{ ...configured.extraPages[0], href: 'javascript:alert(1)' }] }).success).toBe(false);
    expect(NavigationConfigSchema.safeParse({ ...navigation, extraPages: [configured.extraPages[0], configured.extraPages[0]] }).success).toBe(false);
  });
  it('resolves legacy, Home, lobby and room paths while rejecting malformed references', () => {
    expect(resolvePublicRoute('/')).toEqual({ kind: 'play' }); expect(resolvePublicRoute('/home/')).toEqual({ kind: 'home' });
    expect(resolvePublicRoute('/play/rooms/room-1')).toEqual({ kind: 'room', roomId: 'room-1' });
    for (const path of ['/unknown', '/play/rooms/%2fadmin', '/play/rooms/%broken', '/play/rooms/', '/play/rooms/' + 'x'.repeat(129)]) expect(resolvePublicRoute(path)).toEqual({ kind: 'invalid' });
    for (const path of ['https://evil.example', '//evil.example', '/\\evil', '/api/admin/me', '/home?token=bad', '/home#other']) expect(safeReturnPath(path)).toBe('/home');
    expect(safeReturnPath('/deck-builder/')).toBe('/deck-builder/'); expect(safeReturnPath('/play/rooms/room-1')).toBe('/play/rooms/room-1');
  });
  it('requires a matching room and session before adopting the server-derived player identity', async () => {
    const fetcher = vi.fn().mockImplementation(async () => response({ protocolVersion: 1, sessionId: tab.sessionId, roomId: 'room-1', playerId: 'linked-guest-seat' }));
    expect((await verifyRoomResume('room-1', tab, undefined, fetcher)).roomId).toBe('room-1');
    expect((await verifyRoomResume('room-1', tab, undefined, fetcher)).playerId).toBe('linked-guest-seat');
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer ' + tab.token);
    fetcher.mockResolvedValue(response({ protocolVersion: 1, sessionId: 'sibling-session', roomId: 'room-1', playerId: 'other-seat' })); await expect(verifyRoomResume('room-1', tab, undefined, fetcher)).rejects.toThrow('identity');
    fetcher.mockResolvedValue(response({}, 404)); await expect(verifyRoomResume('room-1', tab, undefined, fetcher)).rejects.toThrow('unavailable');
    fetcher.mockClear(); await expect(verifyRoomResume('../escape', tab, undefined, fetcher)).rejects.toThrow('Invalid room'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('starts the connection from the lobby root and keeps Home/invalid routes from opening game seats', () => {
    useGameStore.setState({ roomId: null, room: null, error: null });
    for (const [pathname, enabled] of [['/home', false], ['/play', true], ['/', true], ['/unknown', false]] as const) {
      vi.stubGlobal('window', { location: { pathname, origin: 'http://localhost:5173', search: '' } });
      const html = renderToStaticMarkup(createElement(App)); expect(useSocket).toHaveBeenLastCalledWith(enabled);
      if (pathname === '/home') expect(html).toContain('Your decks'); if (pathname === '/unknown') expect(html).toContain('Page unavailable');
    }
  });
});
