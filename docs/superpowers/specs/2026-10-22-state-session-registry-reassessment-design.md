# State, Session, and Registry Reassessment Design

## Goal

Close the architecture-modernization sequence by correcting the confirmed state/configuration
ownership leak and recording evidence-based decisions for `GameRoom`, multiplayer session state,
and each remaining process-wide rule registry. Do not create a room wrapper or per-engine rules
container unless it removes demonstrated coupling in the current product.

## Verified Current State

- `GameRoom` is the serialized authoritative match aggregate. It contains player membership,
  setup/debug snapshots, phase/priority state, cards, choices, effects, combat, and the RPS setup
  phase.
- Sockets, reconnect identity maps, destruction timers, stores, engine instances, and transport
  ports already belong to `RoomRuntime` or focused server modules. They are not serialized into
  `GameRoom`.
- `src/types/game.room.types.ts` imports `SetupConfig` from executable `src/config.ts`, while that
  configuration module imports domain types. This is a real type-ownership inversion.
- `GameRoom` is used throughout the rules engine. A `GameState` rename or nested-state migration
  would affect roughly 85 source files without removing transport resources from the aggregate,
  because those resources are already separate.
- Combat, damage, target-modifier, replacement-operation, and numeric-query extension points use
  process-wide collections. Current production composition does not configure different versions
  of these collections per match; temporary extensions are presently test consumers.
- Numeric queries also validate authored card definitions before a `GameEngine` or room exists, so
  assigning that registry to an engine would conflate schema vocabulary with match runtime state.

## Constraints

- Preserve the serialized `GameRoom`, socket payload, reconnect, persistence, and delta shapes.
- Preserve room creation, joining, RPS setup, debug settings, gameplay, and rules ordering.
- Preserve all built-in combat, damage, targeting, replacement, and numeric behavior.
- Do not rename `GameRoom`, introduce nested `game`/`session` objects, or migrate its engine-wide
  consumers solely for conceptual symmetry.
- Do not add a dependency-injection framework, service locator, universal `RuleSet`, or plugin
  lifecycle.
- Assess registries one at a time. A documented decision to retain a cohesive registry is a valid
  result when no current per-match owner or production variation exists.
- Any registry migration requires a failing isolation test, an explicit construction owner, and a
  materially smaller dependency path than threading a new context through unrelated rules.
- No mechanics, cards, UI behavior, settings, or protocol changes.

## Considered Approaches

### 1. Evidence-led closure — chosen

Move the setup contract into the type layer, enforce that dependency direction, retain the current
serialized aggregate and `RoomRuntime` ownership, and classify every registry independently. Make
no registry migration unless the classification finds a current per-match composition owner and a
real isolation requirement.

This fixes the confirmed defect, records why the larger migrations are not justified, and keeps
future trigger conditions explicit.

### 2. Per-engine rules bundle — rejected for now

Create a `RuleSet` containing combat, damage, targeting, replacement, and numeric registries and
inject it into every `GameEngine`. This would provide theoretical match isolation, but current
handlers and pure planning functions consume those capabilities at different layers, while card
definition validation occurs before an engine exists. Adopting this design now would add broad
plumbing without a production caller that needs distinct rule sets.

### 3. Full `GameState` / `RoomSession` split — rejected

Rename or nest most `GameRoom` fields and introduce a session wrapper. This would change a widely
used serialized contract while leaving the already-separated sockets, timers, identity, store,
and engines in `RoomRuntime`. The migration cost is real; the claimed boundary improvement is not.

## Chosen Design

### Setup contract ownership

Add `src/types/setup-config.types.ts` as the owner of the serializable `SetupConfig` shape.
`src/config.ts`, `GameRoom`, room setup, and other consumers import that type from the type layer.
The executable configuration module continues to own defaults, validation, and snapshot creation.

Add a focused TypeScript-import policy preventing `src/types/**` from importing `src/config.ts`.
The rule protects the corrected dependency direction without pretending that every type-layer
relationship has been redesigned.

This move changes only type ownership. It does not change field names, defaults, validation,
serialized values, or runtime module initialization.

### State and session boundary

Keep `GameRoom` as the authoritative serialized match aggregate. Player IDs and the RPS phase stay
in the aggregate because rules, setup, persistence, reconnect snapshots, and outcomes consume
them as match state.

Keep these process resources outside it under the existing owners:

- `RoomRuntime`: engine map, socket-to-room bindings, destruction timers, runtime dependencies,
  and command/lifecycle coordination;
