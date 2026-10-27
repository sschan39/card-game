import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SqliteStore } from './sqlite-store';

/** Uses SQLite's online backup API, including committed WAL content. Never copy a live .sqlite file alone. */
export async function backupDatabase(source: string, destination: string): Promise<void> {
  if (!existsSync(source) || !statSync(source).isFile()) throw new Error('Database source does not exist');
  if (resolve(source) === resolve(destination) || existsSync(destination)) throw new Error('Backup destination must be a new file');
  mkdirSync(dirname(resolve(destination)), { recursive: true, mode: 0o700 });
  const store = new SqliteStore(source);
  try { await store.backup(destination); } finally { store.close(); }
}
