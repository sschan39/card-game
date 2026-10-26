# Concept Map — where things are and how they run

**Status:** Current · Architecture modernization 9/9 complete · **Date:** 2026-10-26

> This is the **navigability map**. It answers two questions only:
> **"Where does concept X live?"** and **"How does flow Y run end-to-end?"**
>
> It describes **what is**, never **what should be**. Deep per-type detail lives in
> [`../ARCHITECTURE.md`](../ARCHITECTURE.md). Local plans and historical reports are intentionally
> untracked so this map and the architecture reference remain the canonical current state.
>
> **Maintenance rule:** when a slice moves code, update the *Locations* column here in the
> **same commit**. The *Flow* and *Owns* columns are stable and rarely change.

---

## 0. The mental model in one paragraph

A player command enters through the `apps/server/src/application.ts` transport adapter, which calls
**`RoomRuntime.executePlayerAction`**. The runtime resolves the stable player identity, owns the
room's engine, and calls **`GameEngine.executePlayerAction`** (the single public game API). The
engine routes to an **action handler** (validate → propose) or a **command** in `player-commands.ts`.
Handlers are pure: they return **`GameMutation[]`** and never touch state. `GameEngine.applyMutations`
sequences each mutation through the pure **`gameReducer`**, which returns a **new `GameRoom`**.
After a batch commits, **`deriveAppliedEvents`** projects canonical events from the before/after
diff and the **`EventBus`** dispatches them. **`TriggerManager`** discovers triggers and pushes
new mutations into a collector; **`runRulesCheckpoint`** settles state-based actions and schedules
triggers, looping until stable. **`SyncService`** turns the applied mutations into per-player
**`ViewDelta`s** through the server projection and emits them to clients. Internal `StateDelta`s remain in the server log.

**The one rule that explains everything:** *state changes are mutations; events are derived from
state changes; triggers are discovered from events.* Nothing hand-emits events.

---

## 1. The canonical spine (memorize this)

```
player command
  → GameEngine.executePlayerAction          (packages/engine/src/engine/game-engine.ts)
  → ActionRegistry handler / player-commands (validate → propose)
  → GameMutation[]
  → GameEngine.applyMutations
  → MutationCommitter.commit                 (packages/engine/src/engine/mutation-committer.ts)
  → reduceGameOperation (gameReducer)        (packages/engine/src/engine/game-reducer.ts)
  → deriveAppliedEvents                      (packages/engine/src/engine/applied-events.ts)
  → EventBus.emit                            (packages/engine/src/engine/event-bus.ts)
  → TriggerManager.onEvent → discoverTriggers(packages/engine/src/engine/trigger-manager.ts)
  → mutationCollector
  → runRulesCheckpoint                       (packages/engine/src/engine/rules-checkpoint.ts)
  → triggerQueue → priority passes → planStackResolution
  → SyncService → player projection → ViewDelta → client
```

If you understand this line, you understand the engine. Every concept below is a detail hanging
off one of these stages.

---

Workspace paths: unprefixed `engine/`, `library/`, `types/`, and `shared/` below are relative to `packages/engine/src/`; `server/` means `apps/server/src/rooms/`, and `client/` means `apps/game-client/`. The transport composition is `apps/server/src/application.ts`; `index.ts` starts the process. Auth/session ownership and admin APIs are mapped in the [auth supplement](authentication-architecture.md).

## 2. Concept index

