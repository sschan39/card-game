# Software Design Principles in This Project

**Status:** Current · **Date:** 2026-10-28

> This document catalogues the software design principles that are **actually implemented** in this
> repository, with a pointer to the source that demonstrates each one. It is descriptive, not
> aspirational: every entry cites code that exists today.
>
> Related reading: [`../ARCHITECTURE.md`](../ARCHITECTURE.md) (per-type reference),
> [`MAP.md`](MAP.md) (where things live), [`architecture-import-policy.md`](architecture-import-policy.md)
> (enforced dependency rules).

---

## How to read this document

Each principle has three parts:

| Part | Meaning |
|---|---|
| **How** | The concrete mechanism used in this codebase |
| **Why** | The problem it solves here — not a textbook justification |
| **Source** | `path:line` plus a short excerpt |

Paths are repository-relative. `engine/` means `packages/engine/src/engine/`, `server/` means
`apps/server/src/`, `client/` means `apps/game-client/`.

---

## Index

| # | Principle | Category | Primary source |
|---|---|---|---|
| 1 | Single Source of Truth | Data | `engine/game-reducer.ts:105` |
| 2 | Immutability & Structural Sharing | Data | `engine/game-reducer.ts:2` |
| 3 | Pure Functions / Referential Transparency | Data | `engine/action-costs.ts:22` |
| 4 | Command Pattern (data as instructions) | Data | `types/game-mutation.types.ts:15` |
| 5 | Derived State over Duplicated State | Data | `engine/applied-events.ts:23` |
| 6 | Explicit Result Types over Exceptions | Data | `types/operation-outcome.types.ts:5` |
| 7 | Single Responsibility Principle | SOLID | `engine/mutation-committer.ts:14` |
| 8 | Open/Closed Principle | SOLID | `engine/action-registry.ts:70` |
| 9 | Liskov Substitution Principle | SOLID | `server/rooms/state-store.ts:7` |
| 10 | Interface Segregation Principle | SOLID | `engine/trigger-manager.ts:52` |
| 11 | Dependency Inversion Principle | SOLID | `engine/effect-context.ts:4` |
| 12 | Facade | Architecture | `engine/game-engine.ts:39` |
| 13 | Layered Architecture | Architecture | `docs/architecture-import-policy.md` |
| 14 | Ports & Adapters (Hexagonal) | Architecture | `server/rooms/room-runtime.ts:40` |
| 15 | Composition Root | Architecture | `server/application.ts:49` |
| 16 | Separation of Planning from Applying | Architecture | `engine/action-costs.ts:22` |
| 17 | Observer / Publish–Subscribe | Behavioral | `engine/event-bus.ts:17` |
| 18 | Strategy / Table-Driven Dispatch | Behavioral | `engine/effect-registry.ts:18` |
| 19 | Plugin Registry with Disposal | Behavioral | `engine/combat-rules.ts:60` |
| 20 | Interceptor (pre-commit replacement) | Behavioral | `engine/proposed-events.ts:219` |
| 21 | Fixed-Point Iteration | Behavioral | `engine/rules-checkpoint.ts:14` |
| 22 | Snapshot / Last-Known Information | Behavioral | `engine/source-information.ts:6` |
| 23 | Optimistic Concurrency via Revisions | Behavioral | `engine/library-operations.ts:7` |
| 24 | Fail-Fast Validation | Robustness | `library/card-definition-validator.ts:14` |
| 25 | Validate-Then-Mutate | Robustness | `engine/zone-transitions.ts:32` |
| 26 | Defensive Copying | Robustness | `engine/config/index.ts:32` |
| 27 | Idempotency | Robustness | `engine/action-service.ts:54` |
| 28 | Least Privilege / Information Hiding | Security | `server/projection/reveal-policy.ts:8` |
| 29 | Opaque Capability Handles | Security | `server/projection/wire-identifiers.ts:7` |
| 30 | Default-Deny Allowlisting | Security | `server/projection/action-options.ts:5` |
| 31 | Prototype-Pollution Defence | Security | `shared/rule-path.ts:1` |
| 32 | Data-Only Rules (no `eval`) | Security | `shared/rule-path.ts:5` |
| 33 | Backpressure & Resource Limits | Security | `server/auth/service.ts:25` |
| 34 | Structured Logging with Injectable Sinks | Observability | `shared/game-logger.ts:52` |
| 35 | Externalized, Layered Configuration | Configuration | `server/config/index.ts:25` |
| 36 | Memoization with Scoped Lifetime | Performance | `engine/card-characteristic-service.ts:13` |
| 37 | Path-Based Incremental Updates | Performance | `client/store/deltaReducer.ts:4` |
| 38 | Referential Stability in Selectors | Performance | `client/components/Battlefield.tsx:6` |
| 39 | Architecture as Executable Tests | Verification | `tests/architecture/import-boundaries.test.ts:30` |
| 40 | Deterministic Time/Random Injection | Verification | `shared/runtime-context.ts:4` |

---

# Part 1 — Data principles

## 1. Single Source of Truth

**How.** Exactly one function is allowed to produce authoritative game state:
`reduceGameOperation` (which delegates the per-mutation work to `reduceMutation`). Everything else —
handlers, state machine, effect registry, trigger manager — returns `GameMutation[]` and never
touches `GameRoom`. `gameReducer` is a thin state-only projection of the same function.

**Why.** With one writer, "how did the board get into this state?" has exactly one answer, and the
before/after diff used for events and deltas is guaranteed to be complete. It also makes replay and
preview possible: `preview()` in `action-costs.ts` runs the same reducer on a throwaway room.

**Source.** `packages/engine/src/engine/game-reducer.ts:105`

```ts
export function gameReducer(state: GameRoom, mutation: GameMutation): GameRoom {
  return reduceGameOperation(state, mutation).state;
}
```

---

## 2. Immutability & Structural Sharing

