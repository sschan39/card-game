import { describe, expect, it, vi } from 'vitest';
import { AuthResponseSchema, RegisterRequestSchema, LoginRequestSchema, PROTOCOL_VERSION } from '@card-game/protocol';
import { authConfig, allowedOrigins } from '@server/config';
import { InMemoryStore } from '@server/rooms/state-store';
import { InMemoryAccountStore } from '@server/auth/account-store';
import { SessionService } from '@server/auth/session';
import { AuthService } from '@server/auth/service';
import { assertPasswordPolicy, hashPassword, verifyPassword } from '@server/auth/password';
import { redactCredentials } from '@server/auth/redaction';
import { authenticateHandshake } from '@server/realtime/handshake';
import { createTestRoom } from '../helpers/test-room-factory';

const password = 'copper-lantern-river-94!';
describe('password policy and hashing', () => {
  it('uses configured Argon2id costs, unique salts and real verification', async () => {
    const a = await hashPassword(password), b = await hashPassword(password);
    expect(a).toMatch(/^\$argon2id\$v=19\$/); expect(a.split('$')[3].split(',').sort()).toEqual(['m=19456', 'p=1', 't=2']); expect(a).not.toBe(b);
    expect(await verifyPassword(a, password)).toBe(true); expect(await verifyPassword(a, password + '!')).toBe(false);
  });
  it('accepts long phrases and Unicode without composition rules and blocks known weak phrases', () => {
    expect(() => assertPasswordPolicy('a sufficiently long ordinary phrase')).not.toThrow();
    expect(() => assertPasswordPolicy('山'.repeat(15))).not.toThrow();
    for (const value of ['short', 'passwordpassword', 'qwertyuiopasdfgh', 'x'.repeat(129)]) expect(() => assertPasswordPolicy(value)).toThrow();
  });
  it('normalizes equivalent Unicode consistently without trimming password spaces', async () => {
    const value = 'cafe\u0301 phrase with spaces ';
    const hash = await hashPassword(value);
    expect(await verifyPassword(hash, value.normalize('NFC'))).toBe(true);
    expect(await verifyPassword(hash, value.trim())).toBe(false);
  });
});
describe('bounded opaque sessions', () => {
  it('stores no raw token, expires precisely, frees capacity and emits revocation', () => {
    let now = 100; const store = new InMemoryAccountStore();
    const sessions = new SessionService(store, { ...authConfig, maxSessions: 1, guestTtlMs: 50 }, () => now), revoked = vi.fn();
    sessions.onRevoke(revoked);
    const first = sessions.issue({ kind: 'guest', id: 'g' });
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(JSON.stringify(store.sessions())).not.toContain(first.token);
    expect(sessions.validate(first.token)?.subject.id).toBe('g');
    expect(() => sessions.issue({ kind: 'guest', id: 'h' })).toThrow('capacity');
    now = 150; expect(sessions.validate(first.token)).toBeUndefined(); expect(revoked).toHaveBeenCalledWith(first.record, 'expired');
    expect(sessions.issue({ kind: 'guest', id: 'h' }).record.subject.id).toBe('h');
  });
  it('rejects malformed, missing and revoked credentials', () => {
    const sessions = new SessionService(new InMemoryAccountStore(), authConfig), issued = sessions.issue({ kind: 'guest', id: 'g' });
    for (const token of [null, {}, '', 'bad', 'a'.repeat(43)]) expect(sessions.validate(token)).toBeUndefined();
    sessions.revoke(issued.record, 'logout'); expect(sessions.validate(issued.token)).toBeUndefined();
  });
});
describe('account identity and separate admin privilege', () => {
  it('normalizes input, rejects public privilege claims and validates response shapes', () => {
    expect(RegisterRequestSchema.parse({ protocolVersion: PROTOCOL_VERSION, username: ' Alice ', password }).username).toBe('alice');
    expect(RegisterRequestSchema.safeParse({ protocolVersion: PROTOCOL_VERSION, username: 'alice', password, role: 'admin' }).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ protocolVersion: PROTOCOL_VERSION, username: 'alice', password, scope: 'admin', roomId: 'room' }).success).toBe(false);
  });
  it('rotates within scope, keeps admin separate and checks account status on every validation', async () => {
    const store = new InMemoryStore(), auth = new AuthService(store.auth, store, authConfig);
    await auth.bootstrapAdmin('operator', password);
    const game = await auth.login({ username: 'operator', password });
    const admin = await auth.login({ username: 'operator', password, scope: 'admin' });
    expect(AuthResponseSchema.safeParse(admin).success).toBe(true);
    expect(admin.scope).toBe('admin'); expect(admin.expiresAt - Date.now()).toBeLessThanOrEqual(authConfig.adminSessionTtlMs);
    expect(auth.sessions.validate(game.token)).toBeDefined();
    const next = await auth.login({ username: 'operator', password, scope: 'admin' });
    expect(auth.sessions.validate(admin.token)).toBeUndefined(); expect(auth.sessions.validate(next.token)).toBeDefined();
    expect(auth.sessions.validate(game.token)).toBeDefined();
    expect(() => authenticateHandshake(auth, { protocolVersion: PROTOCOL_VERSION, token: next.token })).toThrow('game session');
    const record = store.auth.findAccount(game.account!.id)!; store.auth.saveAccount({ ...record, disabled: true });
    expect(auth.sessions.validate(game.token)).toBeUndefined(); expect(auth.sessions.validate(next.token)).toBeUndefined();
    await expect(auth.login({ username: 'operator', password })).rejects.toThrow('Invalid username or password');
  });
  it('preserves guest seat references on linking and prevents linking two seats to one account', async () => {
    const store = new InMemoryStore(), auth = new AuthService(store.auth, store, authConfig);
    const room = createTestRoom(); store.saveRoom(room);
    const guest = auth.guest(), guestRecord = auth.sessions.validate(guest.token)!;
    auth.claimSeat(guestRecord, room.roomId, 'player1');
    const account = await auth.register({ username: 'linked', password, roomId: room.roomId }, guest.token);
    expect(account.playerId).toBe('player1'); expect(account.roomId).toBe(room.roomId);
    expect(auth.sessions.validate(guest.token)).toBeUndefined(); expect(store.getRoom(room.roomId)).toBe(room);
    expect(authenticateHandshake(auth, { protocolVersion: PROTOCOL_VERSION, token: account.token, roomId: room.roomId, playerId: 'player2' }).playerId).toBe('player1');
    const other = auth.guest(); auth.claimSeat(auth.sessions.validate(other.token)!, room.roomId, 'player2');
    await expect(auth.login({ username: 'linked', password, roomId: room.roomId }, other.token)).rejects.toThrow('another seat');
    expect(auth.sessions.validate(other.token)).toBeDefined(); expect(auth.sessions.validate(account.token)).toBeDefined();
  });
  it('normal players cannot obtain privileged sessions, even with a valid password', async () => {
    const store = new InMemoryStore(), auth = new AuthService(store.auth, store, authConfig);
    const game = await auth.register({ username: 'normal', password });
    await expect(auth.login({ username: 'normal', password, scope: 'admin' })).rejects.toThrow('Admin role');
    expect(auth.sessions.validate(game.token)).toBeDefined();
  });
  it('bounds expensive password jobs and rejects full registration without orphaning accounts', async () => {
    const store = new InMemoryStore(), auth = new AuthService(store.auth, store, { ...authConfig, maxPasswordOperations: 1, maxSessions: 1 });
    await auth.ready;
    const pending = auth.register({ username: 'parallel-one', password });
    await expect(auth.register({ username: 'parallel-two', password })).rejects.toThrow('busy');
    await pending;
    await expect(auth.register({ username: 'no-capacity', password })).rejects.toThrow('capacity');
    expect(store.auth.accountCount()).toBe(1); expect(store.auth.findByUsername('no-capacity')).toBeUndefined();
  });
  it('does not complete an in-flight login after the stored password has changed', async () => {
    const store = new InMemoryStore(), auth = new AuthService(store.auth, store, authConfig);
    const account = await auth.register({ username: 'changed', password });
    const replacement = await hashPassword('another-river-lantern-55!');
    const pending = auth.login({ username: 'changed', password });
    store.auth.saveAccount({ ...store.auth.findAccount(account.account!.id)!, passwordHash: replacement });
    await expect(pending).rejects.toThrow('Invalid username or password');
  });
});
it('redacts nested credential keys before structured logging', () => {
  const sanitized = redactCredentials({ event: 'login', password, nested: [{ passwordHash: 'hash-secret', authorization: 'Bearer secret', sessionToken: 'raw-secret', safe: 42 }] });
  const text = JSON.stringify(sanitized);
  for (const value of [password, 'hash-secret', 'Bearer secret', 'raw-secret']) expect(text).not.toContain(value);
  expect(text).toContain('42');
});
it('requires explicit production origins and rejects wildcard, path and credential configurations', () => {
  expect(allowedOrigins({ NODE_ENV: 'production' }).size).toBe(0);
  const origins = allowedOrigins({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://game.example,https://admin.example' });
  expect(origins.has('https://admin.example')).toBe(true); expect(origins.has('http://localhost:5173')).toBe(false);
  expect(allowedOrigins({}).size).toBe(3);
  for (const value of ['*', 'https://site.example/path', 'https://user:password@site.example']) expect(() => allowedOrigins({ ALLOWED_ORIGINS: value })).toThrow();
});
