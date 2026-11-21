import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { AdminAccountSchema, AuditRecordSchema, DeckRecordSchema, type DeckInput, type SavedDeck, type AuditRecord } from '@card-game/protocol';
import type { AuditRepository } from '../admin/audit';
import { storageDefaults, ConfigurationError, type ServerConfig } from '../config';
import type { AccountRecord, AccountRepository, SeatOwnership, SessionRecord } from '../auth/account-store';
import type { DeckRepository } from '../decks/deck-store';
import { migrate } from './migrations';
import type { MatchRepository, StoredMatch, StoredMatchCommand } from '../rooms/match-recovery';

type AccountRow = Omit<AccountRecord, 'disabled'> & { disabled: number };
type SessionRow = Omit<SessionRecord, 'subject'> & { subjectKind: SessionRecord['subject']['kind']; subjectId: string };
const accountColumns = 'id,username,role,password_hash AS passwordHash,disabled,created_at AS createdAt';
const sessionColumns = 'id,digest,subject_kind AS subjectKind,subject_id AS subjectId,scope,created_at AS createdAt,expires_at AS expiresAt,kind,parent_digest AS parentDigest';

/** Open a snapshot read-only and export only legacy identity records to a new private file. */
export function exportIdentityMigration(filename: string, destination: string): number {
  const database = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    const rows = database.prepare(`SELECT ${accountColumns} FROM accounts WHERE password_hash <> '' ORDER BY id`).all() as AccountRow[];
    const accounts = rows.map(row => {
      const { passwordHash, disabled, ...details } = row;
      const account = AdminAccountSchema.safeParse({ ...details, disabled: disabled === 1 });
      if (!account.success || account.data.username !== details.username ||
          !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(details.id) || !passwordHash.startsWith('$argon2id$'))
        throw new ConfigurationError('Account export contains an unsupported identity record.');
      return { id: details.id, username: account.data.username, role: account.data.role === 'admin' ? 'admin' : 'user',
        disabled: account.data.disabled, created_at: new Date(details.createdAt).toISOString(), password_hash: passwordHash };
    });
    writeFileSync(destination, JSON.stringify({ format: 'foura.identity-import', version: 1, accounts }) + '\n',
      { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return accounts.length;
  } finally { database.close(); }
}

/** The only application module importing the native driver. No SQL leaves this boundary. */
import { ScenarioRecordSchema, type ScenarioRecord } from '@card-game/protocol';
import type { ScenarioRepository } from '../scenarios/repository';

export class SqliteStore implements AccountRepository, DeckRepository, AuditRepository, ScenarioRepository, MatchRepository {
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
      const seats = this.statement('SELECT room_id AS roomId,player_id AS playerId,owner,account_id AS accountId FROM match_seats')
        .all() as (Omit<SeatOwnership, 'accountId'> & { accountId: string | null })[];
      for (const { accountId, ...seat } of seats) this.cacheSeat({ ...seat, ...(accountId ? { accountId } : {}) });
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
  accountSeats(accountId: string): SeatOwnership[] {
    return [...this.seats.values()].flatMap(seats => [...seats.values()])
      .filter(seat => seat.accountId === accountId || seat.owner === 'account:' + accountId).map(seat => ({ ...seat }));
  }
  ownedSeat(roomId: string, owner: string) { const seat = [...this.seats.get(roomId)?.values() ?? []].find(value => value.owner === owner); return seat && { ...seat }; }
  seatOwner(roomId: string, playerId: string) { return this.seats.get(roomId)?.get(playerId)?.owner; }
  saveSeat(seat: SeatOwnership) {
    this.statement(`INSERT INTO match_seats(room_id,player_id,owner,account_id)
      SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM active_matches WHERE room_id=?)
      ON CONFLICT(room_id,player_id) DO UPDATE SET owner=excluded.owner,account_id=excluded.account_id`)
      .run(seat.roomId, seat.playerId, seat.owner, seat.accountId ?? null, seat.roomId);
    this.cacheSeat(seat);
  }
  private cacheSeat(seat: SeatOwnership) {
    let seats = this.seats.get(seat.roomId);
    if (!seats) { seats = new Map(); this.seats.set(seat.roomId, seats); }
    seats.set(seat.playerId, { ...seat });
  }
  deleteSeat(roomId: string, playerId: string) {
    this.statement('DELETE FROM match_seats WHERE room_id=? AND player_id=?').run(roomId, playerId);
    this.seats.get(roomId)?.delete(playerId);
  }
  deleteRoomSeats(roomId: string) {
    this.statement('DELETE FROM match_seats WHERE room_id=?').run(roomId);
    this.seats.delete(roomId);
  }

  matches(): StoredMatch[] {
    return this.statement(`SELECT room_id AS roomId, format_version AS version, checkpoint, checkpoint_hash AS checkpointHash,
      checkpoint_ordinal AS checkpointOrdinal, checkpoint_seq AS checkpointSeq, ordinal,
      view_seq AS viewSeq, state_hash AS stateHash FROM active_matches`).all() as StoredMatch[];
  }
  matchCommands(roomId: string, afterOrdinal: number): StoredMatchCommand[] {
    return this.statement(`SELECT ordinal,player_id AS playerId,command_id AS commandId,action_id AS actionId,entry
      FROM match_commands WHERE room_id=? AND ordinal>? ORDER BY ordinal`).all(roomId, afterOrdinal) as StoredMatchCommand[];
  }
  acceptedAction(roomId: string, playerId: string, commandId: string): string | undefined {
    const row = this.statement('SELECT action_id AS actionId FROM match_commands WHERE room_id=? AND player_id=? AND command_id=?')
      .get(roomId, playerId, commandId) as { actionId: string } | undefined;
    return row?.actionId;
  }
  createMatch(match: StoredMatch): void {
    this.database.transaction(() => {
      const seats = this.seats.get(match.roomId);
      if (seats?.size !== 2) throw new Error('Active match requires two seat owners');
      this.statement(`INSERT INTO active_matches(room_id,format_version,checkpoint,checkpoint_hash,
        checkpoint_ordinal,checkpoint_seq,ordinal,view_seq,state_hash)
        VALUES (@roomId,@version,@checkpoint,@checkpointHash,@checkpointOrdinal,@checkpointSeq,@ordinal,@viewSeq,@stateHash)`).run(match);
      for (const seat of seats.values()) {
        this.statement('INSERT INTO match_seats(room_id,player_id,owner,account_id) VALUES (?,?,?,?)')
          .run(seat.roomId, seat.playerId, seat.owner, seat.accountId ?? null);
      }
    }).immediate();
  }
  appendMatchCommand(roomId: string, command: StoredMatchCommand, head: StoredMatch): void {
    this.database.transaction(() => {
      const updated = this.statement(`UPDATE active_matches SET ordinal=@ordinal,view_seq=@viewSeq,state_hash=@stateHash,
        checkpoint=@checkpoint,checkpoint_hash=@checkpointHash,checkpoint_ordinal=@checkpointOrdinal,checkpoint_seq=@checkpointSeq
        WHERE room_id=@roomId AND ordinal=@ordinal-1`).run(head);
      if (updated.changes !== 1) throw new Error('Active match position moved');
      this.statement(`INSERT INTO match_commands(room_id,ordinal,player_id,command_id,action_id,entry)
        VALUES (@roomId,@ordinal,@playerId,@commandId,@actionId,@entry)`).run({ roomId, ...command });
    }).immediate();
  }
  deleteMatch(roomId: string): void {
    this.statement('DELETE FROM active_matches WHERE room_id=?').run(roomId);
  }

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
  auditTransaction<T>(operation:()=>T):T{return this.transaction(operation);}
  scenarioTransaction<T>(operation:()=>T):T{return this.transaction(operation);}
  listScenarios(offset:number,limit:number) {
    const rows=this.statement('SELECT content FROM scenarios ORDER BY updated_at DESC,id LIMIT ? OFFSET ?').all(limit,offset) as {content:string}[];
    return {records:rows.map(row=>ScenarioRecordSchema.parse(JSON.parse(row.content))),total:(this.statement('SELECT count(*) AS total FROM scenarios').get() as {total:number}).total};
  }
  findScenario(id:string){const row=this.statement('SELECT content FROM scenarios WHERE id=?').get(id) as {content:string}|undefined;return row?ScenarioRecordSchema.parse(JSON.parse(row.content)):undefined;}
  saveScenario(record:ScenarioRecord,expectedRevision:number){
    const content=JSON.stringify(ScenarioRecordSchema.parse(record));
    if(expectedRevision===0)return this.statement('INSERT INTO scenarios(id,revision,content,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING').run(record.id,record.revision,content,record.createdAt,record.updatedAt).changes===1;
    return this.statement('UPDATE scenarios SET revision=?,content=?,updated_at=? WHERE id=? AND revision=?').run(record.revision,content,record.updatedAt,record.id,expectedRevision).changes===1;
  }
  deleteScenario(id:string,expectedRevision:number){return this.statement('DELETE FROM scenarios WHERE id=? AND revision=?').run(id,expectedRevision).changes===1;}
  async backup(destination: string): Promise<void> { await this.database.backup(destination); }
  close(): void { if (this.database.open) this.database.close(); }
}