**How.** The reducer returns a **new** `GameRoom`, copying only the path that changed and sharing
untouched subtrees by reference. Card blueprints are recursively frozen at load time.

**Why.** Immutability makes the before/after diff cheap and correct (`before !== after` is a valid
change signal), lets `sameStateValue` short-circuit on reference equality, and prevents a handler
from accidentally mutating state it was only supposed to read.

**Source.** `packages/engine/src/engine/game-reducer.ts:2` and
`packages/engine/src/library/card-catalog.ts:8`

```ts
// game-reducer.ts
// Pure reducer: (state, mutation) => newState.
// Returns a new GameRoom with shallow copies along the changed path.
// Untouched subtrees are shared by reference.
```

```ts
// card-catalog.ts
function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}
```

---

## 3. Pure Functions / Referential Transparency

**How.** Rule logic is written as pure planners: `planActionCosts`, `planDamage`,
`planTriggerScheduling`, `planStateBasedActions`, `planStackResolution`, `planProposedMutations`.
They take a room snapshot and return mutations; they never commit.

**Why.** Pure planners are trivially unit-testable without a server, socket, or clock, and they can
be run speculatively (cost preview, legality checks) without side effects.

**Source.** `packages/engine/src/engine/action-costs.ts:22`

```ts
/** Plan payment without events, checkpoints or mutation of authoritative state. */
export function planActionCosts(room: GameRoom, playerId: PlayerId, source: CardInstance, cost: ActionCost = {}, ...): CostPlan {
```

---

## 4. Command Pattern — state changes as data

**How.** Every state change is a value in a discriminated union, `GameMutation`. Handlers emit them;
the reducer interprets them.

**Why.** Because mutations are data, they can be logged, replayed, diffed, filtered per player, and
validated before application. It also gives exhaustive `switch` checking: adding a mutation type
forces every consumer to handle it.

**Source.** `packages/engine/src/types/game-mutation.types.ts:15`

```ts
/**
 * Discriminated union of atomic state mutations for the pure game reducer.
 *
 * Handlers produce GameMutation[] instead of mutating GameRoom directly.
 * The engine sequences each mutation through gameReducer(state, mutation) => newState.
 */
export type GameMutation =
  | { type: 'SHUFFLE_LIBRARY'; playerId: PlayerId; order: LibraryCardReference[] }
  | { type: 'MOVE_CARD'; cardUuid: string; playerId: PlayerId; from: CardZone; to: CardZone; ... }
```

---

## 5. Derived State over Duplicated State

**How.** Handlers never emit events. After a batch commits, `deriveAppliedEvents` computes canonical
events from the before/after state diff. Triggers are then discovered from those events.

**Why.** Hand-emitted events drift from reality the moment a handler forgets one. Deriving them means
the event stream is *by construction* consistent with state, and adding a new event requires no
changes to any handler.

**Source.** `packages/engine/src/engine/applied-events.ts:23`

```ts
/** Pure derivation. New semantic events belong here; logging needs no event-specific cases. */
export function deriveAppliedEvents(batchBefore: GameRoom, batchAfter: GameRoom, steps: AppliedMutation[], ...): EventDraft[] {
```

The rule is stated explicitly in `docs/MAP.md`:

> *state changes are mutations; events are derived from state changes; triggers are discovered from
> events.* Nothing hand-emits events.

---

## 6. Explicit Result Types over Exceptions

**How.** Operations return discriminated unions instead of throwing: `OperationOutcome`
(`rejected` / `unchanged` / `committed`), `ActionResult`, `ConnectResult`, `JoinRoomResult`,
`CostPlan`.

**Why.** Rejections are normal in a rules engine (illegal action, stale target, game over). Modelling
them as values keeps the happy path linear, makes every failure case visible to the type checker, and
avoids using exceptions for control flow.

**Source.** `packages/engine/src/types/operation-outcome.types.ts:5`

```ts
/** Pure reduction result. Semantic success does not require a state difference. */
export type OperationOutcome =
  | { status: 'rejected'; state: GameRoom; reason: string }
  | { status: 'unchanged'; state: GameRoom }
  | { status: 'committed'; state: GameRoom; events?: EventDraft[] };
```

---

# Part 2 — SOLID

## 7. Single Responsibility Principle

**How.** Each collaborator owns one verb. `MutationCommitter` commits and publishes.
`StateMachine` plans phase/priority steps. `SyncService` builds and broadcasts deltas.
`OptionService` computes available actions. `ActionService` routes actions. `GameEngine` sequences.

**Why.** The commit path is the most delicate code in the system (replacement effects, event
derivation, history recording, trigger discovery). Isolating it means a change to delta broadcasting
cannot break event derivation.

**Source.** `packages/engine/src/engine/mutation-committer.ts:14`

```ts
/** Commits one transaction and publishes its events/history. Never runs checkpoints or commands. */
export class MutationCommitter {
```

The negative half of the contract is documented per concept in `docs/MAP.md`'s *Must NOT do* column.

---

## 8. Open/Closed Principle

**How.** `ActionRegistry` is immutable: `with()` returns a **new** registry rather than mutating the
existing one. New actions are added by supplying a handler, not by editing a `switch`. The same
pattern appears in `CombatRuleRegistry`, `DamageRuleRegistry`, and `ModifierRegistry`.

**Why.** Tests and future content can extend behaviour without editing the default registry, and the
default registry cannot be corrupted by a caller.

**Source.** `packages/engine/src/engine/action-registry.ts:55`

```ts
export class ActionRegistry {
  private readonly handlers: ReadonlyMap<ActionType, ActionHandler>;

  constructor(handlers: ActionHandlerMap = {}) {
    this.handlers = new Map(Object.entries(handlers));
  }

  with(type: ActionType, handler: ActionHandler): ActionRegistry {
    return new ActionRegistry(Object.fromEntries([...this.handlers, [type, handler]]));
  }
}
```

---

## 9. Liskov Substitution Principle

