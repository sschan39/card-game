import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AdminAccountSchema, AuditRecordSchema, DeckRecordSchema, type DeckInput, type SavedDeck, type AuditRecord } from '@card-game/protocol';
import type { AuditRepository } from '../admin/audit';
import { storageDefaults, ConfigurationError, type ServerConfig } from '../config';
import type { AccountRecord, AccountRepository, SeatOwnership, SessionRecord } from '../auth/account-store';
import type { DeckRepository } from '../decks/deck-store';
import { migrate } from './migrations';

type AccountRow = Omit<AccountRecord, 'disabled'> & { disabled: number };
type SessionRow = Omit<SessionRecord, 'subject'> & { subjectKind: SessionRecord['subject']['kind']; subjectId: string };
const accountColumns = 'id,username,role,password_hash AS passwordHash,disabled,created_at AS createdAt';
const sessionColumns = 'id,digest,subject_kind AS subjectKind,subject_id AS subjectId,scope,created_at AS createdAt,expires_at AS expiresAt,kind,parent_digest AS parentDigest';

/** The only application module importing the native driver. No SQL leaves this boundary. */
export class SqliteStore implements AccountRepository, DeckRepository, AuditRepository {
  private readonly database: Database.Database;
  private readonly statements = new Map<string, Database.Statement>();
  private readonly seats = new Map<string, Map<string, SeatOwnership>>();

