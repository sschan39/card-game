import { AuthResponseSchema, type AuthResponse, type DeckInput } from '@card-game/protocol';
import { builderConfig } from './config';
import { DraftSchema, newDraft } from './model';

export interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export function readSession(storage?: StoragePort, now = Date.now()): AuthResponse | null {
  try {
    const raw = storage?.getItem(builderConfig.sessionKey);
    if (!raw || raw.length > 4096) return null;
    const result = AuthResponseSchema.safeParse(JSON.parse(raw));
    return result.success && result.data.scope === 'game' && result.data.account && result.data.expiresAt > now ? result.data : null;
  } catch { return null; }
}
export function readDraft(storage?: StoragePort): DeckInput {
  try {
    const raw = storage?.getItem(builderConfig.draftKey);
    if (!raw || raw.length > 65536) return newDraft();
    const result = DraftSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : newDraft();
  } catch { return newDraft(); }
}
export function writeSession(storage: StoragePort | undefined, value: AuthResponse | null): void {
  try { if (value) storage?.setItem(builderConfig.sessionKey, JSON.stringify(value)); else storage?.removeItem(builderConfig.sessionKey); } catch { /* In-memory login still works when storage is unavailable. */ }
}
export function writeDraft(storage: StoragePort | undefined, deck: DeckInput): boolean {
  try { if (!storage) return false; storage.setItem(builderConfig.draftKey, JSON.stringify(DraftSchema.parse(deck))); return true; } catch { return false; }
}
export function tabStorage(): StoragePort | undefined {
  try { return typeof sessionStorage === 'undefined' ? undefined : sessionStorage; } catch { return undefined; }
}
