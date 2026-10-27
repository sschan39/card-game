import { AuthResponseSchema, type AuthResponse } from '@card-game/protocol';
import { adminUi } from './config';

export type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function validAdminSession(input: unknown, now = Date.now()): AuthResponse | null {
  const result = AuthResponseSchema.safeParse(input);
  return result.success && result.data.scope === 'admin' && result.data.account?.role === 'admin' && result.data.expiresAt > now ? result.data : null;
}
export function readAdminSession(storage: SessionStorage | undefined, now = Date.now()): AuthResponse | null {
  if (!storage) return null;
  try { const raw = storage.getItem(adminUi.storageKey); return raw ? validAdminSession(JSON.parse(raw), now) : null; } catch { return null; }
}
export function saveAdminSession(storage: SessionStorage | undefined, session: AuthResponse | null): void {
  if (!storage) return;
  if (session) storage.setItem(adminUi.storageKey, JSON.stringify(session)); else storage.removeItem(adminUi.storageKey);
}
export const browserStorage = (): SessionStorage | undefined => typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
