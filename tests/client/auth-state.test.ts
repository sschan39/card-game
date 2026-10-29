import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, type AuthResponse } from '@card-game/protocol';
import { useAuthStore } from '@client/auth-state';
import { getStoredAuth, setStoredRoomId, clearStoredRoomId } from '@client/session';
import { getStoredRoomId } from '@client/session';
import { publicSession, PublicApiError } from '@card-game/browser-session';

const password = 'client-only-fixture-password';
const session = (id = 'session-1', account = false): AuthResponse => ({ protocolVersion: PROTOCOL_VERSION, scope: 'game',
  sessionId: id, token: (id === 'session-1' ? 'A' : 'B').repeat(43), expiresAt: Date.now() + 60_000, playerId: 'server-seat',
  account: account ? { id: 'account', username: 'alice', role: 'player' } : null });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  vi.stubGlobal('fetch', vi.fn());
  useAuthStore.setState({ session: null, browserSession: null, busy: false, error: null });
  vi.spyOn(publicSession, 'me').mockResolvedValue({ protocolVersion: 1, session: null, csrf: null });
  vi.spyOn(publicSession, 'authenticate').mockResolvedValue({ protocolVersion: 1, session: session('browser', true), csrf: 'c'.repeat(43) });
  vi.spyOn(publicSession, 'tab').mockResolvedValue(session('account-session', true));
  vi.spyOn(publicSession, 'logout').mockResolvedValue();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('game account client', () => {
  it('deduplicates guest issuance and stores only the returned server identity', async () => {
    vi.mocked(fetch).mockResolvedValue(response(session()));
    const values = await Promise.all([useAuthStore.getState().ensureGuest(), useAuthStore.getState().ensureGuest()]);
    expect(fetch).toHaveBeenCalledTimes(1); expect(values[0].playerId).toBe('server-seat'); expect(getStoredAuth()).toEqual(values[0]);
  });
  it('uses shared browser registration and exchanges its existing guest seat without persisting the password', async () => {
    const prior = session(); useAuthStore.getState().setSession(prior); setStoredRoomId('room');
    vi.mocked(publicSession.tab).mockResolvedValue({ ...session('account-session', true), roomId: 'room' });
    await useAuthStore.getState().authenticate('register', 'alice', password);
    expect(publicSession.authenticate).toHaveBeenCalledWith('register', 'alice', password);
    expect(publicSession.tab).toHaveBeenCalledWith(prior, 'room'); expect(fetch).not.toHaveBeenCalled();
    expect(getStoredAuth()?.account?.username).toBe('alice'); expect(JSON.stringify(useAuthStore.getState())).not.toContain(password);
  });
  it('does not let a delayed guest response overwrite a completed account login', async () => {
    let finishGuest!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finishGuest = resolve; }));
    const guest = useAuthStore.getState().ensureGuest();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const account = session('account-session', true); useAuthStore.getState().setSession(account);
    finishGuest(response(session()));
    expect(await guest).toEqual(account); expect(getStoredAuth()).toEqual(account);
  });
  it('keeps safe login errors visible and clears local credentials on logout failure', async () => {
    vi.mocked(publicSession.authenticate).mockRejectedValueOnce(new PublicApiError('Invalid username or password.', 401));
    await expect(useAuthStore.getState().authenticate('login', 'alice', password)).rejects.toThrow('Invalid username');
    expect(useAuthStore.getState().error).not.toContain(password);
    useAuthStore.getState().setSession(session('account-session', true)); vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    await expect(useAuthStore.getState().logout('tab')).rejects.toThrow('offline');
    expect(getStoredAuth()).toBeNull(); expect(useAuthStore.getState().session).toBeNull();
  });
  it('suppresses protocol validation details and refuses overlapping login requests', async () => {
    let fail!: (value: Error) => void;
    vi.mocked(publicSession.authenticate).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const pending = useAuthStore.getState().authenticate('login', 'alice', password);
    await expect(useAuthStore.getState().authenticate('login', 'alice', password)).rejects.toThrow('already in progress');
    fail(new Error('The server returned an incompatible sign-in response.'));
    await expect(pending).rejects.toThrow('incompatible sign-in response');
    expect(useAuthStore.getState().error).not.toContain('passwordHash');
  });
  it('uses browser sign-in for a fresh game tab without asking for a password', async () => {
    vi.mocked(publicSession.me).mockResolvedValue({ protocolVersion: 1, session: session('browser', true), csrf: 'c'.repeat(43) });
    expect((await useAuthStore.getState().ensureGuest()).account?.username).toBe('alice');
    expect(publicSession.tab).toHaveBeenCalledWith(); expect(publicSession.authenticate).not.toHaveBeenCalled();
  });
  it('preserves a verified linked seat on reload and refuses to replace credentials when the API is offline', async () => {
    const current = session('account-session', true); useAuthStore.getState().setSession(current); setStoredRoomId('room');
    const { token: _token, ...info } = current; vi.mocked(fetch).mockResolvedValue(response({ ...info, playerId: 'default-tab-id' }));
    expect((await useAuthStore.getState().ensureGuest()).playerId).toBe('server-seat');
    expect(publicSession.tab).not.toHaveBeenCalled(); expect(getStoredRoomId()).toBe('room');
    vi.mocked(fetch).mockRejectedValue(new Error('offline')); await expect(useAuthStore.getState().ensureGuest()).rejects.toThrow('offline'); expect(getStoredAuth()?.token).toBe(current.token);
  });
  it('drops an expired cached room before creating a new account tab', async () => {
    useAuthStore.getState().setSession({ ...session('account-session', true), expiresAt: 1 }); setStoredRoomId('stale-room');
    vi.mocked(publicSession.me).mockResolvedValue({ protocolVersion: 1, session: session('browser', true), csrf: 'c'.repeat(43) });
    await useAuthStore.getState().ensureGuest(); expect(getStoredRoomId()).toBeNull(); expect(publicSession.tab).toHaveBeenCalledWith();
  });
  it('makes local tab logout distinct from browser/global public logout', async () => {
    useAuthStore.getState().setSession(session('account-session', true)); vi.mocked(fetch).mockResolvedValue(response({ protocolVersion: 1, ok: true }));
    await useAuthStore.getState().logout('tab'); expect(publicSession.logout).not.toHaveBeenCalled();
    useAuthStore.getState().setSession(session('account-session', true));
    await useAuthStore.getState().logout('all'); expect(fetch).toHaveBeenLastCalledWith('/api/auth/logout-all', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer ' + session('account-session', true).token }) })); expect(useAuthStore.getState().browserSession).toBeNull();
  });
  it('does not restore a delayed tab credential after local logout', async () => {
    let finish!: (value: AuthResponse) => void;
    vi.mocked(publicSession.me).mockResolvedValue({ protocolVersion: 1, session: session('browser', true), csrf: 'c'.repeat(43) });
    vi.mocked(publicSession.tab).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = useAuthStore.getState().ensureGuest(); await vi.waitFor(() => expect(publicSession.tab).toHaveBeenCalled());
    await useAuthStore.getState().logout('tab'); finish(session('account-session', true));
    await expect(pending).rejects.toThrow('cancelled'); expect(useAuthStore.getState().session).toBeNull(); expect(getStoredAuth()).toBeNull();
  });
  it('retains only this tab in memory when browser storage is unavailable', async () => {
    vi.stubGlobal('sessionStorage', { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } });
    const current = session('account-session', true); useAuthStore.getState().setSession(current); setStoredRoomId('room');
    expect(getStoredAuth()).toEqual(current); expect(getStoredRoomId()).toBe('room');
    vi.mocked(fetch).mockResolvedValue(response({ protocolVersion: 1, ok: true })); await useAuthStore.getState().logout('tab'); clearStoredRoomId();
    expect(getStoredAuth()).toBeNull(); expect(getStoredRoomId()).toBeNull();
  });
  it('does not retry ambiguous global sign-out failures with another credential', async () => {
    useAuthStore.getState().setSession(session('account-session', true)); vi.mocked(fetch).mockResolvedValue(response({ protocolVersion: 1, message: 'Unavailable' }, 500));
    await expect(useAuthStore.getState().logout('all')).rejects.toThrow('could not be confirmed'); expect(publicSession.me).not.toHaveBeenCalled(); expect(publicSession.logout).not.toHaveBeenCalled(); expect(getStoredAuth()).toBeNull();
  });
});
