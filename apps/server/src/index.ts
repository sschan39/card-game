// Process entry point. HTTP, authentication and socket composition live in application.ts.
import { createGameApplication } from './application';
import { serverLogger } from '@card-game/engine/shared/game-logger';

const application = createGameApplication();
const { app, server, io, ready } = application;
const port = process.env.PORT ?? 3000;
void ready.then(() => server.listen(port, () => {
  serverLogger.info('server:listening', 'Game server started', { port: Number(port) });
})).catch(() => {
  serverLogger.error('server:startup:failed', 'Server configuration or authentication initialization failed');
  process.exitCode = 1;
});
export { app, server, io };
