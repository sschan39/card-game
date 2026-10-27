import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AuditRecordSchema, type AuditRecord } from '@card-game/protocol';

export interface AuditRepository {
  appendAudit(record: AuditRecord): void;
  pendingAudit(limit: number): AuditRecord[];
  markAuditExported(id: string): void;
}
export class InMemoryAuditStore implements AuditRepository {
  private readonly entries = new Map<string, { record: AuditRecord; exported: boolean }>();
  appendAudit(record: AuditRecord) { this.entries.set(record.id, { record: structuredClone(record), exported: false }); }
  pendingAudit(limit: number) { return [...this.entries.values()].filter(entry => !entry.exported).slice(0, limit).map(entry => structuredClone(entry.record)); }
  markAuditExported(id: string) { const entry = this.entries.get(id); if (entry) entry.exported = true; }
}
/** Durable outbox first; JSONL export is at least once and identified by the event UUID. */
export class AuditService {
  exportPending = false;
  constructor(private readonly repository: AuditRepository, private readonly filename = '', private readonly now = Date.now) {}
  record(actorId: string | null, action: AuditRecord['action'], target: string, outcome: AuditRecord['outcome'] = 'success'): void {
    this.repository.appendAudit(AuditRecordSchema.parse({ id: randomUUID(), timestamp: this.now(), actorId, action, target, outcome }));
  }
  flush(): void {
    if (!this.filename) { this.exportPending = this.repository.pendingAudit(1).length > 0; return; }
    try {
      mkdirSync(dirname(this.filename), { recursive: true, mode: 0o700 });
      for (const record of this.repository.pendingAudit(100)) {
        appendFileSync(this.filename, JSON.stringify(record) + '\n', { mode: 0o600, flush: true });
        this.repository.markAuditExported(record.id);
      }
      this.exportPending = this.repository.pendingAudit(1).length > 0;
    } catch { this.exportPending = true; }
  }
}
