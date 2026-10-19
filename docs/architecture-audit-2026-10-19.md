# Architecture audit — 19 October 2026

## Scope and evidence

This audit describes the active TypeScript application at commit `04c85f8` on
`codex/architecture-boundaries`. It was produced from the repository itself, not from the
historical design documents.

Evidence gathered:

- all 145 TypeScript/TSX source files under `src/`;
- all 106 test files and the current 1,329-test regression suite;
- server and client TypeScript projects and the production client build;
- a TypeScript-AST import graph covering 414 runtime-relative edges and 759 total relative
  imports, with type-only edges separated from runtime edges;
- direct searches for reducer use, mutation application, state assignment, nondeterminism,
  server dependencies, global registries, and unused declarations.

Verification at this checkpoint:

- Vitest: 106 files passed, 1,329 tests passed;
- server typecheck: passed;
- client typecheck: passed;
- production server/client build: passed;
- working tree: clean.

The action-registry construction slice had already been applied before this audit. Where useful,
the audit records both the original problem and its completed remediation.

## Current architecture

The repository is already a modular monolith. Its effective layers are:

1. `src/types/` — serialized game contracts, mutations, events, choices, effects, and identifiers.
2. `src/engine/` — reducer, command coordination, rule planners, rule queries, action handlers,
   trigger/effect processing, and setup functions.
3. `src/library/` — declarative card catalog loading and normalization.
4. `src/server/` plus `src/server.ts` — in-memory storage, reconnect identity, synchronization,
   Socket.IO registration, and room lifecycle.
5. `src/shared/` — rule-aware queries and presentation helpers used by engine, server, and client.
6. `src/client/` — Socket.IO client, local projected state, interactions, and React UI.

The authoritative state path is largely consistent:

`player command → GameEngine → action/rule planner → MutationCommitter → reduceGameOperation → events → rules checkpoint → triggers/choices`

`SyncService` replays mutations through the reducer to derive client deltas, but it does not own
authoritative state.

## Cohesive subsystems to preserve

These areas are already separated well enough that changing them merely to match a new directory
diagram would add risk without improving ownership:

- `game-reducer.ts` and the typed `GameMutation`/`OperationOutcome` contracts provide one pure
  authoritative reduction boundary.
- `mutation-committer.ts` owns prepared commits, semantic event derivation, event history, and
  publication. `rules-checkpoint.ts` separately owns repeated SBA/trigger settlement.
- `choice-continuation.ts` already centralizes pending-decision dispatch; there is no evidence for
  replacing it with a generic workflow engine.
- Combat, targeting, costs, state-based actions, triggers, and continuous effects have focused
  planners and substantial direct tests even though they currently share the broad `engine/`
  directory.
- Card behavior remains declarative in `card_data.json`; the code does not implement one class per
  card.
- The engine has no Socket.IO, Express, state-store, or transport imports.

File size alone is not treated as a defect. In particular, `GameEngine` is a high-fan-out
coordinator by design, and `SyncService` has a large but recognizable synchronization
responsibility. Either should be split only at a demonstrated ownership boundary.

## Verified architectural problems

### 1. Three runtime import cycles

The runtime graph contains three strongly connected components. These are real value-import
cycles, not type-only relationships.

1. `card-characteristic-service.ts → characteristic-layers.ts → continuous-effects.ts →
   card-characteristic-service.ts`
   - Layer evaluation imports continuous-effect state helpers.
   - Continuous-entry normalization calls back through the public characteristic facade.
   - Risk: module initialization order is coupled to rules evaluation, and the public facade is
     used from inside its own implementation graph.

2. `game-reducer.ts ↔ damage-service.ts`
   - The reducer delegates `APPLY_DAMAGE_BATCH` to `applyDamageBatch()`.
   - `applyDamageBatch()` imports `gameReducer` to reduce the batch's result mutations.
   - Risk: the authoritative reducer boundary is circular and damage application ownership is
     ambiguous.

3. `effect-resolver.ts ↔ bounded-reveal.ts` and `effect-resolver.ts ↔ resolution-choices.ts`
   - The resolver imports bounded-reveal expansion and choice construction.
   - Both helper modules import effect-building/revalidation helpers back from the resolver.
   - Risk: implementation helpers and orchestration depend on each other, making isolated testing
     and safe extraction harder.

The all-import graph also includes type-only cycles around `GameRoom`, action/choice/event types,
and `GameEngine`/`player-commands`. Those do not create runtime initialization hazards, but the
`GameRoom`/configuration relationship is still an ownership concern described below.

### 2. `src/server.ts` combines transport and multiplayer application ownership

`src/server.ts` is 418 lines and owns all of the following:

- Express/HTTP/Socket.IO bootstrap;
- room storage access;
- the per-room `GameEngine` map and engine disposal/recovery;
- stable-player/socket identity maps;
- room-destruction timers;
- room creation, join, reconnect, and disconnect policy;
- RPS setup and post-RPS starting-state orchestration;
- command execution, persistence, delta publication, and snapshots;
- transport event decoding and response emission.

This is a verified application/transport boundary problem, not a complaint about file length.
Transport callbacks directly coordinate store, engine, lifecycle, timers, synchronization, and
setup rules. These operations cannot be tested as one application service without starting the
actual Socket.IO boundary.

The completed action-registry slice removed the server's concrete rule-handler imports, so that
part of the original coupling is resolved.

### 3. Several directories do not yet represent dependable dependency layers

Concrete runtime edges include:

