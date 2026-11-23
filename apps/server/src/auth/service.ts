import { randomUUID } from 'node:crypto';
import { PROTOCOL_VERSION, type AdminAccount, type AuthResponse, type PublicAccount, type SessionInfo } from '@card-game/protocol';
import { serverLogger } from '@card-game/engine/shared/game-logger';
import type { StateStore } from '../rooms/state-store';
import type { AuthConfig } from '../config';
import { type AccountRecord, type AccountRepository, type SessionRecord, type SessionScope, type Subject, subjectKey, sessionOwner } from './account-store';
import { AuthError, AuthorityLogoutUnconfirmed } from './errors';
import { assertPasswordPolicy, hashPassword, normalizePassword, verifyPassword } from './password';
import { SessionService, tokenDigest } from './session';
import { redactCredentials } from './redaction';
import type { AccountsAuthority, AuthorityAccount, AuthoritySessionView } from './accounts-authority';

export const publicAccount = ({ id, username, role }: AccountRecord): PublicAccount => ({ id, username, role });
const managedAccount = ({ role, ...account }: AuthorityAccount): AdminAccount => ({ ...account, role: role === 'user' ? 'player' : role });
export interface Credentials { username: string; password: string; roomId?: string; scope?: SessionScope }

const PLAY_ACCESS_TTL_MS = 30_000;
const PLAY_REFRESH_AGE_MS = 20_000;
const PLAY_ACTIVITY_INTERVAL_MS = 20_000;
interface AuthoritySession {
  token: string;
  view: AuthoritySessionView;
  checkedAt: number;
  verification?: Promise<AuthoritySessionView>;
  lastActivity?: number;
}

export class AuthService {
  readonly sessions: SessionService;
  readonly ready: Promise<void>;
  private dummyHash = '';
  private passwordOperations = 0;
  private readonly authoritySessions = new Map<string, AuthoritySession>();
  private readonly pendingAuthorityLogouts = new Map<string, number>();
  private retryingLogouts = false;

