import { defineProject } from 'vitest/config';
import { testAliases, testDefaults, testRoot } from '../../vitest.shared.mts';

export default defineProject({
  root: testRoot,
  resolve: { alias: testAliases },
  test: {
    ...testDefaults,
    name: 'architecture',
    globals: true,
    environment: 'node',
    include: ['tests/architecture/**/*.test.ts'],
  },
});
