import path from 'node:path';

// Keep root-scoped tests and every app/package on the same source modules.
export const testRoot = import.meta.dirname;
export const testAliases = {
  '@card-game/protocol': path.join(testRoot, 'packages/protocol/src'),
  '@card-game/engine': path.join(testRoot, 'packages/engine/src'),
  '@shared': path.join(testRoot, 'packages/engine/src/types'),
  '@engine': path.join(testRoot, 'packages/engine/src/engine'),
  '@rules': path.join(testRoot, 'packages/engine/src/shared'),
  '@library': path.join(testRoot, 'packages/engine/src/library'),
  '@config': path.join(testRoot, 'packages/engine/src/config'),
  '@client': path.join(testRoot, 'apps/game-client'),
  '@server': path.join(testRoot, 'apps/server/src'),
};
