# Committed operation outcomes implementation plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task in the existing checkout. Steps use checkbox syntax for tracking.

**Goal:** Preserve successful semantic operations even when room state stays equal, using one validated reduction path.

**Architecture:** The authoritative reducer exposes an explicit outcome; its state-only projection remains `gameReducer`. Legacy state-changing mutations retain derived event ownership. A semantic operation supplies its own semantic events; generic mutation/batch identity is still assigned centrally. A typed explicit shuffle permutation is the first real consumer, proving empty/one-card success without dummy state.

**Tech Stack:** TypeScript, Vitest, existing Socket.IO sync and JSONL timeline.

## Global constraints

- Owner approved the structural solution on 12 October 2026.
- Work in `codex/milestone-0` in the existing checkout, as previously chosen.
- Engine first; no named-card behavior, catalog additions or new client components.
- Preserve pure preview/replay, actual committed event publication, checkpoint order and terminal immutability.
- New settings, if needed, belong in `src/config.ts`; this change needs none.
- Do not migrate all legacy invalid-input reasons in this task. Legacy equal-state setters/invalid attempts keep their no-event behavior. Explicit semantic operations distinguish rejection from success.
- No shuffle-specific equality bypass, artificial counter or event emitted by a planner.

## Task 1 — Outcome boundary and explicit shuffle consumer

**Files:**

- Create `src/types/operation-outcome.types.ts`: typed rejected/unchanged/committed outcomes. Optional event list distinguishes reducer-owned semantics from existing derivation.
- Create `src/shared/state-value.ts`: shared equality utility, re-exported from applied-events for existing consumers.
- Create `src/engine/library-operations.ts`: validate complete exact-reference library permutations and apply a shuffle outcome.
- Modify `src/types/game-mutation.types.ts`: `SHUFFLE_LIBRARY` with player and explicit UUID/revision permutation.
- Modify `src/types/game-event.types.ts`: `LIBRARY_SHUFFLED` payload with player identity.
- Modify `src/engine/game-reducer.ts`: expose `reduceGameOperation`; keep `gameReducer` as its state projection; one reduction/postprocessing implementation.
- Modify `src/engine/applied-events.ts`: applied steps may carry owned semantic events; append those once after generic mutation metadata, otherwise preserve current derivation.
- Modify `src/engine/game-engine.ts`: retain steps by committed status; never infer semantic success from equality.
- Modify `src/server/sync-service.ts`: explicit deck mapping for a changed shuffle; successful equal-state shuffle produces only timeline data.
- Create `tests/engine/operation-outcomes.test.ts`: actual behavioral regressions and replay.

**Interfaces:**

```typescript
type OperationOutcome =
  | { status: 'rejected'; state: GameRoom; reason: string }
  | { status: 'unchanged'; state: GameRoom }
  | { status: 'committed'; state: GameRoom; events?: EventDraft[] };

// events omitted: existing deriveAppliedEvents owns semantics.
// events present (even []): the operation owns its semantic events.
function reduceGameOperation(state: GameRoom, mutation: GameMutation): OperationOutcome;
function gameReducer(state: GameRoom, mutation: GameMutation): GameRoom;
// New mutation:
// { type: 'SHUFFLE_LIBRARY'; playerId: string;
//   order: { cardUuid: string; zoneRevision: number }[] }
```

- [x] Write and run red regressions against the current engine. Empty shuffle must produce one `LIBRARY_SHUFFLED`; same-order shuffle preserves state identities; changed order follows the exact permutation; invalid permutations reject without partial changes.

```typescript
const room = createTestRoom();
const engine = new GameEngine(room);
engine.applyMutations([{ type: 'SHUFFLE_LIBRARY', playerId: 'player1', order: [] }]);
expect(engine.drainEventBatches().flatMap(b => b.events)
  .filter(e => e.eventId === 'LIBRARY_SHUFFLED')).toHaveLength(1);
```

Run: `node node_modules/vitest/vitest.mjs run tests/engine/operation-outcomes.test.ts`. Expected current failure: no shuffle event, rather than fixture/import errors.

- [x] Add the discriminated outcome and explicit shuffle payload. Validate existing player, exact total length, no duplicate identities, library zone/owner, and revision. No randomness occurs in reduction.
- [x] Move existing reducer postprocessing into `reduceGameOperation`; `gameReducer` returns its `.state`. Normalize legacy equal results as unchanged; return original state for unchanged semantic success. Terminal room returns rejected.
- [x] Retain committed steps in `GameEngine`, carrying optional operation events. `deriveAppliedEvents` emits generic `MUTATION_APPLIED`, then owned events and skips legacy semantic derivation for that step.
- [x] Nested damage-result event derivation must also use the outcome boundary, so semantic operations inside results are not lost or emitted twice.
- [x] Add explicit sync mapping and extend tests to JSONL/state-only replay, changed/unchanged deltas, terminal rejection, legacy redundant assignments and paused/reconstructed replacement transactions.
- [x] Run the targeted engine, event, replacement and sync tests; expected exit 0.

## Task 2 — Finish the real library effect path

Use an injected randomness dependency at the effect/engine boundary. A pure Fisher–Yates planner records an explicit permutation before reduction. Pending continuations keep prepared permutations, so resuming never rerolls an already planned shuffle.

**Files:** create `src/engine/effect-context.ts`; modify `effect-registry.ts`, `effect-resolver.ts`, `action-service.ts`, `game-engine.ts`, `trigger-manager.ts`, `turn-history.ts`, `src/types/card.types.ts` and `tests/server/live-routing.test.ts`. The runtime context passes through ordinary and resumed resolution; event and trigger contracts remain canonical.

- [x] Inspect effect execution/reconstruction call sites and document the exact dependency propagation before edits.
- [x] Write red tests for the generic SHUFFLE effect on empty and populated decks, shuffle-trigger discovery, injected deterministic order and sequential effects drawing from the shuffled top.
- [x] Add planner/dependency propagation and generic effect handler. Do not put random functions in room snapshots or continuations.
- [x] Extend canonical trigger mapping/history using `ON_SHUFFLE` and `LIBRARY_SHUFFLED`; reuse current controller filtering and scheduling.
- [x] Add an actual-server synthetic spell scenario proving ordinary socket casting, one shuffle event/trigger, both clients and reconnect. No named cards or catalog changes.
- [x] Run targeted engine and actual-server tests; expected exit 0.

## Review and verification

- [x] Independent read-only review of outcome/event ownership and continuation exactly-once behavior.
- [x] Full Vitest suite, both typechecks and production build pass after all code changes. Invoke bundled Node directly for Vitest/TypeScript/Vite: this runtime has no `npm.cmd`; the production sequence is the same as the package scripts.
- [x] Update `docs/development/8.1-committed-operation-outcomes.md`, `8.1-zones-and-library.md`, the development index and the roadmap with actual contracts/scenarios. Do not declare full 8.1 complete: ordered movement, reveal and cross-zone access remain separate slices.
- [x] Validate development-document links/source paths and `git diff --check`.
- [x] Commit locally. No push without explicit authorization.

Future slices remain in the 8.1 working document. This plan does not replace the full roadmap objective.
