import type Database from 'better-sqlite3';
import { initialSchema } from './001-accounts-and-decks';
import { adminAuditSchema } from './002-admin-audit';
import { browserSessionsSchema } from './003-browser-sessions';

import { scenariosSchema } from './004-scenarios';
import { matchRecoverySchema } from './005-match-recovery';
import { accountAuthoritySchema } from './006-account-authority';

export const migrations = [
  { version: 1, sql: initialSchema },
  { version: 2, sql: adminAuditSchema },
  { version: 3, sql: browserSessionsSchema },
  { version: 4, sql: scenariosSchema },
  { version: 5, sql: matchRecoverySchema },
  { version: 6, sql: accountAuthoritySchema },
] as const;
export function migrate(database: Database.Database, steps: readonly { version: number; sql: string }[] = migrations): void {
  if(steps.some((step,index)=>step.version!==index+1))throw new Error('Invalid migration sequence');
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
