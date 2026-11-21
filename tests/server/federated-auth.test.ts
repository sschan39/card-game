import { describe, expect, it, vi } from 'vitest';
import { authConfig } from '@server/config';
import type { AccountsAuthority } from '@server/auth/accounts-authority';
import { AuthError } from '@server/auth/errors';
import { AuthService } from '@server/auth/service';
import { InMemoryStore } from '@server/rooms/state-store';

const account = { id: '3c209c39-138e-4024-8845-c4180acf9e3a', username: 'tester', role: 'tester' as const, disabled: false };
const view = { account, rights: ['play', 'lab.operate'], expires_at: 2000000, idle_expires_at: 1000000 };

function fixture() {
  const store = new InMemoryStore();
  const backend = {
    register: vi.fn().mockResolvedValue({ ...account, role: 'user' }),
    signIn: vi.fn().mockResolvedValue({ ...view, session: 'remote-secret' }),
    verify: vi.fn().mockResolvedValue(view),
    activity: vi.fn().mockResolvedValue(view),
    logout: vi.fn().mockResolvedValue(undefined),
  };
  const service = new AuthService(store.auth, store, authConfig, () => 100000, backend as unknown as AccountsAuthority);
  return { backend, service, store };
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
});
