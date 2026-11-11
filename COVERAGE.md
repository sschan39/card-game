# Test coverage

The Vitest coverage scope is fully covered:

| Metric | Covered / total | Percentage |
| --- | ---: | ---: |
| Statements | 10,146 / 10,146 | 100% |
| Branches | 10,486 / 10,486 | 100% |
| Functions | 2,252 / 2,252 | 100% |
| Lines | 7,903 / 7,903 | 100% |

The suite reports **245 test files / 3,458 passing tests**. No file with executable
code is below 100%; eight files are type-only or re-export barrels and therefore
have `0/0` executable statements.

## Reproduce

```powershell
npm.cmd run verify
```

`verify` runs the typecheck, the coverage suite and the production build, so CI
enforces all four `100` thresholds in `vitest.config.mts`. The HTML report is
written to `coverage/index.html`.

## What was added

The coverage work added 79 test files (1,292 tests) under `tests/`:

- `tests/engine/` — reducer and mutation commit paths, action/legal-action
  validation, effect registry and resolver, replacement and trigger handling,
  combat, costs, resolution choices/payments, card parser and rule contracts.
- `tests/server/` — real HTTP and Socket.IO flows, auth/session lifecycle,
  browser/admin routes, rooms, reconnect and auto-pass, deck store/service,
  scenarios and SQLite persistence, projection/view building.
- `tests/client/` — game store and delta reducer, targeting drafts, auth/session,
  React hooks, deck pagination, log storage, density planning and socket events.
- `tests/shared/` — protocol scenarios/editors/diagnostics and browser sessions.

No existing test was weakened or removed, and no coverage exclusion was added.

## Unreachable defensive branches

The first revision of this work annotated 117 defensive branches. Review found
that most of those guards were dead code, not unreachable necessities, so they
were deleted along with their unreachable fallbacks. Six annotations remain,
each with an inline proof of why the branch cannot be entered through the public
APIs with valid state:

- `packages/engine/src/engine/game-reducer.ts` — terminal-room guard; the
  reducer rejects terminal rooms before dispatch.
- `apps/server/src/config/index.ts` — checked-in `auth.json` guard; the asset
  always satisfies the schema unless the asset itself is edited.
- `packages/engine/src/engine/characteristic-layers.ts` — default `effect`
  group for counter rules that do not author a group.
- `packages/engine/src/engine/resolution-results.ts` — arrived-incarnation
  lookup for a `MOVE_CARD` result; the mutation always stamps a numeric
  revision on arrival.
- `apps/server/src/rooms/sync-service.ts` — replacement-pool comparison on the
  generic mutation path; planned damage results never rewrite the pool.
- `apps/server/src/rooms/sync-service.ts` — exhaustive mutation-union default;
  an unknown mutation never reaches the mapper.

The audit also drove three behaviour-equivalent refactors:

- `apps/game-client/auth-state.ts` — the private guest request helper no longer
  accepts an unused token.
- `packages/protocol/src/scenarios/scenario.ts` — `utf8Size` derives the code
  point once instead of four times.
- `packages/engine/src/engine/legal-actions.ts` — allocation defaults for incomplete
  runtime choices stay explicit (`?? 0`) and have direct unit tests; the 32-option
  search cap is exercised by the many-holder counter-payment regression test.
