# Test Strategy Analysis

**Status:** Current · **Date:** 2026-11-24 · **Commit:** `9310b81` + local test fixes

> What testing methods this repository actually uses, where each one lives, and
> which ones are only planned. Every claim below is backed by a file count or a
> named file. Where a document describes work that does not exist yet, it is
> listed under [Documented but not implemented](#8-documented-but-not-implemented).

Related reading: [`readability-gate.md`](readability-gate.md) (the coverage and
readability gates), [`per-card-testing.md`](per-card-testing.md) (the card
harness), [`architecture-import-policy.md`](architecture-import-policy.md) (the
dependency gate), [`playwright-smoke-testing.md`](playwright-smoke-testing.md)
(manual browser QA), [`../COVERAGE.md`](../COVERAGE.md) (measured coverage).

---

## 1. Headline numbers

Verified by counting the tree; runtime figures are from the last full `npm test`
run on 2026-11-24.

| Measure | Value |
|---|---|
| Test files | 263 |
| Tests passing (last full run) | 4,281 |
| `it` / `test` call sites | 3,215 |
| `describe` blocks | 593 |
| Test source lines | 56,411 |
| Wall-clock (local, power-saving laptop) | 372.94s |
| Exit code | 0 |

| Group | Files | Cases | Describes | Lines | Primary role |
|---|---:|---:|---:|---:|---|
| `tests/engine` | 161 | 2,160 | 402 | 37,628 | Unit — rules engine |
| `tests/server` | 51 | 561 | 90 | 11,437 | Integration + system |
| `tests/client` | 39 | 387 | 78 | 5,961 | Unit + component |
| `tests/library` | 6 | 38 | 8 | 548 | Data-driven + contract |
| `tests/shared` | 4 | 36 | 10 | 469 | Unit — pure functions |
| `tests/architecture` | 2 | 33 | 5 | 368 | Static analysis gate |

Support assets: **133** card-case files in `tests/card-cases/`, **21** helpers in
`tests/helpers/`, **9** fixtures in `tests/fixtures/`.

The shape is a **fat unit base with a thin, high-value integration top** — not a
textbook pyramid. The engine is a pure state machine, so unit tests are cheap and
exhaustive; the server is where concurrency, persistence and transport risk live,
so it gets real sockets and real SQLite rather than mocks.

---

## 2. Unit tests

Everything in `tests/engine/` drives `GameEngine` and its collaborators directly,
in-process, with no I/O and no transport.

| Area | Representative files |
|---|---|
| Reducers / state transitions | `coverage-game-reducer.test.ts` (1,015 lines) |
| Costs and payment | counter-payment, mana payment, `tapForMana` |
| Triggers | discovery, ordering, fallback resolution |
| Combat | 5-step pipeline, blockers, damage assignment (`combat-fixture.ts`) |
| Characteristics / continuous effects | `characteristic-layers.ts` coverage |
| Card groups | `coverage-engine-a-cards.test.ts` (1,136 lines), `nonblue-workbook.test.ts` (1,799 lines) |

`tests/shared/` covers pure functions with no engine dependency:
`runtime-context.test.ts`, `game-logger.test.ts`, `coverage-protocol.test.ts`,
`coverage-browser-session.test.ts`.

**Dominant idiom:** arrange → mutate → read `engine.roomState`. Rooms come from
`createTestRoom()` in `tests/helpers/test-room-factory.ts`. Cards are cloned from
`card.blueprint` before mutation so the shared catalog stays pristine. `tapForMana`
deliberately returns *unapplied* mutations, and tests assert on that contract.

---

## 3. Integration tests

`tests/server/` (51 files) boots the real application rather than mocking it.

| Signal | Files |
|---|---:|
| Real HTTP server via `listen(0)` | 15 |
| Real `socket.io-client` connection | 9 |
| Temp SQLite / `mkdtemp` filesystem | 19 |
| `vi.mock` module isolation | 2 |

These call `createGameApplication()`, bind an ephemeral port, connect real
Socket.IO clients, and assert on emitted events and persisted rows.
`live-routing.test.ts` is 1,809 lines; `coverage-sync-service.test.ts` (1,030 lines)
exercises the delta-sync service against a real SQLite file.

`tests/client/` contributes store-level integration: `deltaReducer` applying
ordered change lists, `loadSavedDecks` pagination against a stubbed `fetch`,
`game-log-storage` round-trips through a stubbed `sessionStorage`.

---

## 4. System / end-to-end tests

The closest thing to E2E without a browser:

| File | Flow |
|---|---|
| `tests/server/live-routing.test.ts` | Full multi-turn match over real sockets, both seats, real persistence |
| `tests/server/auth-acceptance.test.ts` | Sign-in, session, resume |
| `tests/server/deck-acceptance.test.ts` | Build → save → hand off to a room |
| `tests/server/admin-acceptance.test.ts` | Admin scope, account disabling, audit |
| `tests/server/federated-application.test.ts` | Public apps on one origin |
| `tests/server/match-recovery.test.ts` | Recovery after disconnect |
| `tests/server/reconnect.test.ts` | Reconnect resilience |
| `tests/server/browser-navigation.test.ts` | Cross-app navigation |
| `tests/engine/battle-phase-smoke.test.ts` | Combat pipeline smoke |
| `tests/engine/combat-pipeline-smoke.test.ts` | Combat pipeline smoke |

---

## 5. Black-box tests

Tests that assert only on the external contract and never import internals:

| File | Contract pinned |
|---|---|
| `tests/shared/coverage-protocol.test.ts` | Scenario import budget, deck-editor helpers, choice diagnostics |
| `tests/client/view-contract.test.ts` | `PlayerView` shape the client may rely on |
| `tests/library/rule-contract.test.ts` | Zod schema validation of external card JSON |
| `tests/engine/contracted-modifiers.test.ts` | Modifier contract surface |

The three acceptance suites (`auth-`, `deck-`, `admin-acceptance.test.ts`) are
black-box by construction: they drive HTTP routes and socket events only.

---

## 6. White-box tests

**79 `coverage-*.test.ts` files** exist explicitly to reach internal branches.
The naming is honest about intent: `coverage-engine-a-cards`,
`coverage-game-reducer`, `coverage-client-b-modules`, `coverage-sync-service`,
`coverage-browser-session`, and so on.

This is paired with a **99% threshold** on lines, statements, functions and
branches, plus **six `v8 ignore` annotations**, each carrying an inline
justification:

| Location | Reason |
|---|---|
| `characteristic-layers.ts:89` | Unreachable layer guard |
| `game-reducer.ts:160` | Exhaustive switch default |
| `resolution-results.ts:70` | Defensive branch |
| `config/index.ts:19` | Environment-only path |
| `sync-service.ts:200` | Defensive guard |
| `sync-service.ts:376` | Defensive guard |

**The gate is currently red.** Measured 96.80% statements / 96.26% branches /
97.96% functions / 97.68% lines. The 100% baseline recorded in `COVERAGE.md` at
`d62fb1f` (2026-11-09) drifted over 71 commits as untested playtest/scenario and
account-authority modules landed. `COVERAGE.md` records the measured numbers and
the largest gaps; the thresholds were never lowered.

### Coverage instrumentation distorts the socket suites

`npm run test:coverage` is not simply `npm test` plus a report. V8 instrumentation
inflates the heaviest suites enough to change their outcome:

| Run | `live-routing.test.ts` | Full suite |
|---|---|---|
| `npm test` | 50/50 pass, 196s | 4,281 pass, 373s |
| `npm run test:coverage` | 2 failures, 2,727s | 4,279 pass / 2 fail, 2,934s |

Both coverage-run failures are timing artifacts, not regressions: one is
`Test timed out in 60000ms`, the other is a `vi.waitFor` delta-arrival assertion
that expires because the instrumented server is too slow to emit within the
window. Running the file alone without coverage passes 50/50.

Practical consequence: **treat a coverage-run failure in `live-routing.test.ts`
as suspect until reproduced under `npm test`.** The suite is already the slowest
in the repo and the most sensitive to machine load.

### A red run used to produce no report at all

`vitest.config.mts` did not set `reportOnFailure`, which defaults to `false`. A
failing run therefore deleted `coverage/` and wrote nothing — the numbers were
unavailable exactly when needed to tell a coverage gap from an unrelated
regression. This is now set to `true`.


---

## 7. Other methods in use

| Method | Evidence |
|---|---|
| **Table-driven** (`it.each`) | 73 files — the most-used technique after plain `it` |
| **Data-driven** (`import.meta.glob`) | `tests/library/per-card.test.ts` auto-discovers all 133 card-case files (292 authored cases) |
| **Golden-master / hash baseline** | `tests/fixtures/config-baseline.json` — SHA-256 of 5 presets, asserted in `tests/server/configuration.test.ts`. The file also carries `catalogHash` / `cardCount` / `cardIds` for 79 definitions, but no test reads those three fields |
| **Deterministic RNG injection** | 11 files inject `random`; `RuntimeContext` supplies seeded randomness so shuffles reproduce |
| **Fake timers** | 9 files (`vi.useFakeTimers`) for timeouts, reconnect backoff, expiry |
| **Subprocess / CLI testing** | `tests/library/catalog-workflow.test.ts` uses `spawnSync` to run `scripts/sync-card-catalog.mjs` |
| **Static analysis gate** | `tests/architecture/import-boundaries.test.ts` parses the TypeScript AST to forbid import cycles, engine↔transport leakage, and UUID/`Math.random` outside `RuntimeContext` |
| **Ratchet budgets** | `tests/architecture/readability.test.ts` enforces complexity and line budgets that may only decrease |
| **Negative / mutation-style** | Isolated-copy experiments in `docs/card-testing-ui-verification.md` — deliberately break a rule, confirm a test fails |
| **Manual browser QA** | `docs/playwright-smoke-testing.md` (two-tab protocol, React handlers invoked via `__reactProps`), `smoke-test-rps.md`, `smoke-test-battle-phase.md`, `smoke-test-targeting.md`, `test-room-motion-browser-qa.md` |
| **Per-card harness** | `npm run test:cards` — 614 strict checks (161 setup + 292 authored behavior + 161 strict coverage); `--recipe` exports board JSON for Test Room verification |

**Zero snapshot tests.** `toMatchSnapshot` and `toMatchInlineSnapshot` appear in
no test file. This is deliberate: `readability-gate.md` calls a
`renderToStaticMarkup` assertion "a snapshot test wearing a coverage badge", which
is why JSX is excluded from coverage and UI is gated by manual two-tab smoke
instead.

---

## 8. Documented but not implemented

These are plans, not coverage. Do not count them as assurance.

| Item | Document | Actual state |
|---|---|---|
| Security fuzzing | `lab/contracts/fuzzing.md`, `docs/security-lab-plan.md` | Python `python-socketio` fuzzer specified; no runner, no dependencies, `lab/fuzz/` has no code |
| Security case matrix | `lab/campaigns/case-matrix.md` | 11 cases (AUTH-01 … SENSOR-01); the file states *"All rows are planned; no results are asserted"* |
| Playwright automation | `docs/playwright-smoke-testing.md` | Playwright is absent from `package.json`; the doc is a *manual* protocol a human or agent follows |
| Rule-contract baseline | `tests/fixtures/rule-contract-baseline.json` | Referenced only in `docs/rule-contract-architecture.md`; no test consumes it |

---

## 9. Gaps and risks

1. **No property-based testing.** No `fast-check`. The engine is a pure state
   machine with invariants (life totals, zone counts, mana conservation) that
   would suit generators well. This is the largest missed opportunity.
2. **No mutation testing.** No Stryker. The 99% line gate measures execution, not
   assertion strength — and it is currently failing anyway.
3. **No automated browser E2E.** Every UI regression depends on a human or agent
   following a markdown checklist. `readability-gate.md` acknowledges the
   trade-off explicitly.
4. **Coverage gate is red.** 96–98% against a 99% threshold, so `npm run verify`
   fails. Either the threshold or the untested modules need attention.
5. **`apps/game-client/playtest/session.ts` has zero tests** — the largest single
   untested module.
6. **Documentation drift is a recurring risk.** `ARCHITECTURE.md` §11 and
   `COVERAGE.md` both carried stale counts until this analysis corrected them.
   Any number in a document should name the commit it was measured at.

---

## 10. How to run each layer

```sh
npm test                      # full suite, all four projects
npm run test:coverage         # full suite + coverage gate (currently fails)
npm run test:architecture     # import-boundary gate only, single worker
npm run test:cards            # per-card harness
npm run test:cards -- --strict   # fail on missing behavior coverage
npm run verify                # typecheck + coverage + build
```

Vitest projects are declared in `vitest.config.mts` and `vitest.shared.mts`:
`engine` (`tests/{engine,library,shared}`), `server` (`tests/server`), `client`
(`tests/client`), `architecture` (`tests/architecture`). All run under
`environment: 'node'` with `globals: true` and a 20s timeout.
