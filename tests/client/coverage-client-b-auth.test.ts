import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, type AuthResponse } from '@card-game/protocol';
import { useAuthStore } from '@client/auth-state';
import { getStoredAuth, getStoredRoomId, setStoredRoomId } from '@client/session';
import { publicSession } from '@card-game/browser-session';

const password = 'coverage-client-b-password';
const session = (id = 'session-1', account = false): AuthResponse => ({
  protocolVersion: PROTOCOL_VERSION, scope: 'game', sessionId: id, token: (id === 'session-1' ? 'A' : 'B').repeat(43),
  expiresAt: Date.now() + 60_000, playerId: 'server-seat',
  account: account ? { id: 'account-1', username: 'alice', role: 'player' } : null,
});
const info = (value: AuthResponse) => {
  const { token: _token, ...rest } = value;
  return rest;
};
const identity = (value: AuthResponse | null = session('browser', true)) => ({
  protocolVersion: PROTOCOL_VERSION, session: value ? info(value) : null,
  csrf: value ? 'c'.repeat(43) : null,
});
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('fetch', vi.fn());
  useAuthStore.setState({ session: null, browserSession: null, busy: false, error: null });
  vi.spyOn(publicSession, 'me').mockResolvedValue(identity(null));
  vi.spyOn(publicSession, 'authenticate').mockResolvedValue(identity());
  vi.spyOn(publicSession, 'tab').mockResolvedValue(session('account-session', true));
  vi.spyOn(publicSession, 'logout').mockResolvedValue();
  vi.spyOn(publicSession, 'invalidate').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setStoredRoomId(null);
});

describe('guest request failure paths', () => {
  it('surfaces structured auth errors and falls back for malformed error bodies', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ protocolVersion: 1, message: 'No guest seat.' }, 400));
    await expect(useAuthStore.getState().ensureGuest()).rejects.toThrow('No guest seat.');
    expect(useAuthStore.getState().error).toBeNull();

    vi.mocked(fetch).mockResolvedValueOnce(response({ nope: true }, 400));
    await expect(useAuthStore.getState().ensureGuest()).rejects.toThrow('Authentication request failed.');
    expect(useAuthStore.getState().error).toBeNull();
  });

  it('rejects malformed successful guest responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ protocolVersion: 1, sessionId: 'missing-token' }));
    await expect(useAuthStore.getState().ensureGuest()).rejects.toThrow('incompatible sign-in response');
  });

  it('uses the generic message when authenticate rejects with a non-Error value', async () => {
    vi.mocked(publicSession.authenticate).mockRejectedValueOnce('offline');
    await expect(useAuthStore.getState().authenticate('login', 'alice', password)).rejects.toBe('offline');
    expect(useAuthStore.getState().error).toBe('Authentication request failed.');
    expect(useAuthStore.getState().busy).toBe(false);
  });
});

describe('preferBrowser guest path', () => {
  it('adopts a browser session for a fresh tab and discards a stale room', async () => {
    setStoredRoomId('stale-room');
    vi.mocked(publicSession.me).mockResolvedValueOnce(identity());
    await expect(useAuthStore.getState().ensureGuest(true)).resolves.toMatchObject({ sessionId: 'account-session' });
    expect(publicSession.tab).toHaveBeenCalledWith(null, undefined);
    expect(getStoredRoomId()).toBeNull();
    expect(useAuthStore.getState().browserSession?.sessionId).toBe('browser');
  });

  it('carries a valid tab identity and its room through the exchange', async () => {
    const current = session('existing', true);
    useAuthStore.getState().setSession(current);
    setStoredRoomId('room-1');
    vi.mocked(publicSession.me).mockResolvedValueOnce(identity());
    await useAuthStore.getState().ensureGuest(true);
    expect(publicSession.tab).toHaveBeenCalledWith(current, 'room-1');
  });

  it('continues to seat verification when the browser is signed out', async () => {
    const current = session('existing', true);
    useAuthStore.getState().setSession(current);
    setStoredRoomId('room-1');
    vi.mocked(fetch).mockResolvedValueOnce(response(info(current)));
    await expect(useAuthStore.getState().ensureGuest(true)).resolves.toMatchObject({ sessionId: 'existing', playerId: 'server-seat' });
    expect(publicSession.tab).not.toHaveBeenCalled();
  });

  it('cancels a browser identity that arrives after a local logout', async () => {
    let release!: (value: ReturnType<typeof identity>) => void;
    vi.mocked(publicSession.me).mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const pending = useAuthStore.getState().ensureGuest(true);
    await vi.waitFor(() => expect(publicSession.me).toHaveBeenCalled());
    await useAuthStore.getState().logout('tab');
    release(identity());
    await expect(pending).rejects.toThrow('Session setup cancelled.');
  });
});

