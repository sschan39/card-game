import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SqliteStore } from '@server/stores/sqlite-store';
import { AuditService } from '@server/admin/audit';
import { migrate, migrations } from '@server/stores/migrations';

const Database = createRequire(resolve('apps/server/package.json'))('better-sqlite3') as typeof import('better-sqlite3');
describe('durable admin audit and upgrade', () => {
  let directory: string;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'card-game-audit-')); });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));
  it('upgrades a Milestone 3 database without losing its accounts', () => {
    const filename = join(directory, 'old.sqlite'), previous = new Database(filename);
    migrate(previous, [migrations[0]]);
    previous.prepare("INSERT INTO accounts VALUES ('legacy','legacy','player','existing-hash',0,1)").run(); previous.close();
    const upgraded = new SqliteStore(filename);
    try { expect(upgraded.findByUsername('legacy')?.passwordHash).toBe('existing-hash'); expect(upgraded.pendingAudit(10)).toEqual([]); }
    finally { upgraded.close(); }
  });
  it('retains unexported events across restart and retries JSONL export after a filesystem failure', () => {
    const filename = join(directory, 'audit.sqlite'), blocked = join(directory, 'blocked'); writeFileSync(blocked, 'not a directory');
    let store = new SqliteStore(filename), audit = new AuditService(store, join(blocked, 'audit.jsonl'), () => 123);
    audit.record('operator', 'accounts.list', 'accounts'); audit.flush(); expect(audit.exportPending).toBe(true);
    const original = store.pendingAudit(1)[0]; store.close(); store = new SqliteStore(filename);
    try {
      expect(store.pendingAudit(10)).toEqual([original]); rmSync(blocked);
      audit = new AuditService(store, join(blocked, 'audit.jsonl')); audit.flush(); expect(audit.exportPending).toBe(false);
      expect(store.pendingAudit(10)).toEqual([]); expect(JSON.parse(readFileSync(join(blocked, 'audit.jsonl'), 'utf8'))).toEqual(original);
      audit.flush(); expect(readFileSync(join(blocked, 'audit.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
    } finally { store.close(); }
  });
});
