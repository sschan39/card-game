import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditService, InMemoryAuditStore } from '@server/admin/audit';
import { DiagnosticLogReader } from '@server/admin/log-reader';
import { loadServerConfig } from '@server/config';

describe('in-memory audit outbox and export bookkeeping', () => {
  let directory: string;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'card-game-audit-memory-')); });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('records identified events, treats unexported work as pending and exports at most 100 per flush', () => {
    const store = new InMemoryAuditStore(), filename = join(directory, 'nested', 'audit.jsonl');
    const audit = new AuditService(store, filename, () => 1234);
    for (let index = 0; index < 101; index++) audit.record(index % 2 ? null : 'operator', 'rooms.list', `room-${index}`, index % 2 ? 'success' : 'denied');
    expect(store.pendingAudit(1000)).toHaveLength(101);
    expect(store.pendingAudit(1000)[0]).toMatchObject({ timestamp: 1234, actorId: 'operator', outcome: 'denied' });
    audit.flush();
    expect(readFileSync(filename, 'utf8').trim().split('\n')).toHaveLength(100);
    expect(audit.exportPending).toBe(true);
    expect(store.pendingAudit(10)).toHaveLength(1);
    audit.flush();
    const lines = readFileSync(filename, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(101);
    expect(lines[100]).toContain('room-100');
    expect(audit.exportPending).toBe(false);
    const firstId = (JSON.parse(lines[0]) as { id: string }).id;
    store.markAuditExported(firstId); store.markAuditExported('00000000-0000-4000-8000-000000000000');
    expect(store.pendingAudit(10)).toHaveLength(0);
  });

  it('reports pending work without a destination and keeps the outbox when the destination is unwritable', () => {
    const store = new InMemoryAuditStore(), blocked = join(directory, 'blocked'), filename = join(directory, 'audit.jsonl');
    const memoryOnly = new AuditService(store);
    memoryOnly.flush(); expect(memoryOnly.exportPending).toBe(false);
    memoryOnly.record('operator', 'config.read', 'config');
    memoryOnly.flush(); expect(memoryOnly.exportPending).toBe(true);
    writeFileSync(blocked, 'not a directory');
    let audit = new AuditService(store, join(blocked, 'audit.jsonl'));
    audit.flush(); expect(audit.exportPending).toBe(true); expect(store.pendingAudit(10)).toHaveLength(1);
    rmSync(blocked);
    audit = new AuditService(store, filename);
    audit.flush(); expect(audit.exportPending).toBe(false);
    expect(JSON.parse(readFileSync(filename, 'utf8'))).toMatchObject({ action: 'config.read', target: 'config' });
    audit.flush(); expect(audit.exportPending).toBe(false);
  });

  it('rolls back queued events when a transactional operation fails and keeps committed ones', () => {
    const store = new InMemoryAuditStore(), audit = new AuditService(store);
    audit.record('operator', 'accounts.list', 'accounts');
    expect(() => store.auditTransaction(() => { audit.record('operator', 'account.disable', 'account'); throw new Error('rollback'); })).toThrow('rollback');
    expect(store.pendingAudit(10)).toHaveLength(1);
    expect(audit.atomic(() => { audit.record('operator', 'logs.read', 'logs'); return 'committed'; })).toBe('committed');
    expect(store.pendingAudit(10).map(record => record.action)).toEqual(['accounts.list', 'logs.read']);
  });
});

describe('diagnostic log cursor and page-size boundaries', () => {
  let directory: string, filename: string;
  const bounds = loadServerConfig({}).logging, entrySize = (offset: number, value: unknown) => Buffer.byteLength(JSON.stringify({ offset, value }));
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'card-game-log-bounds-')); filename = join(directory, 'deltas.jsonl'); });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('rejects cursors longer than the protocol allows and a cursor whose file has vanished', () => {
    const reader = new DiagnosticLogReader(filename, bounds);
    expect(() => reader.page({ cursor: 'a'.repeat(2049), offset: 0, limit: 1 })).toThrow('Invalid log cursor');
    writeFileSync(filename, '{"seq":1}\n');
    const cursor = reader.page({ offset: 0, limit: 1 }).nextCursor!;
    rmSync(filename);
    expect(() => reader.page({ cursor, offset: 0, limit: 1 })).toThrow('The log changed. Refresh from the beginning.');
  });

  it('ignores blank lines without shifting the recorded offsets', () => {
    writeFileSync(filename, '{"a":1}\n\n{"b":2}\n');
    const page = new DiagnosticLogReader(filename, bounds).page({ offset: 0, limit: 10 });
    expect(page.entries).toEqual([{ offset: 0, value: { a: 1 } }, { offset: 9, value: { b: 2 } }]);
    expect(page.skipped).toBe(0); expect(page.eof).toBe(true);
  });

  it('skips a single entry larger than the page budget while keeping later entries', () => {    const large = { payload: 'x'.repeat(100) }, pageBytes = entrySize(0, large) - 1;
    writeFileSync(filename, JSON.stringify(large) + '\n' + JSON.stringify({ small: true }) + '\n');
    const page = new DiagnosticLogReader(filename, { pageBytes, maxLineBytes: 1024, scanBytes: 4096 }).page({ offset: 0, limit: 10 });
    expect(page.skipped).toBe(1); expect(page.entries.map(entry => entry.value)).toEqual([{ small: true }]);
  });

  it('ends a page before an entry that would overflow it and resumes at that entry', () => {
    const first = { a: 1 }, second = { a: 2 }, pageBytes = entrySize(0, first) + entrySize(8, second);
    writeFileSync(filename, JSON.stringify(first) + '\n' + JSON.stringify(second) + '\n' + JSON.stringify({ a: 3 }) + '\n');
    const reader = new DiagnosticLogReader(filename, { pageBytes, maxLineBytes: 1024, scanBytes: 4096 });
    const page = reader.page({ offset: 0, limit: 10 });
    expect(page.entries.map(entry => entry.offset)).toEqual([0, 8]); expect(page.eof).toBe(false);
    const resumed = reader.page({ cursor: page.nextCursor!, offset: 0, limit: 10 });
    expect(resumed.entries).toEqual([{ offset: 16, value: { a: 3 } }]); expect(resumed.eof).toBe(true);
  });
});
