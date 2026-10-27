import type Database from 'better-sqlite3';
import { initialSchema } from './001-accounts-and-decks';

export const migrations = [{ version: 1, sql: initialSchema }] as const;
export function migrate(database: Database.Database, steps: readonly { version: number; sql: string }[] = migrations): void {
  database.transaction(() => {
    database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT');
    const applied = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations ORDER BY version').all().map(row => row.version);
    if (applied.some((version, index) => version !== steps[index]?.version)) throw new Error('Unsupported database schema version');
    for (const step of steps) if (!applied.includes(step.version)) {
      database.exec(step.sql);
      database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(step.version, Date.now());
    }
  }).immediate();
}
