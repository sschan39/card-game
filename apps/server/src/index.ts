// Process entry point. HTTP, authentication and socket composition live in application.ts.
import { createGameApplication } from './application';
import { serverLogger } from '@card-game/engine/shared/game-logger';
import path from 'node:path';
import { backupDatabase } from './stores/backup';
import { loadServerConfig, ConfigurationError } from './config';

async function main(): Promise<void> {
  const environment = process.argv[2] === '--vite' ? { ...process.env, FRONTEND_MODE: 'vite' } : process.env;
  const config = loadServerConfig(environment), root = path.resolve(__dirname, '..', '..', '..');
  const databasePath = path.resolve(root, config.storage.databasePath);
  if (process.argv[2] === 'backup') {
    if (process.argv.length !== 4) throw new Error('Provide a new backup destination');
    await backupDatabase(databasePath, process.argv[3]); return;
  }
  const port = config.http.port;
  const { server, io, ready } = createGameApplication({ databasePath, auditPath: path.resolve(root, config.logging.auditPath), effectiveConfig: config });
  await ready;
  server.listen(port, () => serverLogger.info('server:listening', 'Game server started', { port }));
  const shutdown = () => { io.close(); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
void main().catch(error => {
  serverLogger.error('server:startup:failed', error instanceof ConfigurationError ? error.message : 'Server configuration or authentication initialization failed');
  process.exitCode = 1;
});
