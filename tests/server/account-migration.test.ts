import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportIdentityMigration, SqliteStore } from '@server/stores/sqlite-store';
import { hashPassword } from '@server/auth/password';

describe('offline account export', () => {
  it('preserves stable account identities without exporting game or session data', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'game-account-export-'));
    const source = join(directory, 'source.sqlite'), destination = join(directory, 'accounts.json');
    const id = randomUUID(), createdAt = 1730000000000;
    const password = 'synthetic legacy password';
    const passwordHash = await hashPassword(password);
    try {
      const database = new SqliteStore(source);
      database.insertAccount({ id, username: 'legacy', role: 'admin', disabled: true, createdAt, passwordHash });
      database.insertAccount({ id: randomUUID(), username: 'projection', role: 'player', disabled: false, createdAt, passwordHash: '' });
      database.close();
      const before = readFileSync(source);
      expect(exportIdentityMigration(source, destination)).toBe(1);
      const exported = readFileSync(destination, 'utf8');
      expect(JSON.parse(exported)).toEqual({ format: 'foura.identity-import', version: 1, accounts: [
        { id, username: 'legacy', role: 'admin', disabled: true, created_at: new Date(createdAt).toISOString(),
          password_hash: passwordHash },
      ] });
      expect(exported).not.toContain(password);
      expect(readFileSync(source)).toEqual(before);
      expect(() => exportIdentityMigration(source, destination)).toThrow();
      expect(readFileSync(destination, 'utf8')).toBe(exported);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('requires the bound project after a database adopts an external authority', () => {
    const directory = mkdtempSync(join(tmpdir(), 'game-authority-binding-'));
    const source = join(directory, 'game.sqlite');
    const localConfig = { instanceId: 'migration', purpose: 'lab' as const };
    const accountProjectId = randomUUID();
    try {
      new SqliteStore(source, undefined, localConfig).close();
      new SqliteStore(source, undefined, { ...localConfig, accountProjectId }).close();
      expect(() => new SqliteStore(source, undefined, localConfig).close()).toThrow('account project');
      expect(() => new SqliteStore(source, undefined, { ...localConfig, accountProjectId: randomUUID() }).close())
        .toThrow('account project');
      new SqliteStore(source, undefined, { ...localConfig, accountProjectId }).close();
      new SqliteStore(source).close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
