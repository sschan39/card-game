import type { PublicAccount, AdminAccount } from '@card-game/protocol';

export interface AccountRecord extends PublicAccount { passwordHash: string; disabled: boolean; createdAt: number }
export type Subject = { kind: 'guest'; id: string } | { kind: 'account'; id: string };
export type SessionScope = 'game' | 'admin';
export interface SessionRecord { id: string; digest: string; subject: Subject; scope: SessionScope; createdAt: number; expiresAt: number }
export interface SeatOwnership { roomId: string; playerId: string; owner: string }
export const subjectKey = (subject: Subject): string => `${subject.kind}:${subject.id}`;

/** Replace this repository with SQLite in Phase 3 without changing auth policy. */
export interface AccountRepository {
  transaction<T>(operation: () => T): T;
  findAccount(id: string): AccountRecord | undefined;
  findByUsername(username: string): AccountRecord | undefined;
  insertAccount(account: AccountRecord): boolean;
  saveAccount(account: AccountRecord): void;
  accountCount(): number;
  listAccounts(offset: number, limit: number): { accounts: AdminAccount[]; total: number };
  activeAdminCount(): number;
  sessions(): SessionRecord[];
  findSession(digest: string): SessionRecord | undefined;
  saveSession(session: SessionRecord): void;
  deleteSession(digest: string): void;
  ownedSeat(roomId: string, owner: string): SeatOwnership | undefined;
  seatOwner(roomId: string, playerId: string): string | undefined;
  saveSeat(seat: SeatOwnership): void;
  deleteRoomSeats(roomId: string): void;
}

export class InMemoryAccountStore implements AccountRepository {
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly usernames = new Map<string, string>();
  private readonly sessionTable = new Map<string, SessionRecord>();
  private readonly seats = new Map<string, Map<string, SeatOwnership>>();

  transaction<T>(operation: () => T): T {
    const snapshot = structuredClone([this.accounts, this.usernames, this.sessionTable, this.seats] as const);
    try { return operation(); } catch (error) {
      const restore = <K, V>(target: Map<K, V>, source: Map<K, V>) => { target.clear(); for (const [key, value] of source) target.set(key, value); };
      restore(this.accounts, snapshot[0]); restore(this.usernames, snapshot[1]); restore(this.sessionTable, snapshot[2]); restore(this.seats, snapshot[3]);
      throw error;
    }
  }

  findAccount(id: string) { const account = this.accounts.get(id); return account && { ...account }; }
  findByUsername(username: string) { const id = this.usernames.get(username); return id ? this.findAccount(id) : undefined; }
  insertAccount(account: AccountRecord): boolean {
    if (this.usernames.has(account.username) || this.accounts.has(account.id)) return false;
    this.accounts.set(account.id, { ...account }); this.usernames.set(account.username, account.id); return true;
  }
  saveAccount(account: AccountRecord): void {
    const existing = this.accounts.get(account.id);
    if (!existing || existing.username !== account.username) throw new Error('Account identity cannot change');
    this.accounts.set(account.id, { ...account });
  }
  accountCount() { return this.accounts.size; }
  listAccounts(offset: number, limit: number) {
    const rows = [...this.accounts.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    return { total: rows.length, accounts: rows.slice(offset, offset + limit).map(({ passwordHash: _hash, ...account }) => ({ ...account })) };
  }
  activeAdminCount() { return [...this.accounts.values()].filter(account => account.role === 'admin' && !account.disabled).length; }
  sessions() { return [...this.sessionTable.values()].map(session => structuredClone(session)); }
  findSession(digest: string) { const session = this.sessionTable.get(digest); return session && structuredClone(session); }
  saveSession(session: SessionRecord) { this.sessionTable.set(session.digest, structuredClone(session)); }
  deleteSession(digest: string) { this.sessionTable.delete(digest); }
  ownedSeat(roomId: string, owner: string) { const seat = [...this.seats.get(roomId)?.values() ?? []].find(seat => seat.owner === owner); return seat && { ...seat }; }
  seatOwner(roomId: string, playerId: string) { return this.seats.get(roomId)?.get(playerId)?.owner; }
  saveSeat(seat: SeatOwnership) {
    let seats = this.seats.get(seat.roomId); if (!seats) { seats = new Map(); this.seats.set(seat.roomId, seats); }
    seats.set(seat.playerId, { ...seat });
  }
  deleteRoomSeats(roomId: string) { this.seats.delete(roomId); }
}