- `src/library/card-factory.ts → src/engine/zone-transitions.ts`;
- `src/library/card-parser.ts → src/engine/numeric-definitions.ts`;
- five `src/shared/` rule helpers → `src/engine/card-characteristic-service.ts`;
- client state/components → engine characteristic queries and `ability-effects.ts`;
- `src/server/sync-service.ts → src/engine/game-reducer.ts`.

Some of these interactions are legitimate, but the directory names imply a lower-level layer that
the import graph does not support. In particular, `shared/` is not a dependency-free core module;
it contains rule-aware code. Moving files before clarifying public APIs would only disguise these
edges.

### 4. `GameRoom` combines rules state and room/session metadata

`GameRoom` appears in 343 source locations across 83 files. It contains both gameplay state and:

- `roomId` and player membership slots;
- setup/debug snapshots;
- high-level waiting/RPS/playing status;
- RPS mini-game state.

It does **not** contain sockets, timers, stores, or transport instances, so the engine is already
independent of networking. A wholesale `GameState` migration would touch most rule modules and is
not justified yet. The immediate problem is that multiplayer application code also treats the
same object as its room-session aggregate.

There is also a type-direction leak: `game.room.types.ts` imports `SetupConfig` from the executable
root `config.ts`, while `config.ts` imports domain card/debug types. This is type-only at runtime,
but core state contracts should not be owned by an application configuration module.

### 5. Mutable process-wide rule extension registries remain

The action registry is now immutable and engine-owned, but the following extension points are
still process-wide mutable state:

- `CombatRuleRegistry`;
- `DamageRuleRegistry`;
- `ModifierRegistry`;
- replacement-operation handlers;
- numeric-query handlers.

Tests register and unregister synthetic behavior. A failed test before cleanup can pollute later
tests, and independently configured matches cannot coexist. These registries should not all be
converted at once: each needs a concrete construction owner and consumers before migration.

### 6. Deterministic context is incomplete

The effect pipeline accepts an injected random function, but nondeterminism is still created in
multiple modules:

- `room-factory.ts` shuffles with `Math.random()`;
- `card-factory.ts` creates instance UUIDs directly;
- `GameEngine` creates command/stack/choice UUIDs directly;
- `MutationCommitter` creates batch UUIDs directly.

The same state and command therefore do not fully determine identifiers or setup order. This is a
verified limitation, but migrating identifiers and setup randomness must preserve serialized
contracts and test fixtures, so it belongs in a dedicated slice.

### 7. Card catalog boundaries are only conventionally immutable

`card-factory.ts` keeps a process-wide blueprint cache and returns shared blueprint objects.
`CardInstance` stores that same reference. Existing documentation warns tests to clone before
editing, which confirms that immutability is discipline rather than an enforced contract.

The content layer also imports engine implementation utilities for card state creation and numeric
definition validation. This makes the nominal card-content layer depend on the rules
implementation rather than a narrow schema/contract API.

### 8. Setup state changes bypass the normal mutation path by design

Direct `GameRoom`/card assignment searches found authoritative direct mutation only in
`room-factory.ts` setup operations (`joinRoom`, RPS setup, deck/hand construction). Normal player
actions and rule processing use mutations.

Setup being a separate boundary is reasonable, but `server.ts` currently mutates a room and then
rebuilds/re-reads the engine to avoid stale immutable references. A multiplayer session owner can
make this lifecycle explicit before deciding whether setup itself should become mutation-driven.

### 9. Small confirmed cleanup debt

Strict unused-declaration checks report eight server/engine items and three client items, including
an obsolete reducer helper and unused imports/locals. These are real but low-value cleanup items;
they should be removed alongside related ownership work rather than mixed into every architecture
commit.

## Suspected issues that require evidence before refactoring

- `GameEngine` has 20 runtime outgoing dependencies and a broad public API. Its central
  coordination role explains much of that fan-out. Further extraction is justified only when a
  responsibility can be owned and tested independently without duplicating the checkpoint order.
- `SyncService` combines delta derivation, audience filtering, emission, replay, and file logging.
  These may become separate concerns under durable persistence or private views, but neither is in
  scope here and current tests cover the service as a synchronization unit.
- The single `engine/` directory is crowded, but moving files into `game/rules/*` before removing
  cycles and defining entry points would create churn without stronger boundaries.
- Splitting `GameRoom` into `GameState`, `GameSession`, and `RoomSession` may become valuable after
  multiplayer lifecycle extraction. It is not currently worth an 83-file migration.

## Existing behavior and constraints

- No gameplay mechanic, card balance, UI behavior, or multiplayer event contract may change.
- Security, authentication, hidden-information hardening, and database infrastructure remain out
  of scope.
- Historical plans/specifications are evidence, not current dependency truth; they should not all
  be rewritten when implementation changes.
- Every architecture slice must remain independently reviewable and repeat the relevant tests,
  typechecks, build, static boundary checks, and full regression suite before handoff.

## Recommended order

1. Remove the reducer/damage runtime cycle without changing damage semantics.
2. Remove the resolver/helper cycles.
3. Remove the characteristic/continuous-effect cycle.
4. Add an automated import-cycle and forbidden-layer boundary test once the graph is clean.
5. Extract a multiplayer room runtime/application service from `server.ts`; leave Socket.IO
   callbacks as decoding/emission adapters.
6. Introduce an explicit deterministic runtime context for IDs/randomness.
7. Clarify card-content validation/state-construction APIs and enforce catalog immutability.
8. Reassess `GameRoom` separation and remaining global rule registries using the new application
   boundary as evidence.

This sequence favors small dependency improvements over a wholesale directory reorganization.

