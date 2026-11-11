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
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      // Scope: every module that carries logic worth asserting on.
      //
      // Deliberately excluded:
      // - `**/*.tsx` — React components are covered by the two-tab smoke test
      //   (docs/playwright-smoke-testing.md), not by coverage. Under
      //   `environment: 'node'` a component test can only assert on a rendered
      //   HTML string, so a high number there measures snapshot churn rather
      //   than behaviour. See docs/readability-gate.md for the measurements.
      // - `**/types/**` — type-only modules compile to nothing.
      // - `numeric-values.ts` — a one-line re-export shim.
      include: [
        'packages/engine/src/**/*.ts',
        'packages/protocol/src/**/*.ts',
        'packages/ui/src/**/*.ts',
        'packages/browser-session/src/**/*.ts',
        'apps/server/src/**/*.ts',
        'apps/game-client/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.tsx',
        '**/*.d.ts',
        '**/types/**',
        'packages/engine/src/engine/numeric-values.ts',
      ],
      // Ratchet: measured on the current tree, then frozen one point below the
      // measurement so ordinary noise cannot fail the build. Raise these as
      // coverage improves; never lower them. A lower threshold means the gate
      // was weakened, which is the failure mode this block exists to prevent.
      //
      // Measured 2026-11-09 over the scope above (235 files):
      //   lines 100, statements 100, functions 100, branches 100.
      thresholds: {
        lines: 100,
        statements: 100,
        functions: 100,
        branches: 100,
      },
    },
  },
});