| Concept | Entry point | Primary locations | Owns | Must NOT do |
|---|---|---|---|---|
| **Public API** | `GameEngine` | `engine/game-engine.ts` | Command boundary, sequencing, checkpoint guards | Contain card-specific logic |
| **State reduction** | `gameReducer` / `reduceGameOperation` | `engine/game-reducer.ts` | The only authoritative state transition | Import transport, run checkpoints |
| **Commit & publish** | `MutationCommitter.commit` | `engine/mutation-committer.ts` | Prepared commits, event derivation, history, publication | Run checkpoints or commands |
| **Action pipeline** | `ActionRegistry` | `engine/action-registry.ts`, `engine/default-action-registry.ts`, `engine/handlers/*` | validate → propose → resolve per action | Mutate state directly |
| **Commands** | `playerCommands` | `engine/player-commands.ts` | Non-card commands (`enter_battle`, `end_turn`, …) | Duplicate action handlers |
| **Turn / phase / priority** | `StateMachine` | `engine/state-machine.ts` | Phase clock, priority, stack insertion | Apply mutations itself (returns them) |
| **Events** | `deriveAppliedEvents` | `engine/applied-events.ts`, `engine/event-bus.ts` | Canonical events from state diffs | Be hand-emitted by handlers |
| **Triggers** | `TriggerManager` | `engine/trigger-manager.ts`, `trigger-matching.ts`, `trigger-scheduler.ts` | Discovery, matching, APNAP scheduling | Choose targets or resolve effects |
| **Rules checkpoint** | `runRulesCheckpoint` | `engine/rules-checkpoint.ts` | SBA + trigger settlement loop | Own individual rules |
| **State-based actions** | `planStateBasedActions` | `engine/state-based-planner.ts`, `state-based-actions.ts` | Lethal damage, life, poison, failed draw | Run outside the checkpoint |
| **Effects** | `planStackResolution` | `engine/effect-resolver.ts`, `resolution-planning.ts`, `effect-registry.ts` | Plan values, orchestrate order, dispatch primitives | Know about phases |
| **Replacement effects** | `planProposedMutations` | `engine/proposed-events.ts`, `replacement-rules.ts` | Redirect/cancel before commit | Run after commit |
| **Choices** | `answerPendingChoice` | `engine/choice-continuation.ts`, `choices.ts`, `action-choices.ts`, `resolution-choices.ts` | Dispatch one pending decision | Be a generic workflow engine |
| **Combat** | `startCombatDamage` / handlers | `engine/combat-service.ts`, `combat-rules.ts`, `combat-state.ts` | Attackers, blockers, damage assignment | Live in the trigger pipeline |
| **Damage** | `damage-service` + `reduceDamageBatch` | `engine/damage-service.ts`, `damage-keywords.ts` | Rule hooks, validation, planning; reducer owns application | Import the reducer from planning |
| **Characteristics** | `CardCharacteristicService` | `engine/card-characteristic-service.ts`, `characteristic-layers.ts` | Effective P/T, keywords, types, controller | Mutate the pool |
| **Continuous effects** | normalization + state queries | `engine/continuous-effects.ts`, `continuous-effect-state.ts`, `effect-scopes.ts` | Normalize pool entries; enumerate cards, sources, lifetimes, and scopes | Own layer evaluation |
| **Zones** | `moveCard` | `engine/zone-transitions.ts` | Centralized `MOVE_CARD` validation + application | Be bypassed by handlers |
| **Mana** | `ManaPool` | `engine/mana-pool.ts`, `mana-abilities.ts` | All mana arithmetic | Be computed ad hoc |
| **Targeting** | `revalidateTargets` / `target-legality` | `engine/resolution-planning.ts`, `shared/target-legality.ts`, `target-utils.ts` | Cast-time + resolve-time legality | Trust stale targets |
| **Options (UI)** | `OptionService` | `engine/option-service.ts` | Available actions for a card in a zone | Apply mutations |
| **Setup / rooms** | `createRoom` etc. | `engine/room-factory.ts` | Room creation, RPS, starting hands | Use the normal mutation path (by design) |
| **Serialized match state** | `GameRoom` | `types/game.room.types.ts` | Rule and recovery state, including membership/setup/RPS | Own sockets, timers, stores, or engine instances |
| **Process room session** | `RoomRuntime` | `server/room-runtime.ts`, `reconnect.ts`, `state-store.ts` | Engines, identities, timers, lifecycle, persistence coordination, ports | Be serialized into `GameRoom` |
| **Card data** | `getBlueprint` / `instantiateCard` | `library/card-catalog.ts`, `card-parser.ts`, `card-definition-validator.ts`, `card-factory.ts`, `card_data.json` | JSON → validated/normalized → frozen cached blueprint → instance | Import engine modules or mutate cached definitions |
| **Runtime dependencies** | `RuntimeContext` | `shared/runtime-context.ts` | UUID and random capabilities with production defaults | Enter serialized state or become a service locator |
| **Transport** | Socket handlers | `server.ts` | Decode events, call runtime, manage socket rooms, emit responses | Coordinate engines or room lifecycle |
| **Multiplayer application** | `RoomRuntime` | `server/room-runtime.ts` | Store, engines, identity, timers, room lifecycle, commands, sync requests | Import Socket.IO or Express |
| **Sync** | `SyncService` | `server/sync-service.ts` | Per-player deltas, JSONL log | Own authoritative state |
| **Reconnect** | `decideRejoin` | `server/reconnect.ts` | Identity maps, rejoin decisions | Touch game rules |
| **Client state** | `gameStore` | `client/store/gameStore.ts`, `deltaReducer.ts` | Projected state, UI state | Be authoritative |

