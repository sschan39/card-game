import { z } from 'zod';
import { AuthResponseSchema, DeckIdSchema, type AuthResponse, type DeckInput, type SavedDeck } from '@card-game/protocol';
import { builderConfig } from './config';
import { DraftSchema, newDraft } from './model';

export interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
const DraftTargetSchema = z.object({ accountId: z.string().min(1).max(128), deckId: DeckIdSchema }).strict();
const RecoverySchema = z.object({ version: z.literal(2), draft: DraftSchema, target: DraftTargetSchema.nullable() }).strict();
export type DraftTarget = z.infer<typeof DraftTargetSchema>;
export interface DraftRecovery { draft: DeckInput; target: DraftTarget | null }

/** A stored ID is only a hint. Restore it from a freshly verified owned-deck list. */
export function recoverSavedDeck(target: DraftTarget | null, accountId: string | undefined, decks: readonly SavedDeck[]): SavedDeck | null {
  return target?.accountId === accountId ? decks.find(deck => deck.id === target?.deckId) ?? null : null;
}
export function readSession(storage?: StoragePort, now = Date.now()): AuthResponse | null {
  try {
    const raw = storage?.getItem(builderConfig.sessionKey);
    if (!raw || raw.length > 4096) return null;
    const result = AuthResponseSchema.safeParse(JSON.parse(raw));
    return result.success && result.data.scope === 'game' && result.data.account && result.data.expiresAt > now ? result.data : null;
  } catch { return null; }
}
export function readDraftRecovery(storage?: StoragePort): DraftRecovery {
  const empty = () => ({ draft: newDraft(), target: null });
  try {
    const raw = storage?.getItem(builderConfig.draftKey);
    if (!raw || raw.length > 65536) return empty();
    const value: unknown = JSON.parse(raw), recovery = RecoverySchema.safeParse(value);
    if (recovery.success) return recovery.data;
    const legacy = DraftSchema.safeParse(value);
    return legacy.success ? { draft: legacy.data, target: null } : empty();
  } catch { return empty(); }
}
export function readDraft(storage?: StoragePort): DeckInput {
  return readDraftRecovery(storage).draft;
}
export function writeSession(storage: StoragePort | undefined, value: AuthResponse | null): void {
  try { if (value) storage?.setItem(builderConfig.sessionKey, JSON.stringify(value)); else storage?.removeItem(builderConfig.sessionKey); } catch { /* In-memory login still works when storage is unavailable. */ }
}
export function writeDraft(storage: StoragePort | undefined, deck: DeckInput, target: DraftTarget | null = null): boolean {
  try { if (!storage) return false; storage.setItem(builderConfig.draftKey, JSON.stringify(RecoverySchema.parse({ version: 2, draft: deck, target }))); return true; } catch { return false; }
}
export function tabStorage(): StoragePort | undefined {
  try { return typeof sessionStorage === 'undefined' ? undefined : sessionStorage; } catch { return undefined; }
}
