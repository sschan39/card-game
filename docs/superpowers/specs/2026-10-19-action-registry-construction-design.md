# Explicit Action Registry Construction Design

**Date:** 2026-10-19
**Status:** Approved for implementation

## Scope

This is the first incremental architecture-modernization slice. It removes the
process-wide mutable action-handler registry and moves handler ownership to each
`GameEngine` instance. It does not change action validation, proposal, stack
resolution, mutation ordering, rules checkpoints, card behavior, or transport
event contracts.

## Verified Problem

`src/engine/action-registry.ts` exports a mutable `ActionRegistry` object and a
`registerAction` function that mutate process-global state. `ActionService`
reads that object directly. `src/server.ts` imports every concrete handler and
registers them during application startup.

This creates three concrete maintenance problems:

- Engine behavior depends on application initialization order.
- Multiple engines in the same process cannot safely use different handler
  sets.
- Tests must clear, snapshot, and restore global state, which introduces
  cross-test coupling and obscures each fixture's actual dependencies.

The existing `ActionHandler` contract, immutable reducer, mutation committer,
rules checkpoint, and handler implementations are cohesive and remain in place.

## Considered Approaches

### Compatibility wrapper around the global registry

Passing a copied handler map into new engines while retaining the mutable
global would reduce production coupling but leave two construction paths and
allow tests or future code to continue depending on hidden state.

### Per-engine registry with a default factory

Create an `ActionRegistry` value object, inject it into `GameEngine` and
`ActionService`, and centralize the built-in handler list in
`createDefaultActionRegistry()`. This directly removes hidden state while
preserving the current handler interface and command pipeline.

### Larger application composition refactor

Moving room lifecycle, engine construction, transport registration, and player
commands into a new application layer at once would reach a cleaner end state
sooner, but would mix several independent boundaries into one difficult-to-
review change.

## Decision

Use a per-engine `ActionRegistry` and a `createDefaultActionRegistry()` factory.
This is the smallest complete change that makes action dependencies explicit.

## Architecture

`ActionRegistry` owns an immutable-at-construction copy of a handler map and
exposes `get()` and `has()` queries. It may expose `with()` to derive a new
registry for focused tests or add-on actions without mutating an existing
engine.

`createDefaultActionRegistry()` owns the built-in mapping from action IDs to
concrete handlers. It is engine setup code, not transport setup code. The
server imports the engine factory rather than importing rule handlers.

`createGameEngine(room, options?)` constructs a `GameEngine` with the default
registry unless a caller supplies a registry explicitly. Direct
`new GameEngine(...)` construction remains supported and receives the same
default registry, preserving the public API used by existing consumers.

`ActionService` receives a registry instance and performs all handler lookup
through it. `GameEngine.readyCommandError()` uses the same instance, ensuring
validation and execution cannot observe different registries.

## Data Flow

1. Application code constructs an engine from a room.
2. The engine owns one registry instance for its lifetime.
3. A player command is validated against that registry.
4. `ActionService` retrieves the same handler instance and runs the existing
   validate/propose flow.
5. Existing mutation, checkpoint, trigger, and resolution processing continues
   unchanged.

## Error Handling

Unknown actions retain the existing structured validation failure and warning.
The factory is complete for the closed built-in action-ID set, so omissions are
compile-time errors. Custom test/add-on actions use an explicitly derived or
constructed registry.

## Testing

- Add a focused registry test for lookup and immutable derivation.
- Add an engine-level regression test proving two engines with different
  registries do not affect one another.
- Migrate tests away from global clear/register/restore setup.
- Preserve all existing gameplay tests without weakening assertions.
- Run server and client typechecks, the full Vitest suite, and the production
  build after the migration.

## Non-Goals

- Reorganizing all rule modules.
- Refactoring `GameEngine` continuation logic.
- Changing `GameRoom` state shape.
- Changing gameplay, card definitions, or action payloads.
- Introducing a dependency-injection framework or generic plugin system.
