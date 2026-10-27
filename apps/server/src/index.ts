// Process entry point. HTTP, authentication and socket composition live in application.ts.
import { createGameApplication } from './application';
import { serverLogger } from '@card-game/engine/shared/game-logger';
import path from 'node:path';
import { backupDatabase } from './stores/backup';

const databasePath = process.env.DATABASE_PATH ?? path.join(__dirname, '..', '..', '..', 'data', 'card-game.sqlite');
async function main(): Promise<void> {
  if (process.argv[2] === 'backup') {
    if (process.argv.length !== 4) throw new Error('Provide a new backup destination');
    await backupDatabase(databasePath, process.argv[3]); return;
  }
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid server port');
  const { server, io, ready } = createGameApplication({ databasePath });
  await ready;
  server.listen(port, () => serverLogger.info('server:listening', 'Game server started', { port }));
  const shutdown = () => { io.close(); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
void main().catch(() => {
  serverLogger.error('server:startup:failed', 'Server configuration or authentication initialization failed');
  process.exitCode = 1;
});
