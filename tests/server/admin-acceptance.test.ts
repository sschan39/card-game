import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connect, type Socket } from 'socket.io-client';
import { AuthResponseSchema, AdminAccountsResponseSchema, AdminConfigResponseSchema, type AuditRecord } from '@card-game/protocol';
import { createGameApplication } from '@server/application';

const password = 'copper lantern river orchard';
describe('Milestone 4 authenticated administration', () => {
  let directory: string, auditPath: string, app: ReturnType<typeof createGameApplication>, url: string, clock: number;
  const sockets: Socket[] = [];
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'card-game-admin-api-')); clock = Date.now(); auditPath = join(directory, 'admin-audit.jsonl');
    const delta = join(directory, 'deltas.jsonl'); writeFileSync(delta, '{"roomId":"room","seq":1}\n');
    app = createGameApplication({ databasePath: join(directory, 'game.sqlite'), auditPath, now: () => clock, configuration: { http: { pageSize: 1 }, storage: { maxDecksPerAccount: 1 } },
      environment: { NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://game.example,https://admin.example', INSPECTOR_ENABLED: 'true', DELTA_LOG_PATH: delta, ADMIN_BOOTSTRAP_USERNAME: 'operator', ADMIN_BOOTSTRAP_PASSWORD: password } });
    await app.ready; await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('Missing port'); url = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => { vi.restoreAllMocks(); sockets.splice(0).forEach(socket => socket.disconnect()); await new Promise<void>(resolve => app.io.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); });
  const request = (path: string, token?: string, body?: unknown) => fetch(url + path, { method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  async function login(username: string, scope = 'admin') {
    const response = await request('/api/auth/login', undefined, { protocolVersion: 1, username, password, scope }); expect(response.status).toBe(200);
    return AuthResponseSchema.parse(await response.json());
  }
  const auditRecords = () => readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as AuditRecord);
  function once<T>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.off(event, listener); reject(new Error('Timed out: ' + event)); }, 1500);
      const listener = (value: T) => { clearTimeout(timer); resolve(value); }; socket.once(event, listener);
    });
  }
  it('requires admin scope/current role on every route and exposes only approved account/config fields', async () => {
    const game = await login('operator', 'game'), admin = await login('operator');
    const created = app.runtime.createRoom('test-socket', 'seat');
    for (const path of ['/api/admin/me', '/api/admin/rooms', '/api/admin/rooms/' + created.roomId, '/api/admin/accounts', '/api/admin/config', '/api/admin/deltas']) {
      expect((await request(path)).status).toBe(401); expect((await request(path, game.token)).status).toBe(403); expect((await request(path, admin.token)).status).toBe(200);
    }
    const accounts = AdminAccountsResponseSchema.parse(await (await request('/api/admin/accounts', admin.token)).json());
    expect(accounts.accounts[0]).toMatchObject({ username: 'operator', disabled: false, role: 'admin' });
    expect(JSON.stringify(accounts)).not.toContain('passwordHash');
    const config = AdminConfigResponseSchema.parse(await (await request('/api/admin/config', admin.token)).json());
    expect(config).toMatchObject({ profile: 'production', inspectionEnabled: true, fixturesEnabled: false });
    expect(JSON.stringify(config)).not.toContain(password); expect(JSON.stringify(config)).not.toContain(directory);
    expect((await request('/api/admin/accounts?limit=101', admin.token)).status).toBe(400);
    expect((await request('/api/admin/deltas?cursor=forged', admin.token)).status).toBe(400);
    expect((await request('/api/debug/room/' + created.roomId, admin.token)).status).toBe(200);
    expect(auditRecords().filter(event => event.action === 'room.inspect' && event.outcome === 'success')).toHaveLength(2);
    expect((await request('/admin/index.html')).status).toBe(404);
    clock = admin.expiresAt; expect((await request('/api/admin/accounts', admin.token)).status).toBe(401);
  });
  it('disables an account and revokes its game/admin sessions and active socket immediately', async () => {
    await app.auth.bootstrapAdmin('second', password);
    const actor = await login('operator'), victimGame = await login('second', 'game'), victimAdmin = await login('second');
    const socket = connect(url, { transports: ['websocket'], reconnection: false, autoConnect: false, auth: { protocolVersion: 1, token: victimGame.token } }); sockets.push(socket);
    const ready = once(socket, 'sessionReady'); socket.connect(); await ready;
    const ended = once<{ reason: string }>(socket, 'sessionEnded'), disconnected = once(socket, 'disconnect');
    const response = await request('/api/admin/accounts/' + victimAdmin.account!.id + '/disable', actor.token, { protocolVersion: 1 });
    expect(response.status).toBe(200); expect((await response.json()).account.disabled).toBe(true); expect((await ended).reason).toBe('disabled'); await disconnected;
    expect((await request('/api/auth/me', victimGame.token)).status).toBe(401); expect((await request('/api/admin/me', victimAdmin.token)).status).toBe(401);
    expect((await request('/api/auth/login', undefined, { protocolVersion: 1, username: 'second', password })).status).toBe(401);
    expect((await request('/api/admin/accounts/' + actor.account!.id + '/disable', actor.token, { protocolVersion: 1 })).status).toBe(409);
    expect((await request('/api/admin/me', actor.token)).status).toBe(200);
    expect(auditRecords()).toContainEqual(expect.objectContaining({ actorId: actor.account!.id, action: 'account.disable', target: victimAdmin.account!.id, outcome: 'success', timestamp: clock }));
    const text = readFileSync(auditPath, 'utf8'), hash = app.store.auth.findAccount(victimAdmin.account!.id)!.passwordHash;
    for (const secret of [password, hash, actor.token, victimGame.token, victimAdmin.token]) expect(text).not.toContain(secret);
  });
  it('applies configured page defaults and deck quotas to the actual APIs', async () => {
    const admin = await login('operator'), accounts = await (await request('/api/admin/accounts', admin.token)).json(); expect(accounts.limit).toBe(1);
    const registered = AuthResponseSchema.parse(await (await request('/api/auth/register', undefined, { protocolVersion: 1, username: 'deckowner', password })).json());
    const body = { protocolVersion: 1, deck: { name: 'Configured quota', format: 'standard', cards: [{ cardId: 'land-red', quantity: 60 }] } };
    expect((await request('/api/decks', registered.token, body)).status).toBe(201); expect((await request('/api/decks', registered.token, body)).status).toBe(409);
    expect((await (await request('/api/cards')).json()).limit).toBe(1);
  });
  it('keeps the account and its sessions active when durable audit insertion fails', async () => {
    const actor = await login('operator');
    const registered = await request('/api/auth/register', undefined, { protocolVersion: 1, username: 'player', password });
    const player = AuthResponseSchema.parse(await registered.json()), revoked = vi.fn(); app.auth.sessions.onRevoke(revoked);
    vi.spyOn(app.store.audit, 'appendAudit').mockImplementation(() => { throw new Error('private-disk-error'); });
    const denied = await request('/api/admin/accounts/' + player.account!.id + '/disable', actor.token, { protocolVersion: 1 });
    expect(denied.status).toBe(500); expect(await denied.text()).not.toContain('private-disk-error');
    expect(app.store.auth.findAccount(player.account!.id)?.disabled).toBe(false); expect(app.auth.sessions.validate(player.token)).toBeDefined(); expect(revoked).not.toHaveBeenCalled();
  });
  it('keeps a committed disable successful when a post-commit notification listener fails', async () => {
    const actor = await login('operator');
    const registered = AuthResponseSchema.parse(await (await request('/api/auth/register', undefined, { protocolVersion: 1, username: 'notifyfailure', password })).json());
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    app.auth.sessions.onRevoke(() => { throw new Error('private notification error'); });
    const response = await request('/api/admin/accounts/' + registered.account!.id + '/disable', actor.token, { protocolVersion: 1 });
    expect(response.status).toBe(200); expect(app.store.auth.findAccount(registered.account!.id)?.disabled).toBe(true); expect(app.auth.sessions.validate(registered.token)).toBeUndefined();
    expect(auditRecords().filter(event => event.action === 'account.disable' && event.target === registered.account!.id)).toEqual([expect.objectContaining({ outcome: 'success' })]);
    expect(JSON.stringify(warning.mock.calls)).not.toContain('private notification error');
  });
  it('checks current role and rejects malformed privileged writes without promotion or hash exposure', async () => {
    const admin = await login('operator'), account = app.store.auth.findAccount(admin.account!.id)!;
    expect((await request('/api/admin/accounts/' + account.id + '/disable', admin.token, { protocolVersion: 1, role: 'player' })).status).toBe(400);
    expect(app.store.auth.findAccount(account.id)?.disabled).toBe(false);
    app.store.auth.saveAccount({ ...account, role: 'player' });
    expect((await request('/api/admin/config', admin.token)).status).toBe(401);
    expect(auditRecords().some(record => record.action === 'admin.denied')).toBe(true);
  });
});
