# Engine cleanup

18 October 2026. Implements the cleanup discussed in findings A–D. Continue in the current feature checkout and preserve previous uncommitted card work. No commit, push or repository cleanup requested.

## Design

Keep GameEngine as the public API and checkpoint/phase coordinator. Extract prepared mutation commits and their event/history publication into a room-local MutationCommitter; extract pending-choice dispatch into a focused function using existing rules planners. Neither component routes general player commands. Keep packet/member/debug checks at the command boundary and retain terminal/checkpoint guards on directly callable rules operations.

For completed action choices, prepare and validate against current state before consuming the request. Propose once, then commit choice clearing and the proposed action together; do not re-enter network validation or reopen the same preparation. Invalid completions retain the pending request and pay nothing. A shared ready-command check preserves status, timing and debug policy.

Replace private bus spies with public committed-event batches, and snapshot/restore the action registry around this test file. Avoid adding a per-engine registry framework. Before removing the server JSON clone, exercise representative commands with deeply frozen previous room snapshots and compare deltas from retained references against cloned baselines. Include setup, casting/payment, action and resolution choices, trigger/death, replacement, combat and turn progression. Keep only focused tests that assert observable outcomes.

## Execution

- [x] 1. Update event-contract tests and isolate their registry fixtures; run engine tests alone and with shuffled order.
- [x] 2. Add command/old-state and delta equivalence coverage; demonstrate repeated completed-action validation with a failing regression.
- [x] 3. Extract mutation committing and choice dispatch; consolidate completed-action preparation, retaining rejection and checkpoint semantics.
- [x] 4. Remove the server serialization clone only after retained-state checks pass.
- [x] 5. Run focused and full serial tests, both typechecks, production build, diff check and independent read-only review. Record evidence and any remaining limitations.

## Alternatives considered

Keeping everything in GameEngine leaves the identified ownership problem. A new universal command/continuation orchestration layer adds overhead and obscures existing planners. The selected two extractions give each component a concrete responsibility and retain existing extension points.

## Ownership and invariants

- `mutation-committer.ts` owns the current committed room and batches, proposal decisions, reducer commits, event/history publication and departing-source retention. It does not advance phases, execute commands or run checkpoints.
- `choice-continuation.ts` checks ownership, request identity and answers, then delegates to existing state-based, replacement, combat, trigger and resolution planners. Its host callbacks commit the results and restore priority using the latest room. Action announcement completion stays with GameEngine.
- `GameEngine` retains command routing, the shared ready-command policy, checkpoint sequencing and phase/priority progression. Lower-level rules methods still stop during terminal/pending rules states. No network guard is moved into the commit component.
- The server retains `engine.roomState` before an action. Production snapshots are not frozen: addon planners/handlers must continue obeying the existing pure-mutation contract. The tests deeply freeze prior snapshots to catch violations without adding runtime overhead or a new state-control layer.

## Verification evidence

- Before the production change, the completed mode-choice test observed **two** handler validation calls instead of one. Its rejection case already preserved the request and paid nothing. All other baseline frozen-room/delta cases passed before removing the clone.
- After extraction and consolidation, **70 tests passed in six focused files** covering pending choices, applied-event history, replacement transactions and combat damage. Expanded cleanup and original engine tests also passed in shuffled order: **22 tests**, seed `18102026`.
- The first full run passed 1,206 cases and exposed six failures in the state-machine fixture, which replaced the private event bus after engine construction. That fixture now collects public batches and disposes each temporary engine; all **62 tests** across state-machine, original engine and cleanup files pass in shuffled order with the same seed. The assertions and gameplay behavior were retained.
- The eight cleanup scenarios cover one-time validation/payment, invalid completion, action/resolution choices and cleanup, action payment paused for replacement, state-based legend choice, RPS setup/dealing, replacement ordering and combat/death-trigger resolution. Every checked operation retains a deeply frozen old room and compares its resulting sync changes with those from the old JSON-clone baseline.
- Final full serial regression: **89 files, 1,212 tests passed**, including real-server/two-client combat, card effects and sync flows using retained old room references.
- Server TypeScript build, client TypeScript check, production Vite build and final diff whitespace check passed. Independent read-only review found no actionable issues in the production cleanup, the frozen-room tests or the corrected state-machine fixture. No new game mechanics, configuration settings or registry-injection framework were introduced; previous uncommitted card work is preserved. Changes remain uncommitted.
