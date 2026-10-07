# Applied Events Implementation Plan

> **For agentic workers:** Execute inline with test-first regression checks and a final code review.

**Goal:** Make game events describe applied changes and connect their causes to existing debug logs.

**Architecture:** Shared types define events and recorded batches. A pure derivation module translates applied mutations into semantic events. The engine owns publication; synchronization stores batch metadata and events with delta patches. GameLogger remains event-agnostic through injectable sinks and contextual child loggers.

**Tech Stack:** TypeScript, Vitest, existing Socket.IO/JSONL.

## Constraints

- Use the existing feature branch and centralized `src/config.ts`.
- Preserve current trigger/priority coordination; defer targeting and persistence restoration.
- Commit completed 1.2 first; leave 1.3 reviewable in the checkout.

## Steps

- [x] Add regression tests in `tests/engine/applied-events.test.ts`: damage 2→5 reports 3, clearing damage emits no damage event, batch listeners see final state, invalid commands publish no batches, simultaneous departures share the initial room, resolution planning is silent.
- [x] Add `src/types/game-event.types.ts` for `GameEventPayloads`, typed applied events, recorded batch metadata, runtime before/after refs and resolution reports. Add pure `src/engine/applied-events.ts` derivation. Publish through `GameEngine.applyMutations` after each complete batch; expose `drainEventBatches()`.
- [x] Remove planning emissions from StateMachine, ActionService, effect resolver and TriggerManager. Pass resolution reports to the apply boundary; derive departure/entry, damage/life, combat, phase/turn/priority, stack and generic mutation events there. Carry trigger event IDs into queued stack objects and use batch before-state for departure discovery.
- [x] Add sink/context tests in `tests/shared/game-logger.test.ts`, then implement `LoggerOptions.sinks`, `withContext()` and generic event logging. Keep console event verbosity in `src/config.ts`.
- [x] Add batch JSONL round-trip and indexed insertion tests, then extend `StateDelta`/SyncService and wire server batch draining. Keep detailed event records server-side when filtering player deltas. Make array `add` insert while `update` replaces.
- [x] Update tests that previously asserted speculative events to exercise the engine publication boundary. Document event extension and logging in `docs/logging.md`.
- [x] Address review regression: generate starting cards on fresh data in `room-factory.ts`, apply `SET_PLAYER_ZONES` through the reducer, and map both zone replacements in SyncService. In live routing tests, capture RPS batch snapshots at publication and confirm setup does not modify them.
- [x] Run targeted regressions, all Vitest tests, both typechecks and build; request read-only review and address material findings.

Verification commands use the bundled Node executable with `node_modules/vitest/vitest.mjs run`, `node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`, `node_modules/typescript/bin/tsc --noEmit -p src/client/tsconfig.json`, and npm's `build` script.

Result: 499 tests in 40 files pass; server/client typechecks and production build pass. Independent review found the mutable RPS setup reference issue; its live regression was reproduced, fixed with immutable setup mutations, and accepted on re-review. Changes remain uncommitted after base `b2968b7`.
