# Test coverage

Measured 2026-11-24 on `main` with `npm run test:coverage`:

| Metric | Covered / total | Percentage |
| --- | ---: | ---: |
| Statements | 12,760 / 13,181 | 96.80% |
| Branches | 12,999 / 13,504 | 96.26% |
| Functions | 2,740 / 2,797 | 97.96% |
| Lines | 10,105 / 10,344 | 97.68% |

The suite reports **264 test files / 4,287 passing tests**. All tests pass; the
command still exits `1` because the four metrics sit below the `99` thresholds in
`vitest.config.mts`.

## Status: the 100% baseline has drifted

`d62fb1f` (2026-11-09) recorded 100% on all four metrics. Seventy-one commits
have landed since, and the coverage gate has not been re-satisfied. The
thresholds were never lowered — the run is genuinely red.

267 files are in the configured scope. Nine are type-only or re-export barrels
with `0/0` executable statements; **78 files are below 100%**.

### Largest gaps

| File | Missing statements | Missing branches | Missing functions | Missing lines |
| --- | ---: | ---: | ---: | ---: |
| `apps/game-client/playtest/session.ts` | 121 | 80 | 24 | 90 |
| `packages/engine/src/engine/playtest-edit.ts` | 95 | 123 | 8 | 66 |
| `apps/server/src/application.ts` | 39 | 46 | 8 | 17 |
| `apps/server/src/scenarios/service.ts` | 25 | 30 | 4 | 17 |
| `apps/server/src/auth/service.ts` | 18 | 24 | 1 | 5 |
| `apps/server/src/auth/accounts-authority.ts` | 13 | 17 | 0 | 5 |
| `apps/server/src/index.ts` | 9 | 5 | 0 | 7 |
| `apps/server/src/rooms/room-runtime.ts` | 7 | 10 | 0 | 1 |
| `apps/server/src/scenarios/playtest-run.ts` | 7 | 9 | 0 | 0 |
| `apps/game-client/socket.ts` | 6 | 13 | 2 | 4 |

`apps/game-client/playtest/session.ts` has no test at all (`0/121`
statements). The playtest/scenario and 4A account-authority modules
(`bdfa27c`, `5759262`, `76e9e6f`) are the bulk of the drift; the remaining
files are small branch gaps of one to four lines each.

## Reproduce

```powershell
npm.cmd run test:coverage
```

The HTML report is written to `coverage/index.html`; the machine-readable
totals are in `coverage/coverage-summary.json`. `npm run verify` additionally
runs the typecheck and the production build, and fails at the coverage step
until the thresholds are met.

## Unreachable defensive branches

Six `v8 ignore` annotations remain, each with an inline proof of why the branch
cannot be entered through the public APIs with valid state:

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

## History

- `d62fb1f` (2026-11-09) — added 79 test files (1,292 tests) and reached 100%
  on all four metrics; thresholds ratcheted to 100.
- `7847f8a` (2026-11-11) — thresholds lowered to 99 to match the comment above
  them, which had always claimed one point of headroom.
- `2300125` (2026-11-23) — the 100% claim in this file was found to be stale;
  the gate had been red for some time.
- `9310b81` (2026-11-24) — measured 96.80 / 96.26 / 97.96 / 97.68 over 267
  files; 78 files below 100%.
