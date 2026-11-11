import path from 'node:path';

// Keep root-scoped tests and every app/package on the same source modules.
export const testRoot = import.meta.dirname;

// Vitest defaults to a 5000ms per-test timeout, which is too tight for the
// engine suite under load (the full engine run takes ~143s across 164 files).
// Every project spreads these so a slow machine cannot fail a correct test.
export const testDefaults = {
  testTimeout: 20000,
  hookTimeout: 20000,
};
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
  '@admin': path.join(testRoot, 'apps/admin'),
  '@builder': path.join(testRoot, 'apps/deck-builder'),
  '@card-game/ui': path.join(testRoot, 'packages/ui/src'),
  '@card-game/browser-session': path.join(testRoot, 'packages/browser-session/src'),
};
