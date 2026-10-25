import { defineConfig } from 'vitest/config';
import path from 'path';

// Workspace vitest config. Tests live in the root tests/ tree and import
// sources from packages/ and apps/ via aliases; no per-package configs yet.
const here = path.dirname(new URL(import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(here, 'packages/engine/src/types'),
      '@engine': path.resolve(here, 'packages/engine/src/engine'),
      '@rules': path.resolve(here, 'packages/engine/src/shared'),
      '@library': path.resolve(here, 'packages/engine/src/library'),
      '@config': path.resolve(here, 'packages/engine/src/config'),
      '@client': path.resolve(here, 'apps/game-client'),
      '@server': path.resolve(here, 'apps/server/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