**How.** `InMemoryStore` and `SqliteStore` both satisfy `ServerStateStore`; `InMemoryDeckStore` and
`SqliteStore` both satisfy `DeckRepository`. Callers depend only on the interface, so swapping the
implementation changes nothing above it.

**Why.** Tests run against in-memory stores with no filesystem; production runs against SQLite. The
same code path is exercised in both, so a test failure is a real failure.

**Source.** `apps/server/src/rooms/state-store.ts:7`

```ts
export interface StateStore {
  getRoom(roomId: string): GameRoom | undefined;
  saveRoom(room: GameRoom): void;
  deleteRoom(roomId: string): void;
  listRooms(): string[];
}

export interface ServerStateStore extends StateStore { readonly auth: AccountRepository; ... }

export class InMemoryStore implements ServerStateStore { ... }
```

`SqliteStore` implements three narrow interfaces at once — see `apps/server/src/stores/sqlite-store.ts:17`.

---

## 10. Interface Segregation Principle

**How.** Consumers receive the narrowest possible view. `TriggerManager` gets a `TriggerContext`
(room id + battlefield), not the whole `GameRoom`. `EffectContext` is `Pick<RuntimeContext, 'random'>`
— effects cannot generate UUIDs. `answerPendingChoice` receives a `ChoiceHost` with exactly the
callbacks it needs.

**Why.** A narrow parameter is a narrow blast radius: an effect handler physically cannot reach the
socket layer, the clock, or the UUID generator, so it cannot accidentally couple to them.

**Source.** `packages/engine/src/engine/trigger-manager.ts:52`

```ts
/**
 * Narrow, read-only view of game state that trigger discovery needs.
 * Deliberately not the whole GameRoom — discovery only enumerates the
 * battlefield and needs the room id for event emission downstream.
 */
export interface TriggerContext {
  room?: GameRoom;
  roomId: string;
  battlefield: CardInstance[];
}
```

```ts
// packages/engine/src/engine/effect-context.ts:4
/** Effect dependencies never enter room snapshots or serialized continuations. */
export type EffectContext = Pick<RuntimeContext, 'random'>;
```

---

## 11. Dependency Inversion Principle

**How.** Non-determinism (UUIDs, randomness) is an injected capability, not a global import.
`RuntimeContext` is resolved at the engine boundary and threaded down. Architecture tests *forbid*
`uuid` and `Math.random` in the authoritative consumers.

**Why.** Deterministic tests need deterministic IDs and shuffles. Inverting the dependency makes the
engine reproducible without monkey-patching globals, and keeps non-serializable capabilities out of
`GameRoom`.

**Source.** `packages/engine/src/shared/runtime-context.ts:4`

```ts
/** Runtime capabilities are process-local and never enter serialized game state. */
export interface RuntimeContext {
  uuid(): string;
  random(): number;
}

export const defaultRuntimeContext: RuntimeContext = { uuid: uuidv4, random: Math.random };
```

Enforced by rule 6 in `docs/architecture-import-policy.md`:

> Authoritative runtime consumers (`card-factory.ts`, `room-factory.ts`, `game-engine.ts`,
> `mutation-committer.ts`, `room-runtime.ts`) cannot import `uuid` or call `Math.random` directly.

---

# Part 3 — Architecture

## 12. Facade

**How.** `GameEngine` is the single public game API. It owns `EventBus`, `StateMachine`,
`ActionService`, and `MutationCommitter` privately and exposes one command entry point.

**Why.** Callers previously had to coordinate three engine objects in the right order. A facade makes
the correct sequence the only available sequence.

**Source.** `packages/engine/src/engine/game-engine.ts:39`

```ts
/**
 * GameEngine — single public API for all engine operations.
 *
 * Owns and coordinates EventBus, StateMachine, and ActionService internally.
 * server.ts talks only to GameEngine — no more juggling 3 separate engine objects.
 */
export class GameEngine {
```

---

## 13. Layered Architecture (with enforced boundaries)

**How.** `types → library → engine → server → client`. The engine has zero knowledge of sockets or
HTTP. The client cannot import the engine at all. These are not conventions — they are tests.

**Why.** A rules engine that imports `socket.io` cannot be unit-tested or reused. Enforcing the
boundary mechanically means the layering survives refactors and new contributors.

**Source.** `docs/architecture-import-policy.md` (rules 1–10), executed by
`tests/architecture/import-boundaries.test.ts:30`

```ts
const clientEngineRuntimeExceptions: string[] = [];
const policy = architecturePolicyViolations(graph, clientEngineRuntimeExceptions);
```

> 2. `packages/engine/src/engine/**` cannot import anything under `apps/server/src/`.
> 4. **R-B:** clients cannot import `packages/engine/**`, including type-only imports.
> 9. **R-A:** no application under `apps/` can import another application.
> 10. **R-C:** protocol dependencies on the engine must be type-only.

---

## 14. Ports & Adapters (Hexagonal)

**How.** `RoomRuntime` declares its outbound needs as a `RoomRuntimePorts` interface
(`publishDelta`, `roomDestroyed`). It never imports Socket.IO or Express. `application.ts` supplies
the real adapters.

**Why.** The multiplayer lifecycle — identity, timers, reconnect, room destruction — is the hardest
part to test. With ports, it can be driven by a fake that records calls, with no network.

**Source.** `apps/server/src/rooms/room-runtime.ts:40`

```ts
export interface RoomRuntimePorts {
  publishDelta(request: RoomDeltaRequest): void;
  roomDestroyed(notice: RoomDestroyedNotice): void;
}
```

Wired in `apps/server/src/application.ts:74`:

```ts
const runtime = new RoomRuntime(store, {
  publishDelta: request => {
    const delta = sync.buildDelta(request.oldState, request.mutations, { action: request.action, playerId: request.playerId, batches: request.batches });
    sync.broadcast(delta, request.room, playerId => request.recipients.get(playerId) ?? playerId);
  },
  roomDestroyed: ({ roomId, socketIds }) => {
    store.auth.deleteRoomSeats(roomId);
    for (const socketId of socketIds) io.to(socketId).emit('roomDestroyed', { protocolVersion: PROTOCOL_VERSION, roomId });
  },
}, config.rooms.reconnectGraceMs, {}, roomSettings);
```

