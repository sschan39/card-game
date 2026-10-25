import { defineProject } from 'vitest/config';
import { testAliases, testRoot } from '../../vitest.shared.mts';

export default defineProject({
  root: testRoot,
  resolve: { alias: testAliases },
  test: {
    name: 'architecture',
    globals: true,
    environment: 'node',
    include: ['tests/architecture/**/*.test.ts'],
  },
});
