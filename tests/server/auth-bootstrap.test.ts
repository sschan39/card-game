import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrapAdmin } from '@server/auth/bootstrap';
import { AuthService } from '@server/auth/service';
import { InMemoryStore } from '@server/rooms/state-store';
import { authConfig } from '@server/config';

describe('explicit operator admin provisioning', () => {
  it('has no default account and requires complete unambiguous configuration', async () => {
    const store = new InMemoryStore(), auth = new AuthService(store.auth, store, authConfig); await auth.ready;
    await bootstrapAdmin(auth, {}); expect(store.auth.accountCount()).toBe(0);
    await expect(bootstrapAdmin(auth, { ADMIN_BOOTSTRAP_USERNAME: 'operator' })).rejects.toThrow('configuration');
    await expect(bootstrapAdmin(auth, { ADMIN_BOOTSTRAP_USERNAME: 'operator', ADMIN_BOOTSTRAP_PASSWORD: 'x', ADMIN_BOOTSTRAP_PASSWORD_FILE: 'also' })).rejects.toThrow('configuration');
  });
  it('provisions from a password file without persisting the plaintext password', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'card-game-admin-test-')), file = join(directory, 'password');
    const password = 'bootstrap-copper-river-94!'; writeFileSync(file, password + '\n');
    try {
      const store = new InMemoryStore(), auth = new AuthService(store.auth, store, authConfig);
      await bootstrapAdmin(auth, { ADMIN_BOOTSTRAP_USERNAME: 'Operator', ADMIN_BOOTSTRAP_PASSWORD_FILE: file });
      const account = store.auth.findByUsername('operator')!; expect(account.role).toBe('admin');
      expect(JSON.stringify(account)).not.toContain(password); expect(account.passwordHash).toMatch(/^\$argon2id/);
      const session = await auth.login({ username: 'operator', password, scope: 'admin' }); expect(session.scope).toBe('admin');
      await expect(auth.register({ username: 'operator', password })).rejects.toThrow('unavailable');
    } finally { rmSync(file); rmdirSync(directory); }
  });
});
