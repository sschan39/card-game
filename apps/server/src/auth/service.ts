import { randomUUID } from 'node:crypto';
import { PROTOCOL_VERSION, type AuthResponse, type PublicAccount, type SessionInfo } from '@card-game/protocol';
import { serverLogger } from '@card-game/engine/shared/game-logger';
import type { StateStore } from '../rooms/state-store';
import type { AuthConfig } from '../config';
import { type AccountRecord, type AccountRepository, type SessionRecord, type SessionScope, type Subject, subjectKey } from './account-store';
import { AuthError } from './errors';
import { hashPassword, verifyPassword } from './password';
import { SessionService } from './session';
import { redactCredentials } from './redaction';

export const publicAccount = ({ id, username, role }: AccountRecord): PublicAccount => ({ id, username, role });
export interface Credentials { username: string; password: string; roomId?: string; scope?: SessionScope }

export class AuthService {
  readonly sessions: SessionService;
  readonly ready: Promise<void>;
  private dummyHash = '';
  private passwordOperations = 0;

  constructor(readonly repository: AccountRepository, private readonly rooms: StateStore, private readonly config: AuthConfig, private readonly now = Date.now) {
    this.sessions = new SessionService(repository, config, now);
    this.ready = hashPassword('dummy-auth-' + randomUUID(), config.password).then(value => { this.dummyHash = value; });
  }
  private async passwordTask<T>(task: () => Promise<T>): Promise<T> {
    if (this.passwordOperations >= this.config.maxPasswordOperations) throw new AuthError(503, 'Authentication busy. Try again shortly.');
    this.passwordOperations++;
    try { await this.ready; return await task(); } finally { this.passwordOperations--; }
  }
  private audit(event: string, result: string, accountId?: string, scope: SessionScope = 'game') {
    serverLogger.info(event, 'Authentication request processed', redactCredentials({ result, scope, ...(accountId ? { accountId } : {}) }) as Record<string, unknown>);
  }
  guest(): AuthResponse {
    const issued = this.sessions.issue({ kind: 'guest', id: randomUUID() });
    return { ...this.info(issued.record), token: issued.token };
  }
  playerId(session: SessionRecord, roomId?: string | null): string {
    const owner = subjectKey(session.subject);
    return roomId ? this.repository.ownedSeat(roomId, owner)?.playerId ?? owner : owner;
  }
  info(session: SessionRecord, requestedRoomId?: string): SessionInfo {
    const account = session.subject.kind === 'account' ? this.repository.findAccount(session.subject.id) : undefined;
    const owned = requestedRoomId && this.rooms.getRoom(requestedRoomId) ? this.repository.ownedSeat(requestedRoomId, subjectKey(session.subject)) : undefined;
    return { protocolVersion: PROTOCOL_VERSION, sessionId: session.id, expiresAt: session.expiresAt, scope: session.scope,
      playerId: owned?.playerId ?? subjectKey(session.subject), account: account ? publicAccount(account) : null,
      ...(owned ? { roomId: owned.roomId } : {}) };
  }
  claimSeat(session: SessionRecord, roomId: string, playerId: string): void {
    if (session.scope !== 'game') throw new AuthError(403, 'A game session is required.');
    const owner = subjectKey(session.subject), existing = this.repository.seatOwner(roomId, playerId);
    if (existing && existing !== owner) throw new AuthError(403, 'Seat belongs to another account.');
    this.repository.saveSeat({ roomId, playerId, owner });
  }
  private linkSeat(account: AccountRecord, prior: SessionRecord | undefined, roomId?: string) {
    if (!prior || prior.subject.kind !== 'guest' || !roomId || !this.rooms.getRoom(roomId)) return undefined;
    const guestSeat = this.repository.ownedSeat(roomId, subjectKey(prior.subject));
    if (!guestSeat) throw new AuthError(403, 'Guest does not own this seat.');
    const existing = this.repository.ownedSeat(roomId, `account:${account.id}`);
    if (existing && existing.playerId !== guestSeat.playerId) throw new AuthError(409, 'Account already occupies another seat in this room.');
    return { ...guestSeat, owner: `account:${account.id}` };
  }
  private completeLogin(account: AccountRecord, priorToken: unknown, roomId?: string, scope: SessionScope = 'game'): AuthResponse {
    if (scope === 'admin' && account.role !== 'admin') throw new AuthError(403, 'Admin role required.');
    const prior = this.sessions.validate(priorToken), link = scope === 'game' ? this.linkSeat(account, prior, roomId) : undefined;
    const subject: Subject = { kind: 'account', id: account.id };
    const excluded = [subjectKey(subject), ...(link && prior ? [subjectKey(prior.subject)] : [])];
    if (!this.sessions.hasCapacity(excluded, scope)) throw new AuthError(503, 'Session capacity reached. Try again later.');
    // No awaits between ownership validation, transfer, rotation and token issue.
    if (link && prior) { this.repository.saveSeat(link); this.sessions.revokeSubject(prior.subject, 'linked'); }
    this.sessions.revokeSubject(subject, 'rotated', scope);
    const issued = this.sessions.issue(subject, scope);
    return { ...this.info(issued.record, roomId), token: issued.token };
  }
  async register(credentials: Credentials, priorToken?: unknown): Promise<AuthResponse> {
    const passwordHash = await this.passwordTask(() => hashPassword(credentials.password, this.config.password));
    if (this.repository.accountCount() >= this.config.maxAccounts) throw new AuthError(503, 'Account capacity reached.');
    const account: AccountRecord = { id: randomUUID(), username: credentials.username, role: 'player', passwordHash, disabled: false, createdAt: this.now() };
    // Validate linking and capacity before creating the account.
    const prior = this.sessions.validate(priorToken), link = this.linkSeat(account, prior, credentials.roomId);
    if (!this.sessions.hasCapacity(link && prior ? [subjectKey(prior.subject)] : [])) throw new AuthError(503, 'Session capacity reached. Try again later.');
    if (!this.repository.insertAccount(account)) throw new AuthError(409, 'Username is unavailable.');
    const response = this.completeLogin(account, priorToken, credentials.roomId);
    this.audit('auth:register', 'success', account.id); return response;
  }
  async login(credentials: Credentials, priorToken?: unknown): Promise<AuthResponse> {
    const account = this.repository.findByUsername(credentials.username);
    const valid = await this.passwordTask(() => verifyPassword(account && !account.disabled ? account.passwordHash : this.dummyHash, credentials.password));
    const current = account && this.repository.findAccount(account.id);
    if (!current || current.disabled || current.passwordHash !== account!.passwordHash || !valid) { this.audit('auth:login', 'failure', undefined, credentials.scope ?? 'game'); throw new AuthError(401, 'Invalid username or password.'); }
    const response = this.completeLogin(current, priorToken, credentials.roomId, credentials.scope ?? 'game');
    this.audit('auth:login', 'success', current.id, response.scope); return response;
  }
  logout(token: unknown): void {
    const session = this.sessions.validate(token); if (!session) throw new AuthError(401, 'Authentication required.');
    this.sessions.revoke(session, 'logout'); this.audit('auth:logout', 'success', session.subject.kind === 'account' ? session.subject.id : undefined);
  }
  async bootstrapAdmin(username: string, password: string): Promise<void> {
    const passwordHash = await this.passwordTask(() => hashPassword(password, this.config.password));
    if (this.repository.accountCount() >= this.config.maxAccounts) throw new AuthError(503, 'Account capacity reached.');
    if (!this.repository.insertAccount({ id: randomUUID(), username, passwordHash, role: 'admin', disabled: false, createdAt: this.now() }))
      throw new AuthError(409, 'Admin bootstrap identity already exists.');
    this.audit('auth:bootstrap', 'success', undefined, 'admin');
  }
}