describe('existing seat verification', () => {
  it('returns server session info without a room and rejects mismatched identities', async () => {
    const current = session('existing', true);
    useAuthStore.getState().setSession(current);
    vi.mocked(fetch).mockResolvedValueOnce(response(info(current)));
    expect((await useAuthStore.getState().ensureGuest()).sessionId).toBe('existing');

    for (const body of [
      { ...info(current), sessionId: 'other' },
      { ...info(current), scope: 'admin' },
      { protocolVersion: 1 },
    ]) {
      useAuthStore.getState().setSession(current);
      vi.mocked(fetch).mockResolvedValueOnce(response(body));
      await expect(useAuthStore.getState().ensureGuest()).rejects.toThrow('Incompatible game session');
    }
  });

  it('treats 401/403 as a signed-out seat and refuses other verification failures', async () => {
    const current = session('existing', true);
    useAuthStore.getState().setSession(current);
    vi.mocked(fetch).mockResolvedValueOnce(response({}, 401));
    vi.mocked(fetch).mockResolvedValueOnce(response(session('guest', false)));
    await expect(useAuthStore.getState().ensureGuest()).resolves.toMatchObject({ sessionId: 'guest' });

    useAuthStore.getState().setSession(current);
    vi.mocked(fetch).mockResolvedValueOnce(response({}, 500));
    await expect(useAuthStore.getState().ensureGuest()).rejects.toThrow('Unable to verify the game session');
  });

  it('keeps a newer session that arrives while the old seat is being verified', async () => {
    const current = session('existing', true);
    useAuthStore.getState().setSession(current);
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = useAuthStore.getState().ensureGuest();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    useAuthStore.getState().setSession(session('newer', true));
    finish(response({}, 401));
    expect((await pending).sessionId).toBe('newer');
  });

  it('cancels verification after the account generation changes', async () => {
    const current = session('existing', true);
    useAuthStore.getState().setSession(current);
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = useAuthStore.getState().ensureGuest();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    vi.mocked(fetch).mockResolvedValueOnce(response({ ok: true }));
    await useAuthStore.getState().logout('tab');
    finish(response({}, 401));
    await expect(pending).rejects.toThrow('Session setup cancelled.');
  });

  it('cancels a guest identity fetched after the generation changes', async () => {
    let finish!: (value: ReturnType<typeof identity>) => void;
    vi.mocked(publicSession.me).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = useAuthStore.getState().ensureGuest();
    await vi.waitFor(() => expect(publicSession.me).toHaveBeenCalledTimes(1));
    await useAuthStore.getState().logout('tab');
    finish(identity(null));
    await expect(pending).rejects.toThrow('Session setup cancelled.');
  });
});

describe('logout variants', () => {
  it('ends all public sessions for the same account when the bearer is already gone', async () => {
    const current = session('existing', true);
    useAuthStore.getState().setSession(current);
    vi.mocked(fetch).mockResolvedValueOnce(response({}, 403));
    vi.mocked(publicSession.me).mockResolvedValueOnce(identity({ ...current, account: { ...current.account!, id: 'other' } }));
    await expect(useAuthStore.getState().logout('all')).rejects.toThrow('Sign in to this account');

    useAuthStore.getState().setSession(current);
    vi.mocked(fetch).mockResolvedValueOnce(response({}, 401));
    vi.mocked(publicSession.me).mockResolvedValueOnce(identity(current));
    await useAuthStore.getState().logout('all');
    expect(publicSession.logout).toHaveBeenCalledWith(true);
    expect(useAuthStore.getState().session).toBeNull();
  });

  it('refreshes the browser identity after a confirmed global sign-out', async () => {
    const current = session('existing', true);
    useAuthStore.getState().setSession(current);
    vi.mocked(fetch).mockResolvedValueOnce(response({ protocolVersion: 1, ok: true }));
    vi.mocked(publicSession.me).mockResolvedValueOnce(identity(null));
    await useAuthStore.getState().logout('all');
    expect(publicSession.invalidate).toHaveBeenCalled();
    expect(useAuthStore.getState().browserSession).toBeNull();
  });

  it('clears the browser session on an ordinary logout and ignores a 401 bearer rejection', async () => {
    const current = session('existing', true);
    useAuthStore.getState().setSession(current);
    vi.mocked(fetch).mockResolvedValueOnce(response({}, 401));
    vi.mocked(publicSession.me).mockResolvedValueOnce(identity());
    await useAuthStore.getState().logout();
    expect(publicSession.logout).toHaveBeenCalledWith(false);
    expect(useAuthStore.getState().session).toBeNull();
  });

  it('skips public logout when the browser is already signed out', async () => {
    useAuthStore.getState().setSession(session('existing', true));
    vi.mocked(fetch).mockResolvedValueOnce(response({}, 401));
    vi.mocked(publicSession.me).mockResolvedValueOnce(identity(null));
    await useAuthStore.getState().logout();
    expect(publicSession.logout).not.toHaveBeenCalled();
    expect(useAuthStore.getState().browserSession).toBeNull();
  });

  it('reports a failed tab sign-out and clears local credentials', async () => {
    useAuthStore.getState().setSession(session('existing', true));
    vi.mocked(fetch).mockResolvedValueOnce(response({}, 500));
    await expect(useAuthStore.getState().logout()).rejects.toThrow('Server sign-out failed');
    expect(getStoredAuth()).toBeNull();
  });

  it('uses the generic sign-out error for non-Error failures', async () => {
    useAuthStore.getState().setSession(session('existing', true));
    vi.mocked(fetch).mockRejectedValueOnce('offline');
    await expect(useAuthStore.getState().logout('tab')).rejects.toBe('offline');
    expect(useAuthStore.getState().error).toBe('Sign-out failed.');
  });

  it('preserves the tab browser identity and skips public logout for tab mode', async () => {
    const browser = info(session('browser', true));
    useAuthStore.setState({ browserSession: browser, session: session('existing', true) });
    vi.mocked(fetch).mockResolvedValueOnce(response({}, 401));
    await useAuthStore.getState().logout('tab');
    expect(publicSession.logout).not.toHaveBeenCalled();
    expect(useAuthStore.getState().browserSession).toEqual(browser);
  });
});