  constructor(filename: string, private readonly settings = storageDefaults, identity?: Pick<ServerConfig['navigation'], 'instanceId' | 'purpose'>) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    this.database = new Database(filename, { timeout: settings.lockTimeoutMs });
    try {
      this.database.pragma('foreign_keys = ON');
      this.database.pragma('journal_mode = WAL');
      this.database.pragma('synchronous = FULL');
      migrate(this.database);
      if (identity) this.database.transaction(() => {
        const existing = this.database.prepare('SELECT instance_id AS instanceId,purpose FROM instance_identity WHERE singleton=1').get() as { instanceId: string; purpose: string } | undefined;
        if (existing && (existing.instanceId !== identity.instanceId || existing.purpose !== identity.purpose)) throw new ConfigurationError('Invalid configuration: database instance identity. Use the matching instance or a separate database.');
        if (!existing) this.database.prepare('INSERT INTO instance_identity(singleton,instance_id,purpose) VALUES (1,?,?)').run(identity.instanceId, identity.purpose);
      }).immediate();
    } catch (error) { this.database.close(); throw error; }
  }
  private statement(sql: string): Database.Statement {
    let statement = this.statements.get(sql);
    if (!statement) { statement = this.database.prepare(sql); this.statements.set(sql, statement); }
    return statement;
  }
  transaction<T>(operation: () => T): T {
    const previousSeats = structuredClone(this.seats);
    try { return this.database.transaction(operation).immediate(); }
    catch (error) { this.seats.clear(); for (const [roomId, seats] of previousSeats) this.seats.set(roomId, seats); throw error; }
  }
  private account(row: unknown): AccountRecord | undefined {
    if (!row) return;
    const value = row as AccountRow; return { ...value, disabled: value.disabled === 1 };
  }
  findAccount(id: string) { return this.account(this.statement(`SELECT ${accountColumns} FROM accounts WHERE id=?`).get(id)); }
  findByUsername(username: string) { return this.account(this.statement(`SELECT ${accountColumns} FROM accounts WHERE username=?`).get(username)); }
  insertAccount(account: AccountRecord): boolean {
    return this.statement('INSERT INTO accounts(id,username,role,password_hash,disabled,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING')
      .run(account.id, account.username, account.role, account.passwordHash, Number(account.disabled), account.createdAt).changes === 1;
  }
  saveAccount(account: AccountRecord): void {
    const result = this.statement('UPDATE accounts SET role=?,password_hash=?,disabled=? WHERE id=? AND username=?')
      .run(account.role, account.passwordHash, Number(account.disabled), account.id, account.username);
    if (result.changes !== 1) throw new Error('Account identity cannot change');
  }
  accountCount() { return (this.statement('SELECT count(*) AS total FROM accounts').get() as { total: number }).total; }
  listAccounts(offset: number, limit: number) {
    const rows = this.statement(`SELECT ${accountColumns} FROM accounts ORDER BY created_at,id LIMIT ? OFFSET ?`).all(limit, offset);
    return { total: this.accountCount(), accounts: rows.map(row => {
      const { passwordHash: _hash, ...account } = this.account(row)!; return AdminAccountSchema.parse(account);
    }) };
  }
  activeAdminCount() { return (this.statement("SELECT count(*) AS total FROM accounts WHERE role='admin' AND disabled=0").get() as { total: number }).total; }
  appendAudit(record: AuditRecord): void {
    this.statement('INSERT INTO admin_audit(id,occurred_at,actor_id,action,target,outcome) VALUES (?,?,?,?,?,?)').run(record.id, record.timestamp, record.actorId, record.action, record.target, record.outcome);
  }
  pendingAudit(limit: number): AuditRecord[] {
    return this.statement('SELECT id,occurred_at AS timestamp,actor_id AS actorId,action,target,outcome FROM admin_audit WHERE exported=0 ORDER BY sequence LIMIT ?').all(limit).map(row => AuditRecordSchema.parse(row));
  }
  markAuditExported(id: string): void { this.statement('UPDATE admin_audit SET exported=1 WHERE id=?').run(id); }
  private session(row: unknown): SessionRecord | undefined {
    if (!row) return;
    const { subjectKind, subjectId, ...record } = row as SessionRow;
    const { kind, parentDigest, ...base } = record;
    return { ...base, ...(kind && kind !== 'legacy' ? { kind } : {}), ...(parentDigest ? { parentDigest } : {}), subject: { kind: subjectKind, id: subjectId } };
  }
  sessions() { return this.statement(`SELECT ${sessionColumns} FROM sessions`).all().map(row => this.session(row)!); }
  findSession(digest: string) { return this.session(this.statement(`SELECT ${sessionColumns} FROM sessions WHERE digest=?`).get(digest)); }
  saveSession(record: SessionRecord) {
    this.statement('INSERT INTO sessions(digest,id,subject_kind,subject_id,account_id,scope,created_at,expires_at,kind,parent_digest) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(record.digest, record.id, record.subject.kind, record.subject.id, record.subject.kind === 'account' ? record.subject.id : null, record.scope, record.createdAt, record.expiresAt, record.kind ?? 'legacy', record.parentDigest ?? null);
  }
  deleteSession(digest: string) { this.statement('DELETE FROM sessions WHERE digest=?').run(digest); }
  ownedSeat(roomId: string, owner: string) { const seat = [...this.seats.get(roomId)?.values() ?? []].find(value => value.owner === owner); return seat && { ...seat }; }
  seatOwner(roomId: string, playerId: string) { return this.seats.get(roomId)?.get(playerId)?.owner; }
  saveSeat(seat: SeatOwnership) {
    let seats = this.seats.get(seat.roomId);
    if (!seats) { seats = new Map(); this.seats.set(seat.roomId, seats); }
    seats.set(seat.playerId, { ...seat });
  }
  deleteRoomSeats(roomId: string) { this.seats.delete(roomId); }

  private deck(row: unknown): SavedDeck | undefined {
    if (!row) return;
    const record = row as { id: string };
    const cards = this.statement('SELECT card_id AS cardId,quantity FROM deck_cards WHERE deck_id=? ORDER BY position').all(record.id);
    return DeckRecordSchema.parse({ ...record, cards });
  }
  listDecks(ownerId: string, offset: number, limit: number) {
    const total = (this.statement('SELECT count(*) AS total FROM decks WHERE owner_id=?').get(ownerId) as { total: number }).total;
    const rows = this.statement('SELECT id,name,format,created_at AS createdAt,updated_at AS updatedAt FROM decks WHERE owner_id=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?').all(ownerId, limit, offset);
    return { total, decks: rows.map(row => this.deck(row)!) };
  }
  findDeck(ownerId: string, id: string) {
    return this.deck(this.statement('SELECT id,name,format,created_at AS createdAt,updated_at AS updatedAt FROM decks WHERE owner_id=? AND id=?').get(ownerId, id));
  }
  private writeCards(id: string, input: DeckInput): void {
    input.cards.forEach((entry, position) => this.statement('INSERT INTO deck_cards(deck_id,card_id,quantity,position) VALUES (?,?,?,?)').run(id, entry.cardId, entry.quantity, position));
  }
  createDeck(ownerId: string, deck: SavedDeck): boolean {
    return this.transaction(() => {
      if (this.listDecks(ownerId, 0, 1).total >= this.settings.maxDecksPerAccount) return false;
      const inserted = this.statement('INSERT INTO decks(id,owner_id,name,format,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING')
        .run(deck.id, ownerId, deck.name, deck.format, deck.createdAt, deck.updatedAt);
      if (!inserted.changes) return false;
      this.writeCards(deck.id, deck); return true;
    });
  }
  updateDeck(ownerId: string, id: string, input: DeckInput, updatedAt: number): SavedDeck | undefined {
    return this.transaction(() => {
      if (!this.statement('UPDATE decks SET name=?,format=?,updated_at=? WHERE owner_id=? AND id=?').run(input.name, input.format, updatedAt, ownerId, id).changes) return;
      this.statement('DELETE FROM deck_cards WHERE deck_id=?').run(id);
      this.writeCards(id, input); return this.findDeck(ownerId, id);
    });
  }
  deleteDeck(ownerId: string, id: string) { return this.statement('DELETE FROM decks WHERE owner_id=? AND id=?').run(ownerId, id).changes === 1; }
  async backup(destination: string): Promise<void> { await this.database.backup(destination); }
  close(): void { if (this.database.open) this.database.close(); }
}
