# Concept Map — where things are and how they run

**Status:** Current · Architecture modernization 9/9 complete · **Date:** 2026-10-22

> This is the **navigability map**. It answers two questions only:
> **"Where does concept X live?"** and **"How does flow Y run end-to-end?"**
>
> It describes **what is**, never **what should be**. Forward-looking work lives in
> [`architecture-modernization-roadmap-2026-10-19.md`](architecture-modernization-roadmap-2026-10-19.md).
> Deep per-type detail lives in [`../ARCHITECTURE.md`](../ARCHITECTURE.md).
>
> **Maintenance rule:** when a slice moves code, update the *Locations* column here in the
> **same commit**. The *Flow* and *Owns* columns are stable and rarely change.

---

## 0. The mental model in one paragraph

A player command enters through the `server.ts` transport adapter, which calls
**`RoomRuntime.executePlayerAction`**. The runtime resolves the stable player identity, owns the
room's engine, and calls **`GameEngine.executePlayerAction`** (the single public game API). The
engine routes to an **action handler** (validate → propose) or a **command** in `player-commands.ts`.
Handlers are pure: they return **`GameMutation[]`** and never touch state. `GameEngine.applyMutations`
sequences each mutation through the pure **`gameReducer`**, which returns a **new `GameRoom`**.
After a batch commits, **`deriveAppliedEvents`** projects canonical events from the before/after
diff and the **`EventBus`** dispatches them. **`TriggerManager`** discovers triggers and pushes
new mutations into a collector; **`runRulesCheckpoint`** settles state-based actions and schedules
triggers, looping until stable. **`SyncService`** turns the applied mutations into per-player
**`StateDelta`s** and emits them to clients.

**The one rule that explains everything:** *state changes are mutations; events are derived from
state changes; triggers are discovered from events.* Nothing hand-emits events.

---

## 1. The canonical spine (memorize this)

```
player command
  → GameEngine.executePlayerAction          (src/engine/game-engine.ts)
  → ActionRegistry handler / player-commands (validate → propose)
  → GameMutation[]
  → GameEngine.applyMutations
  → MutationCommitter.commit                 (src/engine/mutation-committer.ts)
  → reduceGameOperation (gameReducer)        (src/engine/game-reducer.ts)
  → deriveAppliedEvents                      (src/engine/applied-events.ts)
  → EventBus.emit                            (src/engine/event-bus.ts)
  → TriggerManager.onEvent → discoverTriggers(src/engine/trigger-manager.ts)
  → mutationCollector
  → runRulesCheckpoint                       (src/engine/rules-checkpoint.ts)
  → triggerQueue → priority passes → planStackResolution
  → SyncService → StateDelta → client
```

If you understand this line, you understand the engine. Every concept below is a detail hanging
off one of these stages.

---

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
  → server.ts parseActionPacket
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

- **`src/types/`** — pure contracts, no runtime code.
- **`src/engine/`** — game logic; **no** Socket.IO, Express, store, or transport imports.
- **`src/library/`** — card data loading, validation, normalization, immutable catalog publication,
  and instance construction; it may depend on `types` and stable `shared` contracts, not `engine`.
- **`src/server.ts`** — transport decoding/emission and application composition only.
- **`src/server/room-runtime.ts`** — multiplayer application lifecycle and engine coordination.
- **Other `src/server/` modules** — focused storage, sync, reconnect, and packet parsing.
- **`src/shared/`** — rule-aware queries + presentation helpers (used by engine, server, client).
- **`src/client/`** — React + Zustand; projected state only.

Rules may call another rule module's explicit query/planning API. They must not reach into
transport or storage.

Catalog blueprints are shared and recursively frozen. Tests needing synthetic card content replace
the fixture's whole `blueprint` object with a spread copy; they do not modify nested cached fields.

---

## 6. Known rough edges (so you don't get surprised)

These are **current facts**, not plans. See the roadmap for remediation.

The `GameRoom` boundary was reassessed in Slice 9 and retained: it contains serialized match and
recovery state, while `RoomRuntime` and focused server modules already own all process resources.

- **`MutationCommitter.commitPreparedMutations` is large** — it normalizes ids, applies, derives
  events, records history, and publishes in one method.
- **Rule extension registries are process-level vocabularies today.** Slice 9 retained combat,
  damage, target-modifier, replacement-operation, and numeric-query registries because current
  production composition has no per-match variants. Migrate one only when a real match/catalog
  constructor owns distinct instances; see the dated architecture audit.
- **`modifier-pipeline.ts` / `modifier-registry.ts` are stubs** (superseded by the
  continuous-effect pool + characteristic service).
- **Five client runtime rule-query imports still reach into the engine.** They are exact,
  automated exceptions pending evidence for a shared projection/query boundary; see
  [`architecture-import-policy.md`](architecture-import-policy.md).