---

## 3. Flows (how things run)

### 3.1 Play a card (cast a spell)

```
client 'playerAction'
  → apps/server/src/application.ts session check + parseActionPacket
  → RoomRuntime.executePlayerAction
  → GameEngine.executePlayerAction
  → ActionRegistry['cast_spell'].validate   (zone/timing/condition/cost/priority)
  → ActionRegistry['cast_spell'].propose    (pay cost, hand→stack, build StackObject)
  → applyMutations → gameReducer
  → runRulesCheckpoint → deriveAppliedEvents → EventBus
  → SyncService → per-player delta
```
Files: `handlers/play-card-handler.ts`, `action-validator.ts`, `action-costs.ts`, `mana-pool.ts`.

### 3.2 Resolve the stack

```
both pass priority (state-machine.passPriority)
  → planStackResolution
  → structural zone change (zone-transitions.moveCard)
  → revalidateTargets → dynamic params → EffectRegistry primitives
  → deriveAppliedEvents (PERMANENT_ENTERED / STACK_RESOLVED)
  → TriggerManager.discoverTriggers → collector
  → runRulesCheckpoint drains → triggerQueue → priority
```
Files: `effect-resolver.ts`, `resolution-planning.ts`, `effect-registry.ts`, `zone-transitions.ts`.

### 3.3 A trigger fires

```
committed event
  → EventBus.emit
  → TriggerManager.onEvent
  → discoverTriggers (pure; EVENT_MAP lookup + triggerMatches)
  → pushTrigger (PUSH_STACK + RECORD_ABILITY_USE)
  → mutationCollector
  → runRulesCheckpoint → planTriggerScheduling (APNAP)
  → triggerQueue → ordering/targets choice
  → committed stack insertion → priority passes → effect result
```
Files: `trigger-manager.ts`, `trigger-matching.ts`, `trigger-scheduler.ts`, `turn-history.ts`.

### 3.4 A player must choose

```
a planner returns a PendingChoice
  → SET_PENDING_CHOICE + SET_PRIORITY(null) + SET_ENGINE_STATE
  → client answers with actionId 'choose'
  → GameEngine.executePlayerAction → executeCommand → answerPendingChoice
  → dispatch by continuation.type:
       state_based | replacement | combat | trigger | resolution | action
  → resume the owning planner → commit
```
Files: `choice-continuation.ts`, `choices.ts`, `action-choices.ts`, `resolution-choices.ts`.

### 3.5 Turn advances

```
passPriority (both passed, stack empty)
  → StateMachine.advancePhase('complete')
  → AUTO_PHASES (stateTurnStart, cleanupStep) auto-run
  → stop at first phase needing input → give priority
  → cleanupStep → switchTurn → next turn
```
Files: `state-machine.ts`, `game.state.types.ts` (`TURN_SEQUENCE`), `shared/turn-utils.ts`.

### 3.6 State-based actions settle

```
runRulesCheckpoint loop:
  settle SBAs (planStateBasedActions)
  → take pending (mutationCollector)
  → schedule triggers (planTriggerScheduling)
  → repeat until stable / terminal / choice pending
```
Files: `rules-checkpoint.ts`, `state-based-planner.ts`, `state-based-actions.ts`.

---

## 4. "Where do I add X?" recipes

