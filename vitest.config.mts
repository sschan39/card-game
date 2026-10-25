import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'threads',
    maxWorkers: 4,
    projects: [
      { extends: 'packages/engine/vitest.config.mts', root: '.' },
      { extends: 'apps/server/vitest.config.mts', root: '.' },
      { extends: 'apps/game-client/vitest.config.mts', root: '.' },
      { extends: 'tests/architecture/vitest.config.mts', root: '.' },
    ],
  },
});