---

## 15. Composition Root

**How.** All wiring happens in one place, `createGameApplication(options)`. Every collaborator is
constructed there and injected downward. `ApplicationOptions` allows tests to substitute the store,
clock, config, and gameplay settings.

**Why.** A single composition root means there is exactly one place to look to understand what talks
to what, and tests can build a fully-wired app with fakes in one call.

**Source.** `apps/server/src/application.ts:49`

```ts
/** Application composition is reusable by short HTTP/socket acceptance tests. */
export function createGameApplication(options: ApplicationOptions = {}) {
  const environment = options.environment ?? process.env, config = options.effectiveConfig ?? loadServerConfig(environment, options.configuration), settings = options.settings ?? config.auth;
  const now = options.now ?? Date.now, origins = new Set(config.origins), root = path.resolve(__dirname, '..', '..', '..');
  ...
  const app = express(), server = http.createServer(app), store = options.store ?? new InMemoryStore(persistent, persistent, persistent);
```

---

## 16. Separation of Planning from Applying

**How.** A naming convention encodes the split: `plan*` functions compute mutations and are pure;
`apply*` / `reduce*` functions commit them. `planActionCosts` previews payment by folding the reducer
over a throwaway room; `MutationCommitter` performs the real commit.

**Why.** Legality checks and cost previews must not have side effects. Splitting plan from apply lets
the same logic answer "can I afford this?" and "pay for this" without duplicating rules.

**Source.** `packages/engine/src/engine/action-costs.ts:18`

```ts
const preview = (room: GameRoom, mutations: GameMutation[]) => mutations.reduce(gameReducer, room);

/** Plan payment without events, checkpoints or mutation of authoritative state. */
export function planActionCosts(room: GameRoom, playerId: PlayerId, source: CardInstance, ...): CostPlan {
  let working = room;
  const mutations: GameMutation[] = [];
  ...
  mutations.push(...result.mutations); working = preview(working, result.mutations);
```

The `plan*` family is consistent across the engine: `planDamage` (`damage-service.ts:38`),
`planTriggerScheduling` (`trigger-scheduler.ts:17`), `planStateBasedActions`
(`state-based-planner.ts:61`), `planStackResolution` (`effect-resolver.ts:141`), and
`planProposedMutations` (`proposed-events.ts:219`).

---

# Part 4 — Behavioral patterns

## 17. Observer / Publish–Subscribe

**How.** `EventBus` is a room-scoped synchronous pub/sub. `TriggerManager` subscribes to committed
events; `MutationCommitter` publishes them after a batch commits.

**Why.** Triggered abilities are, structurally, observers of game events. A bus decouples "something
happened" from "who cares", so new trigger sources need no changes to the commit path.

**Source.** `packages/engine/src/engine/event-bus.ts:17`

```ts
/**
 * Synchronous event dispatch. The engine publishes committed events with batch context.
 */
export class EventBus {
  private listeners: Map<string, EventListener[]> = new Map();
  emit(event: GameEvent, context?: EventContext): void { ... }
  on<K extends string>(eventId: K, listener: EventListener<K>): void { ... }
```

---

## 18. Strategy / Table-Driven Dispatch

**How.** `EffectRegistry` is a `Record<string, EffectHandler>` — a lookup table of strategies keyed by
effect name. `ACTION_IDS` is a closed `as const` table that is the single source of truth for action
identifiers. `TURN_SEQUENCE` and `AUTO_PHASES` are declarative tables driving the phase clock.

**Why.** A table is data: it can be enumerated, validated, and extended without touching control flow.
It also removes long `switch` chains from hot paths.

**Source.** `packages/engine/src/engine/effect-registry.ts:18`

```ts
export type EffectHandler = (room: GameRoom, stackObj: StackObject, effect: StackEffect, context?: EffectContext) => GameMutation[];

export const EffectRegistry: Record<string, EffectHandler> = {
  'ATTACH': (room, stackObj, effect) => { ... },
  'CLAIM_REVEALED_SELF': (room, stackObj, effect) => { ... },
```

```ts
// packages/engine/src/types/action.ids.ts:17
/** The closed set of known player action IDs. */
export const ACTION_IDS = {
  castSpell: 'cast_spell',
  playLand: 'play_land',
  activateAbility: 'activate_ability',
  choose: 'choose',
  declareAttackers: 'declare_attackers',
  declareBlockers: 'declare_blockers',
  tapForMana: 'tapForMana',
  enterBattle: 'enter_battle',
  endTurn: 'end_turn',
  passPriority: 'pass_priority',
  resolveStack: 'resolve_stack',
  rpsPlay: 'rpsPlay',
} as const;
```

---

## 19. Plugin Registry with Disposal

**How.** `CombatRuleRegistry`, `DamageRuleRegistry`, and `ModifierRegistry` accept rules at runtime
and return an **unregister function**. Rules are consulted in registration order and compose by
reduction.

**Why.** Keywords (Flying, Trample, Deathtouch) are independent, composable opinions. A registry lets
each keyword live in its own module, and the returned disposer prevents test pollution — a rule
registered in one test cannot leak into the next.

**Source.** `packages/engine/src/engine/combat-rules.ts:60`

```ts
static register(rule: CombatRule): () => void {
  this.rules.add(rule);
  return () => { this.rules.delete(rule); };
}
```

```ts
// packages/engine/src/engine/damage-service.ts:12
export class DamageRuleRegistry {
  private static rules = new Set<DamageRule>();
  static register(rule: DamageRule): () => void {
    this.rules.add(rule); return () => { this.rules.delete(rule); };
  }
```

---

## 20. Interceptor — replacement effects before commit

