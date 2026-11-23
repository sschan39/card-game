import { describe, expect, it, vi } from 'vitest';
import { authConfig } from '@server/config';
import type { AccountsAuthority } from '@server/auth/accounts-authority';
import { AuthError } from '@server/auth/errors';
import { AuthService } from '@server/auth/service';
import { InMemoryStore } from '@server/rooms/state-store';

const account = { id: '3c209c39-138e-4024-8845-c4180acf9e3a', username: 'tester', role: 'tester' as const, disabled: false };
const view = { account, rights: ['play', 'lab.operate'], expires_at: 2000000, idle_expires_at: 1000000 };

function fixture(settings = authConfig) {
  let now = 100000;
  const store = new InMemoryStore();
  const backend = {
    register: vi.fn().mockResolvedValue({ ...account, role: 'user' }),
    signIn: vi.fn().mockResolvedValue({ ...view, session: 'remote-secret' }),
    verify: vi.fn().mockResolvedValue(view),
    activity: vi.fn().mockResolvedValue(view),
    logout: vi.fn().mockResolvedValue(undefined),
  };
  const service = new AuthService(store.auth, store, settings, () => now, backend as unknown as AccountsAuthority);
  return { backend, service, store, advance: (elapsed: number) => { now += elapsed; } };
}

describe('HTTPS-authorized game sessions', () => {
  it('reuses the migrated ID and delegates rights for the browser and its match tab', async () => {
    const { backend, service, store } = fixture();
    store.auth.insertAccount({ ...account, role: 'player', passwordHash: 'existing-hash', createdAt: 1 });
    const login = await service.login({ username: account.username, password: 'dummy-password' }, undefined, true);
    expect(login.account?.id).toBe(account.id);
    expect(login).not.toHaveProperty('session');
    expect(store.auth.findAccount(account.id)?.passwordHash).toBe('existing-hash');
    const parent = service.sessions.validate(login.token)!;
    const child = service.gameTab(parent);
    await expect(service.authorize(service.sessions.validate(child.token)!, 'lab.operate')).resolves.toMatchObject(view);
    expect(backend.verify).toHaveBeenCalledWith('remote-secret');
    await service.activity(parent, 'board_edit');
    expect(backend.activity).toHaveBeenCalledWith('remote-secret', 'board_edit');
    await service.logoutAuthenticated(login.token);
    expect(backend.logout).toHaveBeenCalledWith('remote-secret');
    expect(service.sessions.validate(child.token)).toBeUndefined();
  });

  it('denies remote identity conflicts and public sessions do not inherit Admin scope', async () => {
    const { service, store } = fixture();
    store.auth.insertAccount({ ...account, id: 'other', role: 'player', passwordHash: 'legacy', createdAt: 1 });
    await expect(service.login({ username: account.username, password: 'anything' })).rejects.toMatchObject({ status: 409 });
    const { service: fresh } = fixture();
    await expect(fresh.login({ username: account.username, password: 'anything', scope: 'admin' }))
      .rejects.toMatchObject({ status: 403 });
  });

  it('fails closed during outage, then revokes the local session on definitive expiry', async () => {
    const { backend, service } = fixture();
    const login = await service.login({ username: account.username, password: 'password' });
    const session = service.sessions.validate(login.token)!;
    backend.verify.mockRejectedValueOnce(new AuthError(503, 'unavailable'));
    await expect(service.authorize(session)).rejects.toMatchObject({ status: 503 });
    expect(service.sessions.validate(login.token)).toBeDefined();
    backend.verify.mockRejectedValueOnce(new AuthError(401, 'expired'));
    await expect(service.authorize(session)).rejects.toMatchObject({ status: 401 });
    expect(service.sessions.validate(login.token)).toBeUndefined();
  });

  it('shares a bounded play decision and activity reports across game tabs', async () => {
    const { backend, service, advance } = fixture();
    const browser = await service.login({ username: account.username, password: 'password' }, undefined, true);
    const parent = service.sessions.validate(browser.token)!;
    const [first, second] = Array.from({ length: 2 }, () => service.sessions.validate(service.gameTab(parent).token)!);
    expect(service.canPlay(first)).toBe(true);
    await service.refreshPlayAccess(first);
    expect(backend.verify).not.toHaveBeenCalled();
    await Promise.all([first, second].map(tab => service.activity(tab, 'player_command')));
    expect(backend.activity).toHaveBeenCalledTimes(1);

    advance(20_000);
    backend.verify.mockRejectedValueOnce(new AuthError(503, 'unavailable'));
    const checks = await Promise.allSettled([first, second].map(tab => service.refreshPlayAccess(tab)));
    expect(checks.map(result => result.status)).toEqual(['rejected', 'rejected']);
    expect(backend.verify).toHaveBeenCalledTimes(1);
    expect(service.canPlay(first)).toBe(true);
    advance(10_000);
    expect(service.canPlay(first)).toBe(false);
    expect(service.sessions.validateDigest(first.digest)).toBeDefined();
    await service.refreshPlayAccess(second);
    expect(service.canPlay(first)).toBe(true);
    backend.verify.mockRejectedValueOnce(new AuthError(401, 'expired'));
    advance(20_000);
    await expect(service.refreshPlayAccess(first)).rejects.toMatchObject({ status: 401 });
    expect(service.sessions.validateDigest(second.digest)).toBeUndefined();
    expect(backend.activity).toHaveBeenCalledTimes(1);
  });

  it('honors the remote idle deadline even inside the play cache window', async () => {
    const { backend, service, advance } = fixture();
    backend.signIn.mockResolvedValue({ ...view, idle_expires_at: 105000, session: 'remote-secret' });
    const login = await service.login({ username: account.username, password: 'password' });
    const session = service.sessions.validate(login.token)!;
    advance(4999);
    expect(service.canPlay(session)).toBe(true);
    advance(1);
    expect(service.canPlay(session)).toBe(false);
    await service.refreshPlayAccess(session);
    expect(service.canPlay(session)).toBe(true);
  });

  it('frees long-lived browser session slots when the game server restarts', async () => {
    const settings = { ...authConfig, maxBrowserSessionsPerAccount: 1 };
    const { backend, service, store } = fixture(settings);
    const expiry = 253402300799000;
    backend.signIn.mockResolvedValue({ ...view, expires_at: expiry, idle_expires_at: expiry, session: 'remote-secret' });
    const credentials = { username: account.username, password: 'password' };
    const login = await service.login(credentials, undefined, true);
    const tab = service.gameTab(service.sessions.validate(login.token)!);
    const guest = service.guest();
    await expect(service.login(credentials, undefined, true)).rejects.toMatchObject({ status: 409 });

    const restarted = new AuthService(store.auth, store, settings, () => 100000, backend as unknown as AccountsAuthority);
    expect(restarted.sessions.validate(login.token)).toBeUndefined();
    expect(restarted.sessions.validate(tab.token)).toBeUndefined();
    expect(restarted.sessions.validate(guest.token)).toBeDefined();
    await expect(restarted.login(credentials, undefined, true)).resolves.toMatchObject({ expiresAt: expiry });
  });
});
