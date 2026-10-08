# Milestone 4 engine implementation plan

> Execute inline with the executing-plans workflow, one testable slice at a time.

**Goal:** reach all Milestone 4 engine requirements and finish with an evidence-based report.

**Architecture:** retain read-only discovery and authoritative checkpoint scheduling. Use serializable declarative definitions and room-owned choices/history. No client or catalog work.

**Tech stack:** TypeScript, pure game reducer, existing Vitest and actual source-server Socket.IO harness.

## 4.1 Precise matching

- [x] Add `TriggerFilter` to card types and `triggerMatches(event, source, filter)` in `src/engine/trigger-matching.ts`.
- [x] Write `tests/engine/trigger-matching.test.ts` proving self versus another, controller/type filters, revision identity and legacy entry isolation; run red.
- [x] Integrate matching into `discoverTriggers`; preserve departure witness snapshots; copy trigger definitions during normalization.
- [x] Run focused tests and update incompatible broad-scan expectations to explicit watcher definitions.

## 4.2 Canonical events

- [x] Extend GameEventPayloads/TriggerEvent and connect committed cast/draw/discard/gain/loss/block/combat damage events.
- [x] Tag draw/discard MOVE_CARD mutations with semantic reason; ordinary movement does not imply either.
- [x] Add minimal exile storage to zone movement/references/delta replay; test bounce/exile and noncreature death exclusion.
- [x] Run focused typed event, reducer, sync and trigger tests.

## 4.3 Checkpoint scheduler

- [x] Add room-owned trigger queue, reducer/sync operations and a trigger choice continuation.
- [x] Implement active/nonactive grouping, per-controller ordering and shared mode/target/distribution planning.
- [x] Add red tests for mixed controllers, selected ordering, targeted/mode triggers, impossible targets and serialized pending decisions.
- [x] Integrate queue scheduling into checkpoint without granting priority during outstanding requests; run checkpoint/choice/server regressions.

## 4.4 Event-based conditions and resolution

- [x] Add serializable RuleCondition comparison/all/any/not definitions and evaluator with event/source/controller/history context.
- [x] Check intervening conditions at discovery and resolution; expand dynamic parameter access to event fields/snapshots.
- [x] Test event amount, departed subject information, condition becoming false and optional effects with resumed resolution.

## 4.5 Delayed triggers and turn history

- [x] Add serializable delayed registrations, reducer/sync operations and delayed event matching; test one-shot and source departure/recovery.
- [x] Add event-derived current-turn history and keyed trigger/activation use limits, resetting on actual turn advancement.
- [x] Test delayed end-step resolution, once-per-turn activation/trigger limits and history predicates.

## Final integration and report

- [x] Extend the actual-server harness with synthetic fixtures for scheduling/reconnect, event routing and delayed/limited triggers.
- [x] Run `vitest run`, server/client typechecks and production build; independently review important engine changes.
- [x] Audit every Milestone 4 roadmap requirement; record concrete source/scenario evidence and engine-only scope in a report.
- [x] Commit verified slices on the existing branch; finish the goal only after complete evidence.
