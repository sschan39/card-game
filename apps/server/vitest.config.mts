import { defineProject } from 'vitest/config';
import { testAliases, testRoot } from '../../vitest.shared.mts';

export default defineProject({
  root: testRoot,
  resolve: { alias: testAliases },
  test: {
    name: 'server',
    globals: true,
    environment: 'node',
    include: ['tests/server/**/*.test.ts'],
  },
});
