import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiagnosticLogReader } from '@server/admin/log-reader';
import { loadServerConfig } from '@server/config';

describe('bounded diagnostic log pages', () => {
  let directory: string, filename: string;
  const bounds = loadServerConfig({}).logging;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'card-game-admin-log-')); filename = join(directory, 'deltas.jsonl'); });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));
  it('seeks and pages a 100,000-line log with small bounded reads', () => {
    const line = (index: number) => JSON.stringify({ sequence: String(index).padStart(6, '0') }) + '\n', width = Buffer.byteLength(line(0));
    for (let offset = 0; offset < 100000; offset += 1000) appendFileSync(filename, Array.from({ length: 1000 }, (_, index) => line(offset + index)).join(''));
    expect(statSync(filename).size).toBe(width * 100000);
    const reader = new DiagnosticLogReader(filename, bounds), first = reader.page({ offset: 0, limit: 25 });
    expect(first.entries).toHaveLength(25); expect(first.bytesRead).toBeLessThanOrEqual(32768); expect(first.bytesRead).toBeLessThan(statSync(filename).size / 10);
    const second = reader.page({ cursor: first.nextCursor!, offset: 0, limit: 25 });
    expect(second.entries[0].value).toEqual({ sequence: '000025' });
    const last = reader.page({ offset: width * 99990, limit: 25 });
    expect(last.entries).toHaveLength(10); expect(last.entries.at(-1)?.value).toEqual({ sequence: '099999' }); expect(last.eof).toBe(true);
    expect(() => reader.page({ offset: 1, limit: 25 })).toThrow('line boundary');
  });
  it('rejects tampering, truncation and rotation while allowing append after EOF', () => {
    writeFileSync(filename, '{"seq":1}\n'); const reader = new DiagnosticLogReader(filename, bounds), page = reader.page({ offset: 0, limit: 10 });
    expect(() => reader.page({ offset: 0, limit: 10, cursor: page.nextCursor! + 'tampered' })).toThrow('cursor');
    appendFileSync(filename, '{"seq":2}\n'); expect(reader.page({ offset: 0, limit: 10, cursor: page.nextCursor! }).entries[0].value).toEqual({ seq: 2 });
    writeFileSync(filename, ''); expect(() => reader.page({ offset: 0, limit: 10, cursor: page.nextCursor! })).toThrow('log changed');
    writeFileSync(filename, '{"seq":1}\n'); const another = reader.page({ offset: 0, limit: 10 });
    renameSync(filename, filename + '.1'); writeFileSync(filename, '{"seq":3}\n');
    expect(() => reader.page({ offset: 0, limit: 10, cursor: another.nextCursor! })).toThrow('log changed');
  });
  it('bounds oversized lines, advances across scan budgets and redacts credentials', () => {
    const tiny = { pageBytes: 1024, maxLineBytes: 128, scanBytes: 1024 };
    writeFileSync(filename, 'x'.repeat(2500) + '\nnot-json\n' + JSON.stringify({ password: 'must-not-escape', nested: { token: 'another-secret' }, safe: true }) + '\n');
    const reader = new DiagnosticLogReader(filename, tiny), first = reader.page({ offset: 0, limit: 25 });
    expect(first.bytesRead).toBeLessThanOrEqual(1024); expect(first.entries).toEqual([]);
    const second = reader.page({ offset: 0, limit: 25, cursor: first.nextCursor! });
    const third = reader.page({ offset: 0, limit: 25, cursor: second.nextCursor! });
    expect(third.entries).toHaveLength(1); expect(third.skipped).toBe(2);
    expect(JSON.stringify(third)).not.toContain('must-not-escape'); expect(JSON.stringify(third)).not.toContain('another-secret'); expect(third.entries[0].value).toMatchObject({ safe: true });
  });
  it('waits for incomplete final lines and handles missing/disabled/non-file sources', () => {
    const reader = new DiagnosticLogReader(filename, bounds); expect(() => reader.page({ offset: 0, limit: 1 })).toThrow('No diagnostic');
    writeFileSync(filename, '{"seq":1'); const first = reader.page({ offset: 0, limit: 1 }); expect(first.entries).toEqual([]);
    appendFileSync(filename, '}\n'); expect(reader.page({ offset: 0, limit: 1, cursor: first.nextCursor! }).entries[0].value).toEqual({ seq: 1 });
    expect(() => new DiagnosticLogReader('', bounds).page({ offset: 0, limit: 1 })).toThrow('disabled');
    mkdirSync(join(directory, 'folder')); expect(() => new DiagnosticLogReader(join(directory, 'folder'), bounds).page({ offset: 0, limit: 1 })).toThrow();
  });
});
