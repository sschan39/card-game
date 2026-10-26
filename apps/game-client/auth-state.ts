import { create } from 'zustand';
import { PROTOCOL_VERSION, AuthResponseSchema, AuthErrorSchema, type AuthResponse } from '@card-game/protocol';
import { getStoredAuth, getStoredRoomId, setStoredAuth } from './session';

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
  setSession(value: AuthResponse | null): void;
  authenticate(mode: 'register' | 'login', username: string, password: string): Promise<AuthResponse>;
  ensureGuest(): Promise<AuthResponse>;
  logout(): Promise<void>;
}
let pendingGuest: Promise<AuthResponse> | undefined;
export const useAuthStore = create<AuthState>((set, get) => ({
  session: getStoredAuth(), busy: false, error: null,
  setSession: value => { setStoredAuth(value); set({ session: value }); },
  authenticate: async (mode, username, password) => {
    if (get().busy) throw new Error('A sign-in request is already in progress.');
    set({ busy: true, error: null });
    try {
      const prior = get().session, roomId = getStoredRoomId();
      const session = await request(mode, { protocolVersion: PROTOCOL_VERSION, username, password, ...(roomId ? { roomId } : {}) }, prior && prior.expiresAt > Date.now() ? prior.token : undefined);
      get().setSession(session); return session;
    } catch (error) { set({ error: error instanceof Error ? error.message : 'Authentication request failed.' }); throw error; }
    finally { set({ busy: false }); }
  },
  ensureGuest: async () => {
    const existing = get().session;
    if (existing && existing.expiresAt > Date.now()) return existing;
    if (!pendingGuest) {
      pendingGuest = request('guest', { protocolVersion: PROTOCOL_VERSION }).then(session => {
        const current = get().session;
        if (current && current.expiresAt > Date.now()) return current;
        get().setSession(session); return session;
      }).finally(() => { pendingGuest = undefined; });
    }
    return pendingGuest;
  },
  logout: async () => {
    const session = get().session; set({ busy: true, error: null });
    try {
      if (session) {
        const response = await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token }, body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION }) });
        if (!response.ok && response.status !== 401) throw new Error('Server sign-out failed. Your local session has been cleared.');
      }
    } catch (error) { set({ error: error instanceof Error ? error.message : 'Sign-out failed.' }); throw error; }
    finally { get().setSession(null); set({ busy: false }); }
  },
}));