**How.** `MutationCommitter.commit` first calls `planProposedMutations`, which may rewrite, cancel, or
defer the proposed mutations (replacement effects) — and may open a `PendingChoice` instead of
committing anything.

**Why.** Replacement effects must observe the *proposed* event, not the applied one. Intercepting
before commit is the only place where "instead of that, do this" is expressible without corrupting
state.

**Source.** `packages/engine/src/engine/mutation-committer.ts:29`

```ts
/** Finish proposal decisions before committing any part of this transaction. */
commit(mutations: GameMutation[], cause: BatchCause, resolution?: ResolutionReport): GameMutation[] {
  const plan = planProposedMutations(this.room, mutations, { simultaneous: cause.kind === 'state-based-action', cause, resolution });
  if (plan.pendingChoice) return this.commitPreparedMutations([
    { type: 'SET_PENDING_CHOICE', choice: this.identifyChoice(plan.pendingChoice) },
    { type: 'SET_PRIORITY', playerId: null }, { type: 'SET_ENGINE_STATE', state: cause.kind === 'state-based-action' ? 'state_based_actions' : 'resolving_stack' },
  ], cause);
  return this.commitPreparedMutations(plan.mutations, cause, resolution);
}
```

---

## 21. Fixed-Point Iteration

**How.** `runRulesCheckpoint` loops: settle state-based actions → drain pending triggers → schedule →
repeat, until nothing changes or the game ends. It throws if a step makes no progress.

**Why.** MTG's rules are a fixpoint: applying SBAs can create triggers, which can create more SBAs.
A loop with an explicit progress assertion is the honest model, and the assertion turns an infinite
loop into a loud failure.

**Source.** `packages/engine/src/engine/rules-checkpoint.ts:14`

```ts
/** Settle SBAs before scheduling discovered triggers; repeat until stable or terminal. */
export function runRulesCheckpoint(boundary: CheckpointBoundary): GameMutation[] {
  const applied: GameMutation[] = [];
  while (true) {
    ...
    if (stateBased.length) {
      const changes = boundary.apply(stateBased, 'state-based-action');
      if (!changes.length) throw new Error('State-based actions made no progress');
```

---

## 22. Snapshot / Last-Known Information

**How.** When a permanent leaves the battlefield, `captureSourceInformation` records its
characteristics and controller. `retainDepartingSource` attaches that snapshot to any stack object
that referenced it, so resolution can still read "the creature as it last existed".

**Why.** A trigger that says "when this dies, draw a card equal to its power" must read power from
*before* it died. Without a snapshot, the information is gone by resolution time.

**Source.** `packages/engine/src/engine/source-information.ts:6`

```ts
export function captureSourceInformation(room: GameRoom, card: CardInstance): CardSnapshot {
  const value = CardCharacteristicService.resolve(room, card);
  return { card: { ...structuredClone(card), state: { ...structuredClone(card.state), controllerId: value.controllerId }, lastKnownCharacteristics: value,
    lastKnownCopiableCharacteristics: CardCharacteristicService.resolve(room, card, 1) },
    power: value.power, toughness: value.toughness };
}
```

---

## 23. Optimistic Concurrency via Revisions

**How.** Every card carries a `zoneRevision` that increments on each zone change. Mutations that
reference a card carry the revision they expect; the reducer rejects the mutation if it no longer
matches. Library reorder/shuffle validate the full reference set the same way.

**Why.** A client can hold a stale reference to a card that has since changed zones. Comparing
revisions turns "silently act on the wrong object" into "reject the stale instruction" — the same
idea as optimistic concurrency control in a database.

**Source.** `packages/engine/src/engine/library-operations.ts:7`

```ts
for (const reference of references) {
  const card = reference && cards.get(reference.cardUuid);
  if (!card || card.state.zone !== 'library' || card.state.ownerId !== player.id ||
      !Number.isSafeInteger(reference.zoneRevision) || reference.zoneRevision < 0 ||
      reference.zoneRevision !== (card.state.zoneRevision ?? 0)) return;
```

See also `validateCardMove` in `packages/engine/src/engine/zone-transitions.ts:32`.

---

# Part 5 — Robustness & security

## 24. Fail-Fast Validation

**How.** Card definitions are validated at load (`card-definition-validator.ts`), configuration at
startup (`config/index.ts`), room setup at snapshot time (`snapshotSetupConfig`), and socket packets
at the transport boundary (`parseActionPacket`). Invalid input throws immediately with a specific
message.

**Why.** A malformed card definition that reaches the engine produces a confusing failure deep in
resolution. Validating at the boundary converts it into a clear error at the point of entry.

**Source.** `packages/engine/src/library/card-definition-validator.ts:14`

```ts
/** Scan opaque data only to reject reserved syntax, never to interpret it. */
export function assertNoNumericExpressions(value: unknown): void {
  ...
  if (hasNumericExpression(input)) throw new Error('Numeric expression in an unsupported definition field');
```

```ts
// packages/engine/src/config/index.ts:32
export function snapshotSetupConfig(setup: SetupConfig = gameConfig.setup): SetupConfig {
  if (!Number.isSafeInteger(setup.startingLife) || setup.startingLife <= 0 || ...)
    throw new Error('Invalid gameplay setup configuration');
```

---

## 25. Validate-Then-Mutate

**How.** `moveCard` delegates to `validateCardMove` and returns the room unchanged if validation
fails. The validator checks the *complete* move — source zone, destination emptiness, ownership,
revision, token rules, controller existence — before anything is removed.

**Why.** A partially applied zone change is unrecoverable: the card exists in neither zone. Validating
the whole operation first makes the move atomic by construction.

**Source.** `packages/engine/src/engine/zone-transitions.ts:32`

```ts
/** Validate the complete move before removing anything. Abilities aren't card occupants. */
export function validateCardMove(room: GameRoom, move: Extract<GameMutation, { type: 'MOVE_CARD' }>): boolean {
  if (move.from === move.to || !room.players[move.playerId]) return false;
  const card = getCardInZone(room, move.cardUuid, move.playerId, move.from);
  if (!card || (card.state.ownerId && card.state.ownerId !== move.playerId)) return false;
  ...
```

