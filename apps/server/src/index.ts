// Process entry point. HTTP, authentication and socket composition live in application.ts.
import { createGameApplication } from './application';
import { serverLogger } from '@card-game/engine/shared/game-logger';
import path from 'node:path';
import { backupDatabase } from './stores/backup';
import { exportIdentityMigration } from './stores/sqlite-store';
import { loadServerConfig, ConfigurationError } from './config';

/** How long a shutdown may take before the process is forced down. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === 'export-accounts') {
    if (process.argv.length !== 5) throw new ConfigurationError('Usage: export-accounts SOURCE_SNAPSHOT NEW_PRIVATE_OUTPUT');
    try {
      const count = exportIdentityMigration(process.argv[3], process.argv[4]);
      serverLogger.info('accounts:exported', 'Wrote offline account export', { count });
    } catch (error) {
      if (error instanceof ConfigurationError) throw error;
      throw new ConfigurationError('Account export failed. Check the source snapshot and use a new private output file.');
    }
    return;
  }
  const environment = mode === '--lab' ? { ...process.env, NODE_ENV:'development', FRONTEND_MODE:'built', CONFIG_FILE:process.env.CONFIG_FILE ?? path.resolve(__dirname,'../../../deploy/profiles/scenario-lab.example.json') } : mode === '--vite' ? { ...process.env, FRONTEND_MODE: 'vite' } : process.env;
  const config = loadServerConfig(environment), root = path.resolve(__dirname, '..', '..', '..');
  if (mode === '--lab' && (config.navigation.purpose !== 'lab' || !config.lab.enabled || !config.inspectionEnabled)) throw new ConfigurationError('Lab startup requires explicit lab identity, scenarios and inspection.');
  const databasePath = path.resolve(root, config.storage.databasePath);
  if (mode === 'backup') {
    if (process.argv.length !== 4) throw new Error('Provide a new backup destination');
    await backupDatabase(databasePath, process.argv[3]); return;
  }
  const { port, host } = config.http;
  const { server, io, ready } = createGameApplication({ databasePath, auditPath: path.resolve(root, config.logging.auditPath), effectiveConfig: config });
  await ready;
  server.listen(port, host, () => serverLogger.info('server:listening', 'Game server started', { port, host }));
  /* A drain that never finishes is worse than a fast exit: systemd would wait out
     TimeoutStopSec and SIGKILL the process, which is exactly when a WAL is left
     half-written. The timer is unref'd so it cannot hold the process open by
     itself, and it is cleared as soon as the sockets are gone. */
  const shutdown = (signal: string) => {
    serverLogger.info('server:shutdown', 'Draining connections', { signal });
    const force = setTimeout(() => {
      serverLogger.error('server:shutdown:timeout', 'Forcing exit after drain timeout', { signal });
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();
    io.close(() => { clearTimeout(force); process.exit(0); });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}
/* Node's default for an unhandled rejection is to warn and keep running, which
   leaves the process serving traffic in an unknown state. Both handlers log and
   exit non-zero so a supervisor restarts a known-good process instead. */
process.on('unhandledRejection', reason => {
  serverLogger.error('server:unhandled-rejection', 'Unhandled promise rejection', { error: reason instanceof Error ? reason.message : String(reason), stack: reason instanceof Error ? reason.stack : undefined });
  process.exit(1);
});
process.on('uncaughtException', error => {
  serverLogger.error('server:uncaught-exception', 'Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});
void main().catch(error => {
  serverLogger.error('server:startup:failed', error instanceof ConfigurationError ? error.message : 'Server configuration or authentication initialization failed');
  process.exitCode = 1;
});
