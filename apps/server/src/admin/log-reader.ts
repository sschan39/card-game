import { openSync, closeSync, fstatSync, readSync } from 'node:fs';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { PROTOCOL_VERSION, type AdminLogPage } from '@card-game/protocol';
import { AuthError } from '../auth/errors';
import { redactCredentials } from '../auth/redaction';
import type { ServerConfig } from '../config';

const CursorSchema = z.object({ v: z.literal(1), file: z.string().max(128), offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), skip: z.boolean(), anchor: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Cursor = z.infer<typeof CursorSchema>;
type Bounds = Pick<ServerConfig['logging'], 'pageBytes' | 'maxLineBytes' | 'scanBytes'>;
/** Fixed buffers and signed byte cursors; neither line offsets nor pages require whole-file reads. */
export class DiagnosticLogReader {
  private readonly key = randomBytes(32);
  constructor(private readonly filename: string, private readonly bounds: Bounds) {}
  private signature(value: string): Buffer { return createHmac('sha256', this.key).update(value).digest(); }
  private decode(token: string): Cursor {
    try {
      if (token.length > 2048) throw new Error();
      const [payload, encoded, extra] = token.split('.'), signature = Buffer.from(encoded, 'base64url');
      if (extra || signature.length !== 32 || !timingSafeEqual(signature, this.signature(payload))) throw new Error();
      return CursorSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    } catch { throw new AuthError(400, 'Invalid log cursor. Refresh the log.'); }
  }
  private encode(cursor: Cursor): string {
    const payload = Buffer.from(JSON.stringify(cursor)).toString('base64url');
    return payload + '.' + this.signature(payload).toString('base64url');
  }
  private anchor(fd: number, offset: number): string {
    const bytes = Buffer.alloc(Math.min(64, offset));
    const length = readSync(fd, bytes, 0, bytes.length, offset - bytes.length);
    return createHash('sha256').update(bytes.subarray(0, length)).digest('hex');
  }
  page(input: { cursor?: string; offset: number; limit: number }): AdminLogPage {
    if (!this.filename) throw new AuthError(404, 'Diagnostic logging is disabled.');
    const cursor = input.cursor ? this.decode(input.cursor) : undefined;
    let fd: number;
    try { fd = openSync(this.filename, 'r'); } catch { throw new AuthError(input.cursor ? 409 : 404, input.cursor ? 'The log changed. Refresh from the beginning.' : 'No diagnostic log is available yet.'); }
    try {
      const stat = fstatSync(fd), file = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
      const start = cursor?.offset ?? input.offset;
      if (!stat.isFile() || start > stat.size || cursor && (cursor.file !== file || cursor.anchor !== this.anchor(fd, start)))
        throw new AuthError(409, 'The log changed. Refresh from the beginning.');
      if (start && !cursor?.skip) {
        const previous = Buffer.alloc(1); readSync(fd, previous, 0, 1, start - 1);
        if (previous[0] !== 10) throw new AuthError(400, 'Log offset must start at a line boundary.');
      }
      const entries: AdminLogPage['entries'] = [], chunk = Buffer.alloc(Math.min(32768, this.bounds.scanBytes)), line = Buffer.alloc(this.bounds.maxLineBytes);
      let position = start, lineStart = start, lineLength = 0, oversized = cursor?.skip ?? false;
      let scanned = 0, bytesRead = 0, pageBytes = 0, skipped = 0, stopped = false, eof = false;
      while (!stopped && scanned < this.bounds.scanBytes) {
        const count = readSync(fd, chunk, 0, Math.min(chunk.length, this.bounds.scanBytes - scanned), position);
        bytesRead += count;
        if (!count) { eof = true; break; }
        for (let index = 0; index < count; index++) {
          position++; scanned++;
          if (chunk[index] !== 10) {
            if (!oversized && lineLength < line.length) line[lineLength++] = chunk[index]; else oversized = true;
            continue;
          }
          if (oversized) skipped++;
          else if (lineLength) {
            try {
              const value = redactCredentials(JSON.parse(line.subarray(0, lineLength).toString('utf8')));
              const size = Buffer.byteLength(JSON.stringify({ offset: lineStart, value }));
              if (size > this.bounds.pageBytes) skipped++;
              else if (pageBytes + size > this.bounds.pageBytes) { position = lineStart; lineLength = 0; stopped = true; break; }
              else { entries.push({ offset: lineStart, value }); pageBytes += size; }
            } catch { skipped++; }
          }
          lineStart = position; lineLength = 0; oversized = false;
          if (entries.length >= input.limit) { stopped = true; break; }
        }
      }
      if (lineLength && !oversized) position = lineStart; // Retry an unfinished normal line after the next append/page.
      eof = eof || position >= fstatSync(fd).size;
      const nextCursor = this.encode({ v: 1, file, offset: position, skip: oversized, anchor: this.anchor(fd, position) });
      return { protocolVersion: PROTOCOL_VERSION, entries, nextCursor, eof, bytesRead, skipped };
    } finally { closeSync(fd); }
  }
}