  constructor(readonly repository: AccountRepository, private readonly rooms: StateStore, private readonly config: AuthConfig, private readonly now = Date.now, readonly authority?: AccountsAuthority) {
    this.sessions = new SessionService(repository, config, now);
    this.ready = authority ? Promise.resolve() : hashPassword('dummy-auth-' + randomUUID(), config.password).then(value => { this.dummyHash = value; });
    this.sessions.onRevoke(session => { this.authoritySessions.delete(session.digest); });
    if (authority) {
      // The authority credentials are held in memory. After a restart these
      // account sessions cannot authenticate and must release their slots.
      this.sessions.atomic(() => {
        for (const session of repository.sessions()) {
          if (session.subject.kind === 'account' && !session.parentDigest) this.sessions.revoke(session, 'expired');
        }
      });
    }
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
    const owner = sessionOwner(session);
    return roomId ? this.repository.ownedSeat(roomId, owner)?.playerId ?? owner : owner;
  }
  info(session: SessionRecord, requestedRoomId?: string): SessionInfo {
    const account = session.subject.kind === 'account' ? this.repository.findAccount(session.subject.id) : undefined;
    const owned = requestedRoomId && this.rooms.getRoom(requestedRoomId) ? this.repository.ownedSeat(requestedRoomId, sessionOwner(session)) : undefined;
    return { protocolVersion: PROTOCOL_VERSION, sessionId: session.id, expiresAt: session.expiresAt, scope: session.scope,
      playerId: owned?.playerId ?? sessionOwner(session), account: account ? publicAccount(account) : null,
      ...(owned ? { roomId: owned.roomId } : {}) };
  }
  /** One account reserves one room across all browser families and game tabs, including reconnect grace. */
  assertRoomAvailable(session: SessionRecord, roomId?: string): void {
    if (session.subject.kind !== 'account') return;
    this.assertAccountRoomAvailable(session.subject.id, roomId);
  }
  private assertAccountRoomAvailable(accountId: string, roomId?: string): void {
    if (this.accountHasRoom(accountId, roomId)) throw new AuthError(409, 'This account already has a room. Leave it before joining another.');
  }
  accountHasRoom(accountId: string, exceptRoomId?: string): boolean {
    return this.repository.accountSeats(accountId).some(seat => seat.roomId !== exceptRoomId && !!this.rooms.getRoom(seat.roomId));
  }
  claimSeat(session: SessionRecord, roomId: string, playerId: string): void {
    if (session.scope !== 'game' || session.kind === 'browser') throw new AuthError(403, 'A game session is required.');
    this.assertRoomAvailable(session, roomId);
    const accountSeat = session.subject.kind === 'account'
      ? this.repository.accountSeats(session.subject.id).find(seat => seat.roomId === roomId) : undefined;
    if (accountSeat && accountSeat.owner !== sessionOwner(session)) throw new AuthError(409, 'Another game tab owns this account’s room.');
    const owner = sessionOwner(session), existing = this.repository.seatOwner(roomId, playerId);
    if (existing && existing !== owner) throw new AuthError(403, 'Seat belongs to another account.');
    this.repository.saveSeat({ roomId, playerId, owner, ...(session.subject.kind === 'account' ? { accountId: session.subject.id } : {}) });
  }
  private linkSeat(account: AccountRecord, prior: SessionRecord | undefined, roomId?: string) {
    if (!prior || prior.subject.kind !== 'guest' || !roomId || !this.rooms.getRoom(roomId)) return undefined;
    this.assertAccountRoomAvailable(account.id, roomId);
    const guestSeat = this.repository.ownedSeat(roomId, subjectKey(prior.subject));
    if (!guestSeat) throw new AuthError(403, 'Guest does not own this seat.');
    const existing = this.repository.accountSeats(account.id).find(seat => seat.roomId === roomId);
    if (existing && existing.playerId !== guestSeat.playerId) throw new AuthError(409, 'Account already occupies another seat in this room.');
    return { ...guestSeat, owner: `account:${account.id}`, accountId: account.id };
  }
  private completeLogin(account: AccountRecord, priorToken: unknown, roomId?: string, scope: SessionScope = 'game', browser = false, authorityExpiresAt?: number): AuthResponse {
    return this.sessions.atomic(() => {
      if (scope === 'admin' && account.role !== 'admin') throw new AuthError(403, 'Admin role required.');
      if (browser) {
        if (scope !== 'game') throw new AuthError(403, 'Public account session required.');
        const previous = this.sessions.validate(priorToken);
        if (previous?.kind === 'browser') this.sessions.revoke(previous, 'rotated');
        const issued = this.sessions.issue({ kind: 'account', id: account.id }, 'game', { kind: 'browser', authorityExpiresAt });
        return { ...this.info(issued.record), token: issued.token };
      }
      const prior = this.sessions.validate(priorToken), link = scope === 'game' ? this.linkSeat(account, prior, roomId) : undefined;
      const subject: Subject = { kind: 'account', id: account.id };
      const excluded = [subjectKey(subject), ...(link && prior ? [subjectKey(prior.subject)] : [])];
      if (!this.sessions.hasCapacity(excluded, scope)) throw new AuthError(503, 'Session capacity reached. Try again later.');
      // No awaits between ownership validation, transfer, rotation and token issue.
      if (link && prior) { this.repository.saveSeat(link); this.sessions.revokeSubject(prior.subject, 'linked'); }
      this.sessions.revokeSubject(subject, 'rotated', scope);
      const issued = this.sessions.issue(subject, scope, { authorityExpiresAt });
      return { ...this.info(issued.record, roomId), token: issued.token };
    });
  }
  async register(credentials: Credentials, priorToken?: unknown, browser = false): Promise<AuthResponse> {
    if (this.authority) {
      assertPasswordPolicy(credentials.password);
      if (this.repository.findByUsername(credentials.username)?.passwordHash)
        throw new AuthError(409, 'Username is unavailable. Sign in if you already have an account.');
      const registered = await this.authority.register(credentials.username, normalizePassword(credentials.password));
      return this.authorityLogin(credentials, priorToken, browser, registered.id);
    }
    const passwordHash = await this.passwordTask(() => hashPassword(credentials.password, this.config.password));
    const response = this.sessions.atomic(() => {
      if (this.repository.accountCount() >= this.config.maxAccounts) throw new AuthError(503, 'Account capacity reached.');
      const account: AccountRecord = { id: randomUUID(), username: credentials.username, role: 'player', passwordHash, disabled: false, createdAt: this.now() };
      // Validate linking and capacity before creating the account.
      const prior = this.sessions.validate(priorToken), link = this.linkSeat(account, prior, credentials.roomId);
      if (!this.sessions.hasCapacity(link && prior ? [subjectKey(prior.subject)] : [])) throw new AuthError(503, 'Session capacity reached. Try again later.');
      if (!this.repository.insertAccount(account)) throw new AuthError(409, 'Username is unavailable.');
      return this.completeLogin(account, priorToken, credentials.roomId, 'game', browser);
    });
    this.audit('auth:register', 'success', response.account!.id); return response;
  }
  async login(credentials: Credentials, priorToken?: unknown, browser = false): Promise<AuthResponse> {
    if (this.authority) return this.authorityLogin(credentials, priorToken, browser);
    const account = this.repository.findByUsername(credentials.username);
    const valid = await this.passwordTask(() => verifyPassword(account && !account.disabled ? account.passwordHash : this.dummyHash, credentials.password));
    const current = account && this.repository.findAccount(account.id);
    if (!current || current.disabled || current.passwordHash !== account!.passwordHash || !valid) { this.audit('auth:login', 'failure', undefined, credentials.scope ?? 'game'); throw new AuthError(401, 'Invalid username or password.'); }
    const response = this.completeLogin(current, priorToken, credentials.roomId, credentials.scope ?? 'game', browser);
    this.audit('auth:login', 'success', current.id, response.scope); return response;
  }
  private async authorityLogin(credentials: Credentials, priorToken: unknown, browser: boolean, expectedId?: string): Promise<AuthResponse> {
    const authority = this.authority!;
    const signedIn = await authority.signIn(credentials.username, normalizePassword(credentials.password));
    const scope = credentials.scope ?? 'game';
    try {
      this.assertAuthorityView(signedIn, expectedId ?? signedIn.account.id);
      this.assertRight(signedIn, scope === 'admin' ? 'accounts.manage' : 'play');
      if (signedIn.account.username !== credentials.username || scope === 'admin' && signedIn.account.role !== 'admin')
        throw new AuthError(403, 'Account does not have access to this workspace.');
      const result = this.sessions.atomic(() => {
        const existing = this.repository.findAccount(signedIn.account.id);
        const sameName = this.repository.findByUsername(signedIn.account.username);
        if (sameName && sameName.id !== signedIn.account.id || existing && existing.username !== signedIn.account.username)
          throw new AuthError(409, 'Account migration is required before signing in.');
        const projection: AccountRecord = {
          id: signedIn.account.id, username: signedIn.account.username,
          role: signedIn.account.role === 'admin' ? 'admin' : 'player',
          createdAt: existing?.createdAt ?? this.now(), disabled: signedIn.account.disabled,
          passwordHash: existing?.passwordHash ?? '',
        };
        if (existing) this.repository.saveAccount(projection);
        else if (!this.repository.insertAccount(projection)) throw new AuthError(409, 'Account identity is unavailable.');
        return this.completeLogin(projection, priorToken, credentials.roomId, scope, browser, signedIn.expires_at);
      });
      const { session: token, ...view } = signedIn;
      this.authoritySessions.set(tokenDigest(result.token), { token, view, checkedAt: this.now() });
      this.audit(expectedId ? 'auth:register' : 'auth:login', 'success', signedIn.account.id, scope);
      return result;
    } catch (error) {
      await authority.logout(signedIn.session).catch(() => {});
      throw error;
    }
  }
  private assertAuthorityView(view: AuthoritySessionView, id: string): void {
    if (view.account.id !== id || view.account.disabled || Math.min(view.expires_at, view.idle_expires_at) <= this.now())
      throw new AuthError(401, 'Sign in again.');
  }
  private assertRight(view: AuthoritySessionView, right: string): void {
    if (!view.rights.includes(right) || right === 'accounts.manage' && view.account.role !== 'admin')
      throw new AuthError(403, 'This account does not have the required access.');
  }
  private revokeAuthoritySession(root: string, current: AuthoritySession): void {
    if (this.authoritySessions.get(root) !== current) return;
    const parent = this.repository.findSession(root);
    if (parent) this.sessions.revoke(parent, 'expired');
  }
  private verifyAuthoritySession(root: string, current: AuthoritySession, accountId: string): Promise<AuthoritySessionView> {
    const startedAt = this.now();
    current.verification ??= this.authority!.verify(current.token).then(view => {
      this.assertAuthorityView(view, accountId);
      if (this.authoritySessions.get(root) !== current || !this.sessions.validateDigest(root))
        throw new AuthError(401, 'Sign in again.');
      current.view = view;
      current.checkedAt = startedAt;
      if (!view.rights.includes('play') && this.repository.findSession(root)?.scope === 'game')
        this.revokeAuthoritySession(root, current);
      return view;
    }).catch(error => {
      if (error instanceof AuthError && error.status === 401) this.revokeAuthoritySession(root, current);
      throw error;
    }).finally(() => { current.verification = undefined; });
    return current.verification;
  }
  /** Account operations, room entry, and test-room controls require a current 4A decision. */
  async authorize(session: SessionRecord, right = session.scope === 'admin' ? 'accounts.manage' : 'play'): Promise<AuthoritySessionView | undefined> {
    if (!this.authority || session.subject.kind === 'guest') return;
    const root = session.parentDigest ?? session.digest;
    const current = this.authoritySessions.get(root);
    if (!current || !this.sessions.validateDigest(session.digest)) throw new AuthError(401, 'Sign in again.');
    const view = await this.verifyAuthoritySession(root, current, session.subject.id);
    this.assertRight(view, right);
    if (!this.sessions.validateDigest(session.digest)) throw new AuthError(401, 'Sign in again.');
    return view;
  }
  private async asManagedAdmin<T>(session: SessionRecord, operation: (authority: AccountsAuthority, token: string) => Promise<T>): Promise<T> {
    if (!this.authority) throw new AuthError(404, 'This account operation is unavailable.');
    if (session.scope !== 'admin' || session.subject.kind !== 'account') throw new AuthError(403, 'An administrator session is required.');
    const current = this.authoritySessions.get(session.digest);
    if (!current || !this.sessions.validateDigest(session.digest)) throw new AuthError(401, 'Sign in again.');
    try {
      // 4A authorizes this particular operation against the actor's session.
      return await operation(this.authority, current.token);
    } catch (error) {
      if (error instanceof AuthError && error.status === 401) this.revokeAuthoritySession(session.digest, current);
      throw error;
    }
  }
  async listManagedAccounts(session: SessionRecord, offset: number, limit: number) {
    const result = await this.asManagedAdmin(session, (authority, token) => authority.listAccounts(token, offset, limit));
    return { accounts: result.accounts.map(managedAccount), nextOffset: result.nextOffset };
  }
  async createManagedAccount(session: SessionRecord, username: string, password: string, role: AdminAccount['role']) {
    assertPasswordPolicy(password);
    const account = await this.asManagedAdmin(session, (authority, token) => authority.createAccount(token, {
      username, password: normalizePassword(password), role: role === 'player' ? 'user' : role,
    }));
    return managedAccount(account);
  }
  async updateManagedAccount(session: SessionRecord, id: string, change: Partial<Pick<AdminAccount, 'role' | 'disabled'>>) {
    const roots = this.repository.sessions().filter(record =>
      !record.parentDigest && record.subject.kind === 'account' && record.subject.id === id);
    const account = await this.asManagedAdmin(session, (authority, token) => authority.updateAccount(token, id, {
      disabled: change.disabled, role: change.role === 'player' ? 'user' : change.role,
    }));
    this.sessions.atomic(() => {
      for (const root of roots) {
        const current = this.authoritySessions.get(root.digest);
        if (current && (account.disabled || current.view.account.role !== account.role))
          this.sessions.revoke(root, account.disabled ? 'disabled' : 'expired');
      }
    });
    return managedAccount(account);
  }
  /** Gameplay reads the last verified view. A failed refresh never extends this deadline. */
  canPlay(session: SessionRecord): boolean {
    if (!this.sessions.validateDigest(session.digest)) return false;
    if (!this.authority || session.subject.kind === 'guest') return true;
    const current = this.authoritySessions.get(session.parentDigest ?? session.digest);
    return session.scope === 'game' && !!current && current.view.rights.includes('play') &&
      this.now() < Math.min(current.checkedAt + PLAY_ACCESS_TTL_MS, current.view.expires_at, current.view.idle_expires_at);
  }
  async refreshPlayAccess(session: SessionRecord): Promise<void> {
    if (!this.authority || session.subject.kind !== 'account' || !this.sessions.validateDigest(session.digest)) return;
    const root = session.parentDigest ?? session.digest;
    const current = this.authoritySessions.get(root);
    if (current && this.now() >= Math.min(current.checkedAt + PLAY_REFRESH_AGE_MS, current.view.expires_at, current.view.idle_expires_at))
      await this.verifyAuthoritySession(root, current, session.subject.id);
  }
  async activity(session: SessionRecord, kind: 'player_command' | 'board_edit'): Promise<void> {
    if (!this.authority || session.subject.kind !== 'account') return;
    const root = session.parentDigest ?? session.digest;
    const current = this.authoritySessions.get(root);
    if (!current || !this.sessions.validateDigest(session.digest)) return;
    if (kind === 'player_command') {
      const startedAt = this.now();
      if (startedAt < (current.lastActivity ?? -Infinity) + PLAY_ACTIVITY_INTERVAL_MS) return;
      current.lastActivity = startedAt;
    }
    try {
      await this.authority.activity(current.token, kind);
    } catch (error) {
      if (error instanceof AuthError && error.status === 401) this.revokeAuthoritySession(root, current);
      throw error;
    }
  }
  async logoutAuthenticated(token: unknown, all = false, browser = false): Promise<void> {
    const session = this.sessions.validate(token);
    if (!session) throw new AuthError(401, 'Authentication required.');
    const roots = all ? this.repository.sessions().filter(value => value.scope === 'game' &&
      subjectKey(value.subject) === subjectKey(session.subject)) : [session];
    const remote = new Map(roots.flatMap(value => {
      const current = this.authoritySessions.get(value.digest);
      return current ? [[current.token, current.view.expires_at] as const] : [];
    }));
    if (all) this.logoutAll(token, browser);
    else this.logout(token);
    const results = await Promise.all([...remote].map(async ([remoteToken, expiresAt]) => {
      if (await this.revokeRemoteSession(remoteToken)) return true;
      if (this.pendingAuthorityLogouts.size < this.config.maxSessions)
        this.pendingAuthorityLogouts.set(remoteToken, expiresAt);
      return false;
    }));
    if (results.includes(false)) {
      serverLogger.warn('auth:logout:unconfirmed', 'Local sign-out succeeded but 4A sign-out could not be confirmed', {
        unconfirmed: results.filter(result => !result).length,
      });
      throw new AuthorityLogoutUnconfirmed();
    }
  }
  private async revokeRemoteSession(token: string): Promise<boolean> {
    try { await this.authority!.logout(token); return true; }
    catch (error) { return error instanceof AuthError && error.status === 401; }
  }
  async retryAuthorityLogouts(): Promise<void> {
    if (this.retryingLogouts || this.pendingAuthorityLogouts.size === 0) return;
    this.retryingLogouts = true;
    try {
      for (const [token, expiry] of this.pendingAuthorityLogouts) {
        if (expiry > this.now() && !await this.revokeRemoteSession(token)) break;
        this.pendingAuthorityLogouts.delete(token);
      }
    } finally { this.retryingLogouts = false; }
  }
  logout(token: unknown): void {
    const session = this.sessions.validate(token); if (!session) throw new AuthError(401, 'Authentication required.');
    this.sessions.revoke(session, 'logout'); this.audit('auth:logout', 'success', session.subject.kind === 'account' ? session.subject.id : undefined, session.scope);
  }
  logoutAll(token: unknown, browser = false): void {
    const session = this.sessions.validate(token);
    if (!session) throw new AuthError(401, 'Authentication required.');
    if (session.scope !== 'game' || session.subject.kind !== 'account' || session.kind === 'browser' && !browser) throw new AuthError(403, 'Use a public account session.');
    this.sessions.atomic(() => this.sessions.revokeSubject(session.subject, 'logout', 'game'));
    this.audit('auth:logout-all', 'success', session.subject.id, 'game');
  }
  /** Cookie proves the account; the returned bearer identifies exactly one game tab. */
  gameTab(parent: SessionRecord, priorToken?: unknown, roomId?: string): AuthResponse {
    return this.sessions.atomic(() => {
      if (parent.kind !== 'browser' || parent.subject.kind !== 'account' || !this.sessions.validateDigest(parent.digest)) throw new AuthError(401, 'Browser sign-in required.');
      const prior = this.sessions.validate(priorToken);
      if (prior?.kind === 'tab' && prior.parentDigest === parent.digest) {
        if (roomId && this.rooms.getRoom(roomId) && !this.repository.ownedSeat(roomId, sessionOwner(prior))) throw new AuthError(403, 'This game tab does not own that room seat.');
        return { ...this.info(prior, roomId), token: priorToken as string };
      }
      let seat;
      if (roomId && this.rooms.getRoom(roomId)) {
        this.assertAccountRoomAvailable(parent.subject.id, roomId);
        if (!prior || prior.kind === 'browser' || prior.kind === 'tab' || prior.scope !== 'game' || prior.subject.kind === 'account' && prior.subject.id !== parent.subject.id) throw new AuthError(403, 'This game tab does not own that room seat.');
        seat = this.repository.ownedSeat(roomId, sessionOwner(prior));
        if (!seat) throw new AuthError(403, 'This game tab does not own that room seat.');
        const occupied = this.repository.accountSeats(parent.subject.id).find(value => value.roomId === roomId);
        if (occupied && occupied.playerId !== seat.playerId) throw new AuthError(409, 'Account already occupies another seat in this room.');
      }
      const issued = this.sessions.issue(parent.subject, 'game', { kind: 'tab', parent,
        authorityExpiresAt: this.authority ? parent.expiresAt : undefined });
      if (seat && prior) { this.repository.saveSeat({ ...seat, owner: sessionOwner(issued.record), accountId: parent.subject.id }); this.sessions.revoke(prior, 'linked'); }
      return { ...this.info(issued.record, roomId), token: issued.token };
    });
  }
  async bootstrapAdmin(username: string, password: string): Promise<void> {
    const existing = this.repository.findByUsername(username);
    if (existing) {
      if (existing.role !== 'admin' || existing.disabled) throw new AuthError(409, 'Admin bootstrap identity is unavailable.');
      const valid = await this.passwordTask(() => verifyPassword(existing.passwordHash, password));
      const current = this.repository.findAccount(existing.id);
      if (!valid || !current || current.disabled || current.role !== 'admin' || current.passwordHash !== existing.passwordHash)
        throw new AuthError(409, 'Admin bootstrap credentials do not match.');
      return;
    }
    const passwordHash = await this.passwordTask(() => hashPassword(password, this.config.password));
    if (this.repository.accountCount() >= this.config.maxAccounts) throw new AuthError(503, 'Account capacity reached.');
    if (!this.repository.insertAccount({ id: randomUUID(), username, passwordHash, role: 'admin', disabled: false, createdAt: this.now() }))
      throw new AuthError(409, 'Admin bootstrap identity already exists.');
    this.audit('auth:bootstrap', 'success', undefined, 'admin');
  }
}
