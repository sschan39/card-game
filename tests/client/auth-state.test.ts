import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, type AuthResponse } from '@card-game/protocol';
import { useAuthStore } from '@client/auth-state';
import { getStoredAuth, setStoredRoomId } from '@client/session';

const password = 'client-only-fixture-password';
const session = (id = 'session-1', account = false): AuthResponse => ({ protocolVersion: PROTOCOL_VERSION, scope: 'game',
  sessionId: id, token: (id === 'session-1' ? 'A' : 'B').repeat(43), expiresAt: Date.now() + 60_000, playerId: 'server-seat',
  account: account ? { id: 'account', username: 'alice', role: 'player' } : null });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  vi.stubGlobal('fetch', vi.fn());
  useAuthStore.setState({ session: null, busy: false, error: null });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('game account client', () => {
  it('deduplicates guest issuance and stores only the returned server identity', async () => {
    vi.mocked(fetch).mockResolvedValue(response(session()));
    const values = await Promise.all([useAuthStore.getState().ensureGuest(), useAuthStore.getState().ensureGuest()]);
    expect(fetch).toHaveBeenCalledTimes(1); expect(values[0].playerId).toBe('server-seat'); expect(getStoredAuth()).toEqual(values[0]);
  });
  it('carries guest ownership to registration through a bearer header, without persisting the password', async () => {
    useAuthStore.getState().setSession(session()); setStoredRoomId('room');
    vi.mocked(fetch).mockResolvedValue(response({ ...session('account-session', true), roomId: 'room' }));
    await useAuthStore.getState().authenticate('register', 'alice', password);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('/api/auth/register'); expect(options?.headers).toMatchObject({ Authorization: 'Bearer ' + session().token });
    expect(JSON.parse(options!.body as string)).toMatchObject({ username: 'alice', password, roomId: 'room', protocolVersion: PROTOCOL_VERSION });
    expect(getStoredAuth()?.account?.username).toBe('alice'); expect(JSON.stringify(useAuthStore.getState())).not.toContain(password);
  });
  it('does not let a delayed guest response overwrite a completed account login', async () => {
    let finishGuest!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finishGuest = resolve; }));
    const guest = useAuthStore.getState().ensureGuest();
    const account = session('account-session', true); useAuthStore.getState().setSession(account);
    finishGuest(response(session()));
    expect(await guest).toEqual(account); expect(getStoredAuth()).toEqual(account);
  });
  it('keeps safe login errors visible and clears local credentials on logout failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ protocolVersion: PROTOCOL_VERSION, message: 'Invalid username or password.' }, 401));
    await expect(useAuthStore.getState().authenticate('login', 'alice', password)).rejects.toThrow('Invalid username');
    expect(useAuthStore.getState().error).not.toContain(password);
    useAuthStore.getState().setSession(session('account-session', true)); vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    await expect(useAuthStore.getState().logout()).rejects.toThrow('offline');
    expect(getStoredAuth()).toBeNull(); expect(useAuthStore.getState().session).toBeNull();
  });
  it('suppresses protocol validation details and refuses overlapping login requests', async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = useAuthStore.getState().authenticate('login', 'alice', password);
    await expect(useAuthStore.getState().authenticate('login', 'alice', password)).rejects.toThrow('already in progress');
    finish(response({ passwordHash: 'should-not-display' }));
    await expect(pending).rejects.toThrow('incompatible sign-in response');
    expect(useAuthStore.getState().error).not.toContain('passwordHash');
  });
});