| I want to… | Touch |
|---|---|
| Add a new player action | `types/action.ids.ts` + `engine/handlers/<name>-handler.ts` + `default-action-registry.ts` |
| Add a new effect primitive | `engine/effect-registry.ts` (+ `types/effect.types.ts` if new params) |
| Add a new trigger event | `types/card.types.ts` (`TriggerEvent`) + `EVENT_MAP` in `trigger-manager.ts` + `applied-events.ts` derivation |
| Add a new mutation | `types/game-mutation.types.ts` + a case in `game-reducer.ts` |
| Add a new card | `library/card_data.json` only (declarative — no code) |
| Add a named mechanic | `engine/mechanics/<mechanic>.ts` (only with its first real consumer) |
| Add a new choice kind | `types/choice.types.ts` + a branch in `choice-continuation.ts` |
| Add a new phase | `types/game.state.types.ts` (`TURN_SEQUENCE`) + `state-machine.ts` |
| Change what the client sees | `server/sync-service.ts` (delta filtering) + `client/store/deltaReducer.ts` |
| Add a socket event | `server.ts` (decode/emit) + `server/room-runtime.ts` only when it needs an application use case |

---

## 5. Layer rules (the dependency direction)

```
transport → multiplayer application → engine coordination → rules/core contracts
client    → shared projections/contracts
card catalog/normalization → core card/effect schema
```

- **`packages/engine/src/types/`** — pure contracts, no runtime code.
- **`packages/engine/src/engine/`** — game logic; **no** Socket.IO, Express, store, or transport imports.
- **`packages/engine/src/library/`** — card data loading, validation, normalization, immutable catalog publication,
  and instance construction; it may depend on `types` and stable `shared` contracts, not `engine`.
- **`apps/server/src/application.ts`** — transport decoding/emission and application composition; `index.ts` starts the listener.
- **`apps/server/src/auth/`** — passwords, scoped sessions and guest/account seat ownership; engine remains independent.
- **`apps/server/src/realtime/handshake.ts`** — token-derived game identity; claimed player IDs are ignored.
- **`apps/server/src/http/admin-router.ts`** — admin scope/role checks and bounded room summaries; inspector also requires its flag.
- **`apps/server/src/rooms/room-runtime.ts`** — multiplayer application lifecycle and engine coordination.
- **Other `apps/server/src/rooms/` modules** — focused storage, sync, reconnect, and packet parsing.
- **`packages/engine/src/shared/`** — rule-aware queries + presentation helpers (used by engine, server, client).
- **`apps/game-client/`** — React + Zustand; projected state only.

Rules may call another rule module's explicit query/planning API. They must not reach into
transport or storage.

Catalog blueprints are shared and recursively frozen. Tests needing synthetic card content replace
the fixture's whole `blueprint` object with a spread copy; they do not modify nested cached fields.

---

## 6. Known rough edges (so you don't get surprised)

These are **current facts**, not plans.

The `GameRoom` boundary contains serialized match and recovery state, while `RoomRuntime` and
focused server modules own all process resources.

- **`MutationCommitter.commitPreparedMutations` is large** — it normalizes ids, applies, derives
  events, records history, and publishes in one method.
- **Rule extension registries are process-level vocabularies today.** Combat, damage,
  target-modifier, replacement-operation, and numeric-query registries remain process-wide because
  current production composition has no per-match variants. Migrate one only when a real
  match/catalog constructor owns distinct instances.
- **`modifier-pipeline.ts` / `modifier-registry.ts` are stubs** (superseded by the
  continuous-effect pool + characteristic service).
- **Player clients import protocol only.** Server projection resolves card displays and target candidates. The five temporary engine exceptions are empty; see [`architecture-import-policy.md`](architecture-import-policy.md).

## Protocol and player projection

| Concern | Location |
|---|---|
| Player view, card display, choice and delta DTOs | `packages/protocol/src/` |
| Audience visibility and retained public sources | `apps/server/src/projection/reveal-policy.ts` |
| Snapshot and effective card displays | `projection/view-builder.ts`, `card-view.ts` |
| Server target candidates | `projection/target-groups.ts` |
| Delta convergence | `projection/delta-projector.ts`, `rooms/sync-service.ts` |
| Opaque choice and generated ability handles | `projection/choice-view.ts`, `wire-identifiers.ts` |
| Full-state inspection boundary | `projection/debug-channel.ts` |
| Client version/audience/ordering checks | `apps/game-client/socket.ts`, `store/gameStore.ts` |

See the [projection supplement](protocol-projection-architecture.md) for decisions and the [Milestone 1 report](phase-1-status-2026-10-26.md) for evidence.