```ts
// zone-transitions.ts:56
export function moveCard(room: GameRoom, move: Extract<GameMutation, { type: 'MOVE_CARD' }>): GameRoom {
  if (!validateCardMove(room, move)) return room;
```

---

## 26. Defensive Copying

**How.** Configuration and stored records are cloned on the way in and out: `snapshotSetupConfig`
returns `structuredClone(...)`, `InMemoryDeckStore` clones on read and write, and the loaded server
config is deep-frozen before it is handed out.

**Why.** A caller that mutates a returned config object would silently change global defaults for
every room. Copying at the boundary makes shared configuration safe to hand out.

**Source.** `packages/engine/src/config/index.ts:32`

```ts
/** Validate and copy per room. Defaults are resolved at call time for legacy fixture callers. */
export function snapshotSetupConfig(setup: SetupConfig = gameConfig.setup): SetupConfig {
  ...
  return structuredClone({ ...setup, landPlaysPerTurn: landPlayLimit(setup) });
}
```

```ts
// apps/server/src/decks/deck-store.ts:18
findDeck(ownerId: string, id: string) { const entry = this.records.get(id); return entry?.ownerId === ownerId ? structuredClone(entry.deck) : undefined; }
```

---

## 27. Idempotency

**How.** `ActionService.initRoom` is safe to call repeatedly; `GameEngine.dispose` is final.
`GameEngine.applyMutations` guards against re-entrant checkpoints with a `processingRules` flag.
Client `applyDelta` ignores deltas whose `seq` is not newer than the last applied one.

**Why.** Reconnect, retry, and duplicate socket delivery are normal in a networked game. Idempotent
entry points make those cases harmless instead of corrupting.

**Source.** `packages/engine/src/engine/action-service.ts:54`

```ts
/**
 * Initialize per-room systems once. Repeated calls are safe; disposal is final.
 * Wires TriggerManager to the room's EventBus so ETB triggers fire.
 * Passes a getter function so TriggerManager always reads the current
 * room state (the engine reassigns `room` after each mutation).
 */
initRoom(getRoom: () => GameRoom): void {
  if (this.triggerManager || this.destroyed) return;
  this.triggerManager = new TriggerManager(this.eventBus, this.mutationCollector, this.generateUuid, getRoom);
}
```

```ts
// apps/game-client/store/gameStore.ts:97
if (delta.protocolVersion !== PROTOCOL_VERSION || delta.roomId !== current.roomId || delta.viewerId !== current.viewerId || delta.seq <= get().lastSeq) return;
```

The re-entrancy guard is at `packages/engine/src/engine/game-engine.ts:98`:

```ts
// Rule listeners enqueue work; they cannot recursively open another checkpoint.
if (this.processingRules) {
  this.mutationCollector.push(...mutations);
  return [];
}
this.processingRules = true;
```

---

## 28. Least Privilege / Information Hiding

**How.** Clients never receive `GameRoom`. They receive a `PlayerView` built by a projection layer
that applies a centralised reveal policy: hands are visible only to their owner, RPS plays only after
resolution, stack sources only if public.

**Why.** `GameRoom` contains both players' hands and decks. Sending it and hiding fields in the UI
would leak the entire game to anyone with devtools. Projection makes the leak structurally impossible.

**Source.** `apps/server/src/projection/reveal-policy.ts:8`

```ts
export const canSeeHand = (viewerId: string, ownerId: string): boolean => viewerId === ownerId;
export const canSeeChoice = (room: GameRoom, viewerId: string): boolean => room.pendingChoice?.playerId === viewerId;
export const canSeeRpsPlay = (room: GameRoom, viewerId: string, ownerId: string): boolean => room.rpsState.status === 'resolved' || viewerId === ownerId;
```

```ts
// apps/server/src/projection/view-builder.ts:37
hand: canSeeHand(viewerId, id) ? player.hand.map(card => buildCardView(room, viewerId, card, true)) : [],
handCount: player.hand.length, deckCount: player.deck.length,
```

---

## 29. Opaque Capability Handles

**How.** Internal identifiers that would leak engine structure are replaced with HMAC-derived opaque
strings before crossing the wire: granted ability IDs (`publicAbilityId`) and choice option IDs
(`optionId`). The server decodes them back on the way in.

**Why.** An ability ID like `effect@source` tells a client how the engine is structured and invites
forged references. An HMAC handle is unforgeable, viewer-scoped, and reveals nothing.

**Source.** `apps/server/src/projection/wire-identifiers.ts:7`

```ts
const key = randomBytes(32);
/** Granted ability identifiers embed server effect/source identities; keep those opaque. */
export function publicAbilityId(roomId: string, viewerId: string, id: string): string {
  return id.includes('@') ? 'ability:' + createHmac('sha256', key).update(JSON.stringify([roomId, viewerId, id])).digest('hex') : id;
}
```

---

## 30. Default-Deny Allowlisting

**How.** `projectActionOptions` copies only an explicit allowlist of fields to the wire, and only
allowlisted `data` keys with validated types. Anything the engine adds later stays private until it is
deliberately added to the contract.

**Why.** The default for a new engine field must be "not sent". An allowlist makes accidental
disclosure require an explicit edit, whereas a denylist would leak every future field by default.

**Source.** `apps/server/src/projection/action-options.ts:5`

