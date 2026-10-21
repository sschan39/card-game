# Deterministic Runtime Dependencies Design

## Goal

Make authoritative room setup and engine execution reproducible by supplying UUID generation and
random values explicitly, without changing production formats, gameplay, serialized state, or
public event contracts.

## Constraints

- Production UUIDs remain UUID v4 and production randomness remains `Math.random`.
- Existing callers may omit dependencies and retain current behavior.
- Runtime dependencies never enter `GameRoom`, snapshots, continuations, deltas, or logs.
- Preserve the existing `StateStore`, `SyncService`, reconnect, action registry, and rules modules.
- Do not add clock injection, a dependency container, global mutable configuration, seeded-RNG
  policy, replay infrastructure, or any gameplay mechanic.
- Client session/command UUID generation and observational timestamps are outside this slice; the
  audit finding concerns authoritative server room/setup/engine identifiers and setup order.

## Chosen Boundary

Add `src/shared/runtime-context.ts`:

```ts
export interface RuntimeContext {
  uuid(): string;
  random(): number;
}

export const defaultRuntimeContext: RuntimeContext = {
  uuid: uuidv4,
  random: Math.random,
};
```

This is a small value object, not a service locator. Owners receive it through constructors or
function parameters. Focused consumers may accept `Pick<RuntimeContext, 'uuid'>` or
`Pick<RuntimeContext, 'random'>` rather than depending on capabilities they do not use.

The existing `EffectContext` remains the effect pipeline's narrow random-only contract and derives
its production default from `defaultRuntimeContext.random`. This avoids renaming a cohesive effect
API merely to fit the broader diagram.

## Dependency Flow

```text
server composition
  → RoomRuntime(runtime context)
      → room and fallback command UUIDs
      → room-factory setup (card UUIDs + shuffle randomness)
      → GameEngine(runtime context)
          → stack / choice / command UUIDs
          → MutationCommitter batch / registration UUIDs
          → effect pipeline randomness
```

`RoomRuntime` merges an optional partial context with production defaults once. It passes the same
resolved context to every engine it creates or recovers and to RPS/deck setup. The existing grace
period positional argument remains compatible; the optional context is the fourth constructor
argument.

## Component Changes

### Card factory

`instantiateCard(cardId, context?)` uses the supplied UUID capability. The one-argument API remains
valid, so the broad test and rules call surface does not need mechanical rewrites.

### Room factory

`setupRPS`, `buildTestDeck`, and `buildStartingCardMutations` accept optional runtime capabilities
and pass them to card construction and Fisher-Yates shuffle. `buildTestDeck` keeps its existing
setup argument and adds context last. Room creation and joining remain deterministic already and do
not receive unused dependencies.

### Game engine and committer

`GameEngine` accepts `Partial<RuntimeContext>` in its existing dependency position. Its current
`{ random }` test callers remain source-compatible. `generateUuid`, implicit command IDs, choice and
stack IDs, trigger IDs, delayed-registration IDs, and batch IDs all draw from the resolved context.
`MutationCommitter` already receives a UUID callback, so its remaining direct UUID call is replaced
with that callback rather than changing its constructor.

### Room runtime

Room IDs and missing command IDs use the resolved context. Engine construction/recovery and RPS or
starting-deck setup receive that same context. Packet-supplied command IDs remain authoritative and
consume no generated value.

## Error and Compatibility Behavior

Injected functions are called synchronously and their return values are used unchanged. This slice
does not validate custom UUID strings or random ranges; production providers retain existing
behavior, while tests are responsible for valid deterministic fixtures. Exceptions propagate as
they do for the current direct calls.

## Tests

- Card construction uses an injected UUID while default construction still produces an identifier.
- Room setup consumes deterministic UUID and random sequences, proving stable RPS/deck identities
  and shuffle order without spying on globals.
- `GameEngine` uses one injected UUID sequence for command, stack/choice, trigger/registration, and
  applied-event batch identity paths that are exercised by focused tests.
- `RoomRuntime` uses injected room/command IDs and forwards the same context into setup and engines;
  caller-supplied command IDs do not consume a generated UUID.
- Existing focused engine/server suites, architecture checks, live Socket.IO tests, typechecks, and
  production build remain green.

## Non-goals

- No deterministic wall clock.
- No persistence or serialization of generator state.
- No replay seed protocol.
- No client UUID refactor.
- No card-catalog immutability work (Slice 8).
- No `GameRoom` or global registry redesign (Slice 9).
