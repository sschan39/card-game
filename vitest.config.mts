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
      // Write the report even when a test fails. Without this, a red run wipes
      // `coverage/` and produces nothing — which is precisely the moment the
      // numbers are needed to decide whether the failure is a coverage gap or
      // an unrelated regression.
      reportOnFailure: true,
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
      //
      // Measured 2026-11-24 (267 files, 9 with no executable statements):
      //   statements 96.80, branches 96.26, functions 97.96, lines 97.68.
      // The 2026-11-09 baseline has drifted: 71 commits added playtest/scenario
      // and account-authority modules without matching tests. The gate is
      // therefore red and `npm run verify` fails. See COVERAGE.md for the
      // largest gaps. Do not lower these numbers to make the build pass.
      thresholds: {
        lines: 99,
        statements: 99,
        functions: 99,
        branches: 99,
      },
    },
  },
});