```ts
/** Future engine option metadata is private unless explicitly added to the wire contract. */
export function projectActionOptions(options: readonly ActionOption[], roomId: string, viewerId: string): ActionOption[] {
  return options.map(option => ({
    actionId: option.actionId, label: option.actionId === 'activate_ability' ? option.label.split('@')[0] : option.label,
    ...(option.description !== undefined ? { description: option.description } : {}),
    ...(option.disabled !== undefined ? { disabled: option.disabled } : {}),
    ...(option.disabledReason !== undefined ? { disabledReason: option.disabledReason } : {}),
    ...(option.hidden !== undefined ? { hidden: option.hidden } : {}),
    ...(option.data ? { data: Object.fromEntries(Object.entries(option.data).filter(([key, value]) =>
      (key === 'abilityId' || key === 'manaColor') && typeof value === 'string' ||
      (key === 'abilityIndex' || key === 'zoneRevision') && typeof value === 'number' && Number.isSafeInteger(value)).map(([key, value]) =>
        [key, key === 'abilityId' ? publicAbilityId(roomId, viewerId, value as string) : value])) } : {}),
  }));
}
```

---

## 31. Prototype-Pollution Defence

**How.** Every place that walks attacker-influenced keys rejects `__proto__`, `constructor`, and
`prototype`: config merging, rule paths, and client delta paths.

**Why.** Card data, config overrides, and delta paths all originate outside the trusted core. A single
`obj["__proto__"]` assignment can poison every object in the process. Rejecting the three keys at each
entry point is cheap and total.

**Source.** `packages/engine/src/shared/rule-path.ts:1`

```ts
export const safeRuleKey = (key: string): boolean => !!key && !['__proto__', 'constructor', 'prototype'].includes(key);
export const validRulePath = (path: unknown): path is string => typeof path === 'string' && path.split('.').every(safeRuleKey);
```

```ts
// apps/server/src/config/index.ts:28
if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new ConfigurationError('Invalid configuration key');
```

```ts
// apps/game-client/store/deltaReducer.ts:19
if (path.split(/[.[\]]+/).some(part => ['__proto__', 'prototype', 'constructor'].includes(part))) throw new Error('Unsafe delta path');
```

---

## 32. Data-Only Rules (no `eval`)

**How.** Card conditions are declarative JSON (`RuleCondition` trees) evaluated by
`conditionMatches`. Field access goes through `readRulePath`, which reads **own** properties only and
never executes anything.

**Why.** Card content is authored data, not code. Interpreting it as data means a malicious or
malformed card file cannot execute arbitrary JavaScript, and conditions remain serialisable and
inspectable.

**Source.** `packages/engine/src/shared/rule-path.ts:5`

```ts
/** Read only own fields of rules data, never executable expressions. */
export function readRulePath(context: unknown, path: string): unknown {
  if (!validRulePath(path)) return undefined;
  let value: unknown = context;
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
```

---

## 33. Backpressure & Resource Limits

**How.** Concurrent password operations are capped (`maxPasswordOperations` → HTTP 503), request
bodies are size-limited (`bodyLimitBytes`), config files are size-checked before parsing, and admin
log reads are bounded.

**Why.** Password hashing is deliberately expensive; without a cap, a burst of login attempts is a
self-inflicted denial of service. Explicit limits turn an unbounded resource into a predictable one.

**Source.** `apps/server/src/auth/service.ts:25`

```ts
private async passwordTask<T>(task: () => Promise<T>): Promise<T> {
  if (this.passwordOperations >= this.config.maxPasswordOperations) throw new AuthError(503, 'Authentication busy. Try again shortly.');
  this.passwordOperations++;
  try { await this.ready; return await task(); } finally { this.passwordOperations--; }
}
```

Related: `dummyHash` in the same file equalises timing between "unknown account" and "wrong password".

---

# Part 6 — Observability & configuration

## 34. Structured Logging with Injectable Sinks

**How.** Every log is a `LogEntry` object, not a formatted string. `GameLogger` supports inherited
context (`withContext`), a minimum level, and injectable sinks. Credentials are redacted before
logging.

**Why.** Structured entries can be written to a database, filtered by correlation ID, or asserted in
tests without changing a single call site. Context inheritance means a command ID is attached once and
appears on every downstream log.

**Source.** `packages/engine/src/shared/game-logger.ts:52`

```ts
/**
 * Event-agnostic structured logger with inherited context and injectable sinks.
 */
export class GameLogger {
  private readonly minLevel: LogLevel;
  private readonly sinks: readonly LogSink[];
```

```ts
// apps/server/src/auth/service.ts:31
serverLogger.info(event, 'Authentication request processed', redactCredentials({ result, scope, ...(accountId ? { accountId } : {}) }) as Record<string, unknown>);
```

---

## 35. Externalized, Layered Configuration

**How.** Defaults live in JSON files per concern (`auth.json`, `http.json`, `storage.json`,
`rooms.json`, `logging.json`), profiles override them (`development` / `production` / `test`), an
external `CONFIG_FILE` overrides those, and environment variables override last. The merged result is
validated against a schema.

**Why.** Operators can change behaviour without a rebuild, tests get a deterministic profile, and the
precedence order is explicit rather than emergent. Validation after merging means a bad override fails
at startup, not at first use.

**Source.** `apps/server/src/config/index.ts:25`

```ts
/** Arrays replace. Dangerous/unknown keys never become silently accepted settings. */
export function mergeConfig(base: unknown, override: unknown): unknown {
  if (!object(override) || !object(base)) return structuredClone(override);
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new ConfigurationError('Invalid configuration key');
    result[key] = object(value) && object(result[key]) ? mergeConfig(result[key], value) : structuredClone(value);
  }
  return result;
}
```

---

# Part 7 — Performance

## 36. Memoization with Scoped Lifetime

**How.** `withCharacteristicCache` installs a per-evaluation cache for resolved card characteristics,
then restores the previous scope in a `finally`. Outside a scope, resolution falls back to the
uncached path.

**Why.** Resolving effective P/T walks the continuous-effect pool and layer ordering — expensive, and
called many times per projection. Caching for the duration of one evaluation gives the win without
risking a stale cache across state changes.

**Source.** `packages/engine/src/engine/card-characteristic-service.ts:13`

