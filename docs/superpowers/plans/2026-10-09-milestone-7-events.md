# Milestone 7 implementation plan

> For agentic workers: use executing-plans for inline implementation with review checkpoints. Track evidence with checkboxes below.

**Goal:** Complete replacement/prevention, semantic removal, damage consumers and remaining state-based actions from Milestone 7.

**Architecture:** A pure proposed-event planner precedes reducer commits. Serializable choices retain transaction progress and resolution continuation. The rules checkpoint settles simultaneous state-based batches before trigger scheduling.

**Tech Stack:** TypeScript, existing immutable reducer, Vitest, Socket.IO and existing choice/delta UI.

## Global constraints

- Engine first; no named-card content or catalog additions.
- Existing checkout/branch, stable UUID/zoneRevision, centralized configuration if needed.
- Manual combat allocation and existing choice components.
- Entire roadmap scope remains required; M8 actions/catalog are separate.
- Local commit and completion report; no push requested.

## Task 1: Pure event processing and persisted decisions

Files: create `src/types/proposed-event.types.ts`, `src/engine/proposed-events.ts`, `src/engine/replacement-rules.ts`, `tests/engine/proposed-events.test.ts`; modify choice/room/mutation types as needed.

Interfaces: `planProposedMutations(room, mutations, options?)` returns `{ mutations, pendingChoice? }`; `resumeProposedChoice(room, choice, answer)` returns the same result. A serializable `ProposedTransaction` carries completed mutations, remaining mutations, current event frames and per-lineage applied rule IDs. Choice continuation type is `replacement`.

- [x] Write and run failing tests for selected order, self precedence, lineage tracking, redirection re-evaluation, shared finite shields and JSON round-trip resume.
- [x] Implement typed proposals, serializable operation definitions and registered operation handlers.
- [x] Implement pure transaction preview and pause/resume without partial authoritative mutation.
- [x] Run focused tests and typecheck; record evidence.

Test command: bundled Node running `node_modules/vitest/vitest.mjs run tests/engine/proposed-events.test.ts`. Expected first run fails because the module is absent, final run passes all scenarios.

## Task 2: Engine, resolution, combat and costs

Files: `src/engine/game-engine.ts`, `src/engine/effect-resolver.ts`, `src/engine/action-costs.ts`, `src/engine/damage-service.ts`, `src/server/sync-service.ts`; create `tests/engine/replacement-transactions.test.ts`.

Interfaces: Task 1's planner processes each resolving effect before preview; replacement continuation optionally contains a `ResolutionContinuation`. Engine answers retain command transaction tails and suppress priority while decisions remain.

- [x] Write/run red tests for cost-plus-stack atomicity, combat completion tail, sequential resolution dynamic state and engine reconstruction.
- [x] Route gameplay mutations through the event planner and keep processed primitives from re-entering it.
- [x] Resume resolution only after the paused effect's transaction finishes, then settle the checkpoint.
- [x] Map new room and registration state to deltas and verify snapshot/replay parity.
- [x] Run targeted existing choice, damage, cost, checkpoint and resolution suites.

## Task 3: Removal semantics and damage adapters

Files: `src/engine/effect-registry.ts`, `src/engine/damage-service.ts`, new `src/engine/damage-keywords.ts`, card/player/mutation types and reducer; tests `tests/engine/removal-damage-rules.test.ts`.

Interfaces: `DESTROY_CARD` and `SACRIFICE_CARD` preserve incarnation references before lowering; generic registered operations create shields. Final damage batches carry effective source information and keyword consequences.

- [x] Write/run red fixtures for indestructible, regeneration, sacrifice, protection, lifelink/deathtouch, infect/wither and loyalty/defense damage.
- [x] Add minimal state foundations and reducer operations, source-aware duration/expiry, generic registration effects.
- [x] Move damage consequences after actual replacement/prevention and preserve simultaneous lifelink.
- [x] Run damage/removal tests plus existing combat suites.

## Task 4: Full state-based batches

Files: `src/engine/state-based-actions.ts`, `src/engine/rules-checkpoint.ts`, types/reducer/sync as needed; tests `tests/engine/state-based-extended.test.ts`.

Interfaces: SBA planner returns mutations and optional persisted choice; choice continuation collects decisions without early moves. All resulting mutations use the same proposed-event processing with a simultaneous source snapshot.

- [x] Write/run red fixtures for each roadmap family: toughness/lethal/deathtouch, token cessation, attachments, legends/world, loyalty/defense, opposing counters, poison/failed draws and simultaneous losses.
- [x] Implement batch planning, persisted choices and convergence before triggers/priority.
- [x] Verify destruction-prevention cases make progress without looping; zero toughness bypasses destruction protection.
- [x] Run checkpoint, trigger, identity and extended SBA suites.

## Task 5: Integration evidence, review and completion

Files: `tests/server/live-routing.test.ts`, `tests/server/sync-service.test.ts`, `docs/proposed-events-engine.md`, `docs/project-audit/milestone-7-completion.md`, roadmap.

- [x] Add actual-server replacement choice/order, reconnect and subsequent action scenarios; verify both clients match the server.
- [x] Audit generic event logging and delta replay for every new state field and mutation family.
- [x] Request read-only code review, address concrete findings and add regression fixtures.
- [x] Run full Vitest suite, both TypeScript checks and production build; inspect results.
- [x] Audit each roadmap requirement and gate against source/runtime evidence, update docs and all completed checkboxes.
- [x] Commit final implementation locally, inspect clean status, mark the goal complete and report results.

Verification: bundled Node runs `node_modules/vitest/vitest.mjs run`; `node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`; same for `src/client/tsconfig.json`; bundled npm CLI runs `run build`. Expected: all tests pass, no type errors, successful production build.
