import { create } from 'zustand';
import { PROTOCOL_VERSION, AuthResponseSchema, AuthErrorSchema, SessionInfoSchema, type AuthResponse, type SessionInfo } from '@card-game/protocol';
import { getStoredAuth, getStoredRoomId, setStoredAuth, clearStoredRoomId } from './session';
import { publicSession } from '@card-game/browser-session';

async function request(path: string, body: unknown, token?: string): Promise<AuthResponse> {
  const response = await fetch('/api/auth/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const data: unknown = await response.json();
  if (!response.ok) { const error = AuthErrorSchema.safeParse(data); throw new Error(error.success ? error.data.message : 'Authentication request failed.'); }
  const parsed = AuthResponseSchema.safeParse(data);
  if (!parsed.success) throw new Error('The server returned an incompatible sign-in response. Reload and try again.');
  return parsed.data;
}
interface AuthState {
  session: AuthResponse | null; busy: boolean; error: string | null;
  browserSession: SessionInfo | null;
  setSession(value: AuthResponse | null): void;
  authenticate(mode: 'register' | 'login', username: string, password: string): Promise<AuthResponse>;
  ensureGuest(preferBrowser?: boolean): Promise<AuthResponse>;
  logout(mode?: 'tab' | 'browser' | 'all'): Promise<void>;
}
let pendingGuest: Promise<AuthResponse> | undefined;
let generation = 0;
export const useAuthStore = create<AuthState>((set, get) => ({
  session: getStoredAuth(), browserSession: null, busy: false, error: null,
  setSession: value => { setStoredAuth(value); set({ session: value }); },
  authenticate: async (mode, username, password) => {
    if (get().busy) throw new Error('A sign-in request is already in progress.');
    set({ busy: true, error: null });
    generation++;
    try {
      const existing = get().session, prior = existing && existing.expiresAt > Date.now() ? existing : null;
      const roomId = prior ? getStoredRoomId() : null;
      if (!prior) clearStoredRoomId();
      const identity = await publicSession.authenticate(mode, username, password); set({ browserSession: identity.session });
      const session = await publicSession.tab(prior, roomId);
      get().setSession(session); return session;
    } catch (error) { set({ error: error instanceof Error ? error.message : 'Authentication request failed.' }); throw error; }
    finally { set({ busy: false }); }
  },
  ensureGuest: async (preferBrowser = false) => {
    const existing = get().session;
    if (!pendingGuest) {
      const currentGeneration = generation;
      pendingGuest = (async () => {
        if (preferBrowser) {
          const identity = await publicSession.me();
          if (currentGeneration !== generation) throw new Error('Session setup cancelled.');
          set({ browserSession: identity.session });
          if (!existing || existing.expiresAt <= Date.now()) clearStoredRoomId();
          if (identity.session) return publicSession.tab(existing && existing.expiresAt > Date.now() ? existing : null, existing && existing.expiresAt > Date.now() ? getStoredRoomId() : undefined);
        }
        if (existing && existing.expiresAt > Date.now()) {
          const response = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + existing.token } });
          if (response.ok) {
            const info = SessionInfoSchema.safeParse(await response.json());
            if (!info.success || info.data.sessionId !== existing.sessionId || info.data.scope !== 'game') throw new Error('Incompatible game session. Sign in again.');
            return { ...existing, ...info.data, ...(getStoredRoomId() ? { playerId: existing.playerId } : {}) };
          }
          if (response.status !== 401 && response.status !== 403) throw new Error('Unable to verify the game session. Retry.');
        }
        const current = get().session;
        if (current && current.sessionId !== existing?.sessionId && current.expiresAt > Date.now()) return current;
        if (currentGeneration !== generation) throw new Error('Session setup cancelled.');
        clearStoredRoomId();
        const identity = await publicSession.me();
        if (currentGeneration !== generation) throw new Error('Session setup cancelled.');
        set({ browserSession: identity.session });
        return identity.session ? publicSession.tab() : request('guest', { protocolVersion: PROTOCOL_VERSION });
      })().then(session => {
        const current = get().session;
        if (current && current.sessionId !== existing?.sessionId && current.expiresAt > Date.now()) return current;
        if (currentGeneration !== generation) throw new Error('Session setup cancelled.');
        get().setSession(session); return session;
      }).finally(() => { pendingGuest = undefined; });
    }
    return pendingGuest;
  },
  logout: async (mode = 'browser') => {
    generation++;
    const session = get().session; set({ busy: true, error: null });
    let browserAfter = mode === 'tab' ? get().browserSession : null;
    try {
      if (mode === 'all' && session?.account) {
        const response = await fetch('/api/auth/logout-all', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token }, body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION }) });
        if (!response.ok) {
          if (response.status !== 401 && response.status !== 403) throw new Error('Server sign-out could not be confirmed. Retry when the service is available.');
          const identity = await publicSession.me();
          if (identity.session?.account?.id !== session.account.id) throw new Error('Sign in to this account to end all of its public sessions.');
          await publicSession.logout(true);
        } else { publicSession.invalidate(); browserAfter = (await publicSession.me()).session; }
      } else {
        if (session) {
          const response = await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token }, body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION }) });
          if (!response.ok && response.status !== 401) throw new Error('Server sign-out failed. Your local session has been cleared.');
        }
        if (mode !== 'tab') {
          const identity = await publicSession.me();
          if (identity.session) await publicSession.logout(mode === 'all');
        }
      }
    } catch (error) { set({ error: error instanceof Error ? error.message : 'Sign-out failed.' }); throw error; }
    finally { get().setSession(null); set({ busy: false, ...(mode !== 'tab' ? { browserSession: browserAfter } : {}) }); }
  },
}));