- reconnect helpers: socket/player identity maps and rejoin decisions;
- `StateStore`: room persistence;
- transport composition: Socket.IO membership and event emission.

No `RoomSession` wrapper is added. Such a wrapper becomes justified only if a later feature needs
one object to own several of these resources across transports or persistence backends and removes
duplicated lifecycle behavior from `RoomRuntime`.

### Registry-by-registry decisions

Each registry receives its own evidence checkpoint and documented conclusion.

#### Combat rules

Retain the current registry unless production composition needs different combat rules for two
simultaneous matches. Flying and trample are built-in engine semantics; current registration is a
test extension seam. A future migration should be owned by match-format construction, not added to
`GameEngine` speculatively.

#### Damage rules

Retain the current registry unless a real match format supplies damage hooks. It has no production
registrations today, so creating and threading a per-engine instance would exist only to support
synthetic tests. Temporary test registrations must always be disposed in `finally` blocks.

#### Target modifiers

Retain built-in action/target permission evaluation where it is. The mutable target-rule set is a
test seam, not the owner of normal Hexproof/Protection/casting permissions. Do not turn the
cohesive shared permission helpers into injectable services. Temporary test rules must be removed
reliably.

#### Replacement operations

Retain operation handlers as process-level code semantics. Room snapshots serialize operation
data and IDs, not functions; all production handlers are built-ins registered during module
initialization. A future plugin system would require an explicit application composition phase and
snapshot compatibility policy before local registries could be meaningful.

#### Numeric queries

Retain one process-level schema vocabulary shared by parser validation and runtime evaluation.
Per-engine ownership is incorrect because catalog normalization can run without a room or engine.
A future extension mechanism must compose the query vocabulary before catalog publication and
freeze it before matches start.

The implementation plan may tighten test cleanup or registry documentation where the audit finds
an actual gap, but it must not manufacture instance wrappers merely to eliminate the word
`static`.

## Data and Control Flow

```text
types/setup-config.types.ts
          ↑
config defaults + validation ──snapshot──> GameRoom.setup (serialized data)
                                              ↑
StateStore / GameEngine / RoomRuntime consume the same aggregate

Socket.IO resources ──> RoomRuntime maps/timers/ports (process-local, never serialized)

catalog validation ──> process-level numeric schema vocabulary
match rules ─────────> existing combat/damage/permission/replacement semantics
```

## Error and Compatibility Behavior

- `snapshotSetupConfig()` retains its validation order and errors.
- Legacy rooms with absent optional setup fields retain their current fallback behavior.
- `GameRoom` JSON and all public server/client payloads remain unchanged.
- Existing registry exports remain compatible unless a focused change is separately justified by
  a failing isolation test.
- Built-in registration order and rule evaluation order remain unchanged.
- Test cleanup changes, if needed, preserve test behavior and only guarantee restoration after an
  assertion or setup failure.

## Verification and Enforcement

- Add an architecture fixture and repository assertion for the `types -> config` prohibition.
- Run focused setup/config, room-factory, room-runtime, reconnect, serialization, and architecture
  tests after moving the type.
- Search production registration call sites and record the owner and lifecycle of each registry.
- Review temporary registration tests for guaranteed cleanup; use `try/finally` where cleanup can
  currently be skipped after a failure.
- If any registry is proposed for migration, first add a test proving cross-match contamination in
  a supported production configuration. Without that evidence, retain it.
- Run the complete non-live and real-socket suites, both typechecks, architecture tests, and the
  production build.
- Obtain independent review of the complete Slice 9 range before reporting completion.

## Success Criteria

- Core type declarations no longer depend on executable configuration.
- The corrected dependency direction is automatically enforced.
- Serialized room, transport, and gameplay behavior remain identical.
- `GameRoom` and `RoomRuntime` responsibilities are explicitly documented with no redundant
  wrapper.
- Every remaining registry has a specific ownership decision, current evidence, and a concrete
  future migration trigger.
- No registry or aggregate migration is performed without a demonstrated current benefit.
- The modernization roadmap closes with all verification gates passing.

## Non-goals

- A `GameRoom` rename or nested state migration.
- Per-engine card schema or numeric-query vocabularies.
- Match-format/plugin/mod support.
- A universal rule context threaded through handlers and planning functions.
- Persistence, event sourcing, hidden-information, authentication, or deployment changes.
- Mechanics, balance, card content, UI, or protocol work.
