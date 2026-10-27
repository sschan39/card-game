import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SessionTokenSchema } from '@card-game/protocol';
import type { AccountRepository, SessionRecord, SessionScope, Subject } from './account-store';
import { subjectKey } from './account-store';
import type { AuthConfig } from '../config';
import { AuthError } from './errors';
import { serverLogger } from '@card-game/engine/shared/game-logger';

export type RevocationReason = 'logout' | 'rotated' | 'linked' | 'expired' | 'disabled';
export const tokenDigest = (token: string): string => createHash('sha256').update(token).digest('hex');

export class SessionService {
  private readonly listeners = new Set<(session: SessionRecord, reason: RevocationReason) => void>();
  private pending?: { session: SessionRecord; reason: RevocationReason }[];
  constructor(private readonly store: AccountRepository, private readonly config: AuthConfig, private readonly now = Date.now) {}
  onRevoke(listener: (session: SessionRecord, reason: RevocationReason) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify(session: SessionRecord, reason: RevocationReason): void {
    for (const listener of this.listeners) {
      try { listener(session, reason); }
      catch { serverLogger.warn('auth:notification:failed', 'A session invalidation notification failed'); }
    }
  }

  /** Notify sockets only after durable changes commit; rollback must retain valid credentials. */
  atomic<T>(operation: () => T): T {
    const parent = this.pending, events: NonNullable<SessionService['pending']> = [];
    this.pending = events;
    let result: T;
    try { result = this.store.transaction(operation); }
    catch (error) { this.pending = parent; throw error; }
    this.pending = parent;
    if (parent) parent.push(...events);
    else for (const { session, reason } of events) this.notify(session, reason);
    return result;
  }

  validate(token: unknown): SessionRecord | undefined {
    return SessionTokenSchema.safeParse(token).success ? this.validateDigest(tokenDigest(token as string)) : undefined;
  }
  validateDigest(digest: string): SessionRecord | undefined {
    const record = this.store.findSession(digest); if (!record) return;
    if (record.expiresAt <= this.now()) { this.revoke(record, 'expired'); return; }
    if (record.subject.kind === 'account') {
      const account = this.store.findAccount(record.subject.id);
      if (!account || account.disabled || record.scope === 'admin' && account.role !== 'admin') { this.revoke(record, 'disabled'); return; }
    }
    return record;
  }
  hasCapacity(excluding: readonly string[] = [], scope?: SessionScope): boolean {
    this.prune();
    return this.store.sessions().filter(record => !(excluding.includes(subjectKey(record.subject)) && (!scope || record.scope === scope))).length < this.config.maxSessions;
  }
  issue(subject: Subject, scope: SessionScope = 'game'): { token: string; record: SessionRecord } {
    if (scope === 'admin' && subject.kind !== 'account') throw new AuthError(403, 'An account is required for admin access.');
    if (subject.kind === 'account') {
      const account = this.store.findAccount(subject.id);
      if (!account || account.disabled) throw new AuthError(401, 'Account is unavailable.');
      if (scope === 'admin' && account.role !== 'admin') throw new AuthError(403, 'Admin role required.');
    }
    if (!this.hasCapacity()) throw new AuthError(503, 'Session capacity reached. Try again later.');
    const token = randomBytes(32).toString('base64url'), createdAt = this.now();
    const record: SessionRecord = { id: randomUUID(), digest: tokenDigest(token), subject, scope, createdAt,
      expiresAt: createdAt + (scope === 'admin' ? this.config.adminSessionTtlMs : subject.kind === 'guest' ? this.config.guestTtlMs : this.config.sessionTtlMs) };
    this.store.saveSession(record); return { token, record };
  }
  revoke(record: SessionRecord, reason: RevocationReason): void {
    if (!this.store.findSession(record.digest)) return;
    this.store.deleteSession(record.digest);
    if (this.pending) this.pending.push({ session: record, reason });
    else this.notify(record, reason);
  }
  revokeSubject(subject: Subject, reason: RevocationReason, scope?: SessionScope): void {
    for (const record of this.store.sessions()) if (subjectKey(record.subject) === subjectKey(subject) && (!scope || record.scope === scope)) this.revoke(record, reason);
  }
  prune(): void { for (const record of this.store.sessions()) if (record.expiresAt <= this.now()) this.revoke(record, 'expired'); }
}
