# Architecture modernization roadmap — 19 October 2026

This roadmap converts the findings in
[`architecture-audit-2026-10-19.md`](architecture-audit-2026-10-19.md) into reviewable,
behavior-preserving slices. It is a sequencing guide, not permission to redesign working rules.
Each implementation slice receives its own design and execution plan before code changes.

## Dependency direction

The intended direction is:

`transport → multiplayer application → engine coordination → rules/core contracts`

`client → shared projections/contracts`

`card catalog/normalization → core card/effect schema`

Rules may depend on another rule module's explicit query or planning API where the game semantics
require it. They must not depend on Socket.IO, room storage, or transport registration.

## Completed foundation

### Slice 1 — explicit action-registry construction

Status: complete and independently reviewed.

- Replaced the global mutable action registry with an immutable per-engine registry.
- Added compiler-checked default action composition.
- Removed concrete action-handler imports from server startup.
- Migrated tests to local registry customization.
- Updated architecture and action-ID documentation.
- Verification: 1,329 tests, both typechecks, and production build pass.

## Planned slices

### ✅ Slice 2 — damage/reducer ownership

Goal: remove the `game-reducer.ts ↔ damage-service.ts` runtime cycle while preserving atomic damage
application, replacement results, semantic outcomes, and checkpoint timing.

Preferred boundary: damage services plan and validate assignments; the reducer owns applying the
result mutations. Do not create a second reducer or expose partial damage state.

Completed: `reduceDamageBatch()` now belongs to `game-reducer.ts`, and damage planning no longer
imports the reducer.

### ✅ Slice 3 — resolution helper ownership

Goal: remove the resolver cycles with `bounded-reveal.ts` and `resolution-choices.ts`.

Preferred boundary: move shared effect-building/revalidation primitives into a lower-level
resolution-planning module used by all three. Keep `effect-resolver.ts` as the orchestration entry
point and preserve effect order, fizzle rules, pending choices, and continuation payloads.

Completed: the three shared primitives now belong to `resolution-planning.ts`; both helper modules
depend downward on it, and `effect-resolver.ts` preserves its existing public facade exports.

### ✅ Slice 4 — characteristic evaluation ownership

Goal: remove the characteristic-service/layer/continuous-effect runtime cycle.

Preferred boundary: separate read-only continuous-effect state/scoping helpers from entry
normalization. Layer evaluation must not call back through its own public facade.

Completed: room-card enumeration, source lookup, and lifetime checks now belong to
`continuous-effect-state.ts`; layer evaluation depends directly on that module and
`effect-scopes.ts`. Entry normalization and the existing compatibility exports remain in
`continuous-effects.ts`, and the runtime import graph is acyclic.

### ✅ Slice 5 — automated architecture checks

Goal: enforce the clean dependency graph in tests.

Checks should cover:

- no runtime import cycles;
- no engine imports from multiplayer/transport;
- no transport imports from concrete rule handlers;
- documented exceptions for client rule queries until a shared projection API replaces them.

Use the TypeScript AST so `import type` relationships are not falsely reported as runtime cycles.

Completed: a tracked import-graph helper and Vitest policy gate now enforce all four checks. The
client exceptions are exact rather than open-ended, diagnostics use deterministic repository
paths, and `npm run test:architecture` provides a focused command without adding a dependency or
changing production code.

### ✅ Slice 6 — multiplayer room runtime

Goal: separate application lifecycle from Socket.IO registration.

A focused room runtime/application service should own the store, per-room engines, engine
replacement/disposal, room creation/join, grace timers, command execution, persistence, and sync
requests. Socket handlers should decode events, call that API, and emit returned messages.

Do not change event names/payloads, reconnect policy, security behavior, or RPS/game setup.

Completed: `RoomRuntime` owns the store reference, per-room engines, identity bindings, grace
timers, room lifecycle, options, command/RPS coordination, persistence, and delta requests.
`server.ts` now contains only Express/Socket.IO composition, payload decoding, socket-room
membership, and exact event emission. Narrow delta-publication and room-destruction ports preserve
the existing `SyncService`, reconnect module, store, event contracts, and lifecycle policy. A
focused architecture rule prevents the transport entry point from importing engine modules.

### ✅ Slice 7 — deterministic runtime dependencies

Goal: make identifiers and randomness explicit without changing their external formats.

Introduce the smallest context that can supply UUIDs and random values to room/card setup,
GameEngine, and commit batching. Production defaults remain UUID v4 and `Math.random`; tests can
provide deterministic sources.

Completed: `RuntimeContext` supplies UUID and random capabilities to card/room setup,
`RoomRuntime`, `GameEngine`, and commit batching. One resolved context flows through each room's
authoritative setup and engine lifecycle; it is never serialized. Production defaults remain UUID
v4 and `Math.random`, existing callers remain compatible, and a focused architecture check guards
against direct provider access in those consumers. Clocks, client IDs, replay seeds, and generator
state persistence remain out of scope.

### ✅ Slice 8 — card-content boundary

Goal: keep catalog loading/normalization independent from engine implementation files and enforce
blueprint immutability.

Move only stable schema validation/state-construction contracts. Preserve JSON card definitions,
normalization behavior, cached lookup performance, and existing authoring documentation.

Completed: `card-catalog.ts` owns lazy raw-data loading, normalization, and one recursively frozen
cached blueprint per card ID; `card-factory.ts` preserves its public lookup and instance API. Pure
card-state, numeric-value, action-cost, mana, and effect-scope contracts moved below the engine,
and card-definition validation moved into the library. Engine algorithms and the shared numeric
query-registry instance remain intact. A focused architecture rule rejects runtime and type-only
library imports into engine implementation files, while fixture tests replace whole blueprints
instead of mutating shared catalog definitions. Card JSON, normalization, serialized state,
mechanics, and registry ownership did not change.

### Slice 9 — reassess state/session separation and global rule registries

After the multiplayer boundary exists, measure whether a narrow `RoomSession` wrapper removes real
coupling without forcing an 83-file `GameRoom` migration. Migrate process-wide combat/damage/
modifier/replacement registries only when an explicit per-match construction owner is available.

## Per-slice quality gate

Every slice must:

1. add or adjust targeted tests before implementation where behavior could regress;
2. avoid mechanics, card, UI, and protocol changes;
3. pass focused tests, server/client typechecks, and production build;
4. pass the complete Vitest suite before handoff;
5. run import-boundary/static searches relevant to the slice;
6. update current architecture documentation;
7. be committed separately and reviewed for Critical/Important findings.

## Deliberately deferred

- wholesale `src/game/rules/*` relocation;
- a dependency-injection framework;
- a generic workflow engine for pending choices;
- persistence/database/event-sourcing infrastructure;
- security or hidden-information changes;
- microservices or deployment redesign;
- file-count or line-count targets.