```ts
/** Synchronous read-only scopes never outlive the supplied room evaluation. */
export function withCharacteristicCache<T>(room: GameRoom, evaluate: () => T): T {
  const previous = resolutionScope;
  resolutionScope = { room, values: new Map(), boards: new Map() };
  try { return evaluate(); } finally { resolutionScope = previous; }
}
```

---

## 37. Path-Based Incremental Updates

**How.** The client applies deltas by path (`"players.p1.hand[3]"`), shallow-copying only along the
path — O(path depth), not O(room size). The server projects deltas by diffing the wire schema only.

**Why.** A full room snapshot on every action is wasteful and causes React to re-render everything.
Path updates keep both the copy cost and the render cost proportional to what actually changed.

**Source.** `apps/game-client/store/deltaReducer.ts:4`

```ts
/**
 * Path-based immutable delta applier.
 *
 * Each DeltaChange carries a dot/bracket path (e.g. "players.player1.life",
 * "battlefield[0].state.isTapped"). We apply changes in causal order,
 * shallow-copying along the path — O(path depth), not O(room size).
 */
```

```ts
// apps/server/src/projection/delta-projector.ts:7
/** Diff only the wire schema. Neither raw mutation paths nor raw oldValue can cross this boundary. */
export function projectViewDelta(before: GameRoom | undefined, after: GameRoom, viewerId: string, metadata: DeltaMetadata): ViewDelta {
```

---

## 38. Referential Stability in Selectors

**How.** Selectors that build a new array or object are wrapped in `useShallow`; selectors returning
primitives or stable references are not. Empty-state constants (`EMPTY_COMBAT`, `EMPTY_STACK`,
`EMPTY_LOG`) are module-level singletons.

**Why.** Zustand v5 uses `useSyncExternalStore`. A selector returning a fresh reference on every call
causes an infinite re-render loop (React error #185). Shallow comparison plus stable empty constants
keeps subscriptions stable.

**Source.** `apps/game-client/components/Battlefield.tsx:6`

```tsx
const myBattlefield = useGameStore(useShallow(selectMyBattlefield));
const opponentBattlefield = useGameStore(useShallow(selectOpponentBattlefield));
```

```tsx
// apps/game-client/components/CombatDisplay.tsx:14
const combat = useGameStore(useShallow((s) => s.room?.combat ?? EMPTY_COMBAT));
```

---

# Part 8 — Verification

## 39. Architecture as Executable Tests

**How.** `tests/architecture/import-boundaries.test.ts` parses the TypeScript AST of every file under
`apps/` and `packages/`, builds an import graph, and asserts: no runtime cycles, no engine→server
imports, no client→engine imports, no app→app imports, protocol→engine type-only, and no direct
`uuid` / `Math.random` in the authoritative consumers.

**Why.** A boundary documented only in prose decays. A boundary expressed as a failing test is
enforced on every commit, and the failure message names the offending `source -> target` edge.

**Source.** `tests/architecture/import-boundaries.test.ts:30`

```ts
const graph = buildImportGraph({ repoRoot: process.cwd(), sourceRoots: ['apps', 'packages'], aliases: [...] });
const policy = architecturePolicyViolations(graph, clientEngineRuntimeExceptions);
```

Run in isolation with `npm run test:architecture`; also part of `npm test`.

---

## 40. Deterministic Time/Random Injection

**How.** `RuntimeContext` supplies `uuid()` and `random()`. Production defaults are `uuidv4` and
`Math.random`; tests inject counters and fixed sequences. `EffectContext` narrows this to `random`
only. `now` is injectable in `ApplicationOptions` and `AuthService`.

**Why.** A test that asserts "the shuffled deck is X" is only meaningful if the shuffle is
deterministic. Injecting the capability makes every non-deterministic path reproducible, and the
architecture test prevents a regression that reintroduces a direct global call.

**Source.** `packages/engine/src/shared/runtime-context.ts:4`

```ts
export function resolveRuntimeContext(dependencies: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    uuid: dependencies.uuid ?? defaultRuntimeContext.uuid,
    random: dependencies.random ?? defaultRuntimeContext.random,
  };
}
```

```ts
// apps/server/src/application.ts:51
const now = options.now ?? Date.now, origins = new Set(config.origins), root = path.resolve(__dirname, '..', '..', '..');
...
const auth = new AuthService(store.auth, store, settings, now);
```

---

# Appendix — deliberate trade-offs

Principles are not free. These are the places where the codebase consciously chose otherwise, and why.

| Decision | Trade-off accepted | Where |
|---|---|---|
| `GameRoom` is one large aggregate | Simpler atomic commits and diffs; the reducer is a big file | `types/game.room.types.ts` |
| `room-factory.ts` mutates the room directly | Setup happens before the mutation pipeline exists; documented as by-design | `docs/MAP.md` (*Setup / rooms* row) |
| `ModifierRegistry` / `ModifierPipeline` are stubs | Permission checks always pass; superseded in practice by the continuous-effect pool | `ARCHITECTURE.md` §1.2 |
| In-memory room storage | Rooms vanish on restart; acceptable because accounts/decks persist in SQLite | `apps/server/src/rooms/state-store.ts` |
| `JSON.stringify` comparison in `projectViewDelta` | Simple and correct; not the fastest possible diff | `apps/server/src/projection/delta-projector.ts` |
| Static registries (`CombatRuleRegistry`, `DamageRuleRegistry`) | Global mutable state; mitigated by disposers and test isolation | `engine/combat-rules.ts`, `engine/damage-service.ts` |

---

## See also

- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — per-type reference and subsystem ownership
- [`MAP.md`](MAP.md) — concept index and end-to-end flows
- [`architecture-import-policy.md`](architecture-import-policy.md) — the enforced dependency rules
- [`workspace-architecture.md`](workspace-architecture.md) — build, typecheck and artifact boundaries
- [`logging.md`](logging.md) — structured log format and conventions
- [`configuration-architecture.md`](configuration-architecture.md) — configuration precedence
