import { defineProject } from 'vitest/config';
import { testAliases, testDefaults, testRoot } from '../../vitest.shared.mts';

export default defineProject({
  root: testRoot,
  resolve: { alias: testAliases },
  test: {
    ...testDefaults,
    name: 'client',
    globals: true,
    environment: 'node',
    include: ['tests/client/**/*.test.ts', 'tests/client/**/*.test.tsx'],
  },
});
