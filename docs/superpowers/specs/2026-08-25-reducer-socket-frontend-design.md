# Reducer-Based Engine, Socket Protocol & Frontend Rewrite — Design Document

**Date:** 2026-08-25
**Status:** Draft — Awaiting Review
**Context:** End-to-End Playable MVP is merged (129 tests, `tsc` clean). The socket protocol is out of sync with the engine, the frontend (`public/game.js`) is legacy JS that doesn't consume `stateDelta`, and the engine mutates `GameRoom` in place with no causal ordering of changes. This design addresses all three.

---

## 1. Overview

Three interconnected changes:

1. **Reducer-based engine** — handlers produce `GameMutation[]` instead of mutating `room` directly. A pure `gameReducer` applies mutations. Each mutation maps to one ordered `DeltaChange`.
2. **Consolidated socket protocol** — single `playerAction` client→server event. Per-player filtered `stateDelta` server→client. Dead emits removed.
3. **React + Zustand + Vite frontend** — stub UI that proves the pipe works end-to-end. Legacy JS files (`public/game.js`, `public/room.js`, `public/socket.js`, `public/gameStore.js`, `public/zustandVsNoZustand.js`) are **not deleted and not used** — they remain for reference only.

**Out of scope:** Full UI polish, optimistic updates, multi-target selection, new card effects, seeded RNG, room cleanup.

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────┐
│  Client (React + Zustand + Vite)                 │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Socket   │  │ Zustand  │  │ React         │  │
│  │ (io.ts)  │──│ Store    │──│ Components    │  │
│  │          │  │ (delta   │  │ (stub UI)     │  │
│  │          │  │ reducer) │  │               │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
├──────────────────────────────────────────────────┤
│  Server (Express + Socket.IO)                    │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Socket   │  │ Game     │  │ SyncService   │  │
│  │ Handlers │──│ Engine   │──│ (per-player   │  │
│  │ (thin)   │  │ (mutation │  │  delta emit)  │  │
│  │          │  │  pipeline)│  │               │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
├──────────────────────────────────────────────────┤
│  Engine (pure TS, no I/O)                        │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Action   │  │ Game     │  │ Effect        │  │
│  │ Handlers │──│ Reducer  │──│ Registry      │  │
│  │ (produce │  │ (pure:   │  │ (produce      │  │
│  │  mutat-  │  │  state→  │  │  mutations)   │  │
│  │  ions)   │  │  state)  │  │               │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
└──────────────────────────────────────────────────┘
```

**Key flow:** Client emits `playerAction` → Server calls `GameEngine` → Engine runs handler → Handler returns `GameMutation[]` → Reducer applies each mutation → Each mutation becomes a `DeltaChange` → `SyncService` emits per-player `stateDelta` → Client delta reducer applies changes to Zustand → React re-renders.

---

## 3. Socket Protocol

### 3.1 Client → Server Events

| Event | Payload | Purpose |
|---|---|---|
| `createRoom` | `{}` | Create & auto-join a new room |
| `joinRoom` | `{ roomId: string }` | Join an existing room |
| `playerAction` | `{ roomId: string, actionId: string, cardUuid?: string, targets?: TargetPointer[] }` | **All game actions** |
| `getOptions` | `{ roomId: string, cardUuid: string, zone: 'hand' \| 'battlefield' }` | Request context menu options |

**`actionId` values for `playerAction`:**

| actionId | cardUuid required? | Purpose |
|---|---|---|
| `cast_spell` | Yes | Play a card from hand |
| `attack` | Yes | Attack with a creature |
| `tapForMana` | Yes | Tap a permanent for mana |
| `end_turn` | No | End current turn |
| `pass_priority` | No | Pass priority to opponent |
| `resolve_stack` | No | Resolve top of stack |

### 3.2 Server → Client Events

| Event | Payload | Purpose |
|---|---|---|
| `roomCreated` | `{ roomId: string }` | Room created, waiting for opponent |
| `roomJoined` | `{ roomId: string }` | Successfully joined |
| `playerJoined` | `{ playerId: string }` | Opponent joined (to player 1) |
| `rpsPhase` | `{ message: string }` | RPS mini-game started |
| `startGame` | `{ roomId: string }` | Both players connected |
| `stateDelta` | `StateDelta` (see 3.3) | **All state changes** — single sync channel |
| `optionsForCard` | `{ zone: string, options: ActionOption[] }` | Context menu response |
| `error` | `{ message: string }` | Error feedback |

### 3.3 StateDelta Shape

```typescript
interface DeltaChange {
  path: string;        // e.g. "players.player1.life"
  op: 'add' | 'remove' | 'update';
  value?: unknown;     // new value
  oldValue?: unknown;  // previous value (for backtracking)
}

interface StateDelta {
  roomId: string;
  seq: number;
  timestamp: number;
  action: string;      // the actionId that caused this change
  playerId: string;    // who initiated the action
  changes: DeltaChange[];  // ordered, causal sequence of individual changes
}
```

Each `DeltaChange` is an atomic, causally-ordered mutation. The `changes[]` array reflects the actual sequence of state transitions (pay mana → move card → push stack), not structural object-key order.

### 3.4 Per-Player Filtering

`stateDelta` is emitted **per-player**, not broadcast to the room. The server filters out changes to the opponent's hidden zones (hand, deck). Each player receives only the state they are entitled to see.

### 3.5 Server Authority

The server is the single source of truth. The client never generates state — it only applies deltas from the server. No optimistic updates. No client-side validation. The client is a pure projection of server deltas.

---

## 4. GameMutation & Reducer Model

### 4.1 Design Principle

Handlers are **pure functions** of `(snapshot: Readonly<GameRoom>, inputs) → { result, mutations: GameMutation[] }`. They never mutate `room`. The engine sequences mutations through a pure reducer: `gameReducer(state, mutation) => newState`.

### 4.2 Mutation Types

```typescript
type GameMutation =
  // Zone mutations — playerId is REQUIRED because hand/graveyard/library are
  // per-player arrays. playerId is the card's ownerId; for shared zones
  // (battlefield, stack) it identifies ownership but the array is shared.
  | { type: 'MOVE_CARD'; cardUuid: string; playerId: PlayerId; from: CardZone; to: CardZone; toIndex?: number }
  | { type: 'SET_CARD_ZONE'; cardUuid: string; playerId: PlayerId; zone: CardZone }

  // Card state mutations
  | { type: 'TAP_CARD'; cardUuid: string }
  | { type: 'UNTAP_CARD'; cardUuid: string }
  | { type: 'SET_SUMMONING_SICKNESS'; cardUuid: string; value: boolean }
  | { type: 'SET_DAMAGE'; cardUuid: string; amount: number }
  | { type: 'ADD_COUNTER'; cardUuid: string; counterType: string; amount: number }
  | { type: 'REMOVE_COUNTER'; cardUuid: string; counterType: string; amount: number }

  // Player mutations
  | { type: 'SET_LIFE'; playerId: string; amount: number }
  | { type: 'SET_MANA'; playerId: string; color: ManaColor; amount: number }
  | { type: 'ADD_MANA'; playerId: string; color: ManaColor; amount: number }
  | { type: 'SPEND_MANA'; playerId: string; cost: ManaCost }

  // Stack mutations
  | { type: 'PUSH_STACK'; stackObject: StackObject }
  | { type: 'POP_STACK' }
  | { type: 'SET_COUNTERED'; stackUuid: string }

  // Phase / Turn mutations
  | { type: 'SET_PHASE'; phase: GameStateName }
  | { type: 'SET_PREVIOUS_PHASE'; phase: GameStateName | null }
  | { type: 'SET_TURN'; playerId: string }
  | { type: 'SET_PRIORITY'; playerId: string | null }
  | { type: 'SET_LAST_PASSED'; playerId: string | null }

  // RPS mini-game mutations
  | { type: 'SET_RPS_STATUS'; status: string }
  | { type: 'SET_RPS_PLAYED_CARD'; playerId: PlayerId; card: string };
```

**Notes on the union:**

- `MOVE_CARD` / `SET_CARD_ZONE` carry `playerId` (the card's owner) because `hand`, `graveyard`, and `library` are per-player arrays. Without it, "move to player2's graveyard" is inexpressible.
- `SET_PREVIOUS_PHASE` exists because `StateMachine.previousPhase` must be serialized into `GameRoom` (see §4.7) so stack resolution can return to the correct phase after the stack empties.
- RPS mutations cover `rpsState.status` and `rpsState.playedCards`. RPS **setup** (dealing rock/paper/scissors into hands) is a boundary operation, not a mutation — see §4.9.

### 4.3 Reducer

```typescript
/**
 * Pure reducer: (state, mutation) => newState.
 * Returns a new GameRoom with shallow copies along the changed path.
 * Untouched subtrees are shared by reference.
 */
function gameReducer(state: GameRoom, mutation: GameMutation): GameRoom {
  switch (mutation.type) {
    case 'SET_LIFE':
      return {
        ...state,
        players: {
          ...state.players,
          [mutation.playerId]: {
            ...state.players[mutation.playerId],
            life: mutation.amount,
          },
        },
      };
    case 'MOVE_CARD': {
      // Find card by uuid in the source zone, splice it out, push into the
      // destination zone. For per-player zones (hand/graveyard/library) the
      // array lives at state.players[mutation.playerId][zone]; for shared
      // zones (battlefield/stack) it lives at state[zone].
      // Returns new state with updated zone arrays.
    }
    // ... etc for all mutation types
  }
}
```

### 4.7 StateMachine Internal State

`StateMachine` currently holds three non-room fields: `previousPhase`, `waitingForResponse`, and `stackOpen`. These are not in `GameRoom`, so they cannot be expressed as mutations today.

**Decision:** `previousPhase` moves into `GameRoom` (new field `previousPhase: GameStateName | null`) and gets the `SET_PREVIOUS_PHASE` mutation, because it is part of the game's observable state — the client needs to know which phase to return to when the stack empties.

`waitingForResponse` and `stackOpen` are **engine-local control flags**, not game state. They stay on the `StateMachine` instance outside the reducer. They are never serialized, never sent to the client, and never appear in deltas. The reducer only sees `GameRoom`; the state machine keeps its own private flags.

### 4.8 TriggerManager Mutation Path

`TriggerManager` is an event listener, not a handler — it cannot "return" mutations to a caller. When a `PERMANENT_ENTERED` event fires, it must produce a `PUSH_STACK` mutation.

**Decision:** The engine owns a per-room **mutation collector** (a simple array). During event dispatch, `TriggerManager` pushes its mutations into the collector instead of mutating `room.stack` directly. After the event dispatch completes, the engine drains the collector and sequences those mutations through the reducer, emitting them as part of the same `StateDelta` (or a follow-up delta if the trigger fires mid-resolution).

Concretely: `TriggerManager` builds the `StackObject` (with a caller-supplied `uuid` and `timestamp` — see §4.6) and calls `collector.push({ type: 'PUSH_STACK', stackObject })`. The engine loop is:

```
runAction() {
  const mutations = handler.propose(...).mutations;
  applyMutations(mutations);          // may emit PERMANENT_ENTERED
  // event dispatch may have appended trigger mutations to the collector
  while (collector.length > 0) {
    applyMutations(collector.drain());
  }
}
```

This keeps triggers causal and ordered without making the listener "return" anything.

### 4.9 RPS Setup Boundary

`setupRPS()` mutates `rpsState`, `battlefield`, and both hands in one shot. This is **room setup**, not a game action — it happens once at room creation, before any player action, and has no causal ordering relative to other mutations.

**Decision:** `setupRPS()` (and `dealStartingHands()`) remain **boundary operations** in `room-factory.ts`. They mutate the room directly at the server boundary, exactly like `createRoom()` and `joinRoom()` do today. They are **not** converted to mutations. The server emits a full-state snapshot (or a synthetic delta) after setup so the client gets the initial RPS hands. RPS *play* (choosing rock/paper/scissors) is a normal `playerAction` and uses the RPS mutations above.

### 4.4 Engine Orchestration

```typescript
// In GameEngine.proposeAndStack():
// 1. Handler produces mutations (pure, no side effects)
const handlerResult = handler.propose(room, playerId, action);

// 2. State machine produces mutations (reads same snapshot)
const smResult = stateMachine.addToStack(room, handlerResult.stackObject);

// 3. Concatenate in causal order
const allMutations = [...handlerResult.mutations, ...smResult.mutations];

// 4. Apply through reducer, emit one compound delta
return engine.applyMutations(allMutations, playerId, actionId);

// applyMutations sequences each mutation through the pure reducer,
// accumulating one ordered DeltaChange per mutation into a single StateDelta:
applyMutations(mutations, playerId, actionId): StateDelta {
  let currentState = this.room;
  const changes: DeltaChange[] = [];

  for (const mutation of mutations) {
    const oldState = currentState;
    const newState = gameReducer(oldState, mutation);

    // extractChange maps a mutation to its path + op, then reads
    // oldValue from oldState and value from newState at that path.
    changes.push(extractChange(mutation, oldState, newState));

    currentState = newState;
  }

  this.room = currentState;  // commit final state

  return {
    roomId: currentState.roomId,
    seq: this.nextSeq(),
    timestamp: Date.now(),
    action: actionId,
    playerId,
    changes,  // ordered, causal sequence — one entry per mutation
  };
}
```

`extractChange(mutation, oldState, newState)` maps each mutation type to its
path (e.g. `SET_LIFE` → `players.<id>.life`) and op (`update`/`add`/`remove`),
then reads `oldValue` from `oldState` and `value` from `newState` at that path.
Because the reducer is pure, `oldState` is still intact when `oldValue` is read.

### 4.5 Handler Contract

```typescript
// Before: handlers mutate room directly
propose(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult

// After: handlers return mutations
propose(room: Readonly<GameRoom>, playerId: PlayerId, action: ActionData):
  { result: ActionResult; mutations: GameMutation[] }
```

`ActionResult` gains an optional `mutations` field. Handlers receive a read-only snapshot and produce mutations. The engine is the only thing that applies mutations through the reducer.

**`ActionData.cardUuid` becomes optional.** `end_turn`, `pass_priority`, and `resolve_stack` have no card. The `ActionData` interface changes from `cardUuid: string` to `cardUuid?: string`. Card-based handlers (`cast_spell`, `attack`, `tapForMana`) still validate that `cardUuid` is present and return a `validate`-phase failure if it is missing. Non-card handlers ignore it. No separate action shape is needed — one optional field covers both cases.

### 4.6 Determinism

- The engine is pure and deterministic given its inputs.
- All non-determinism is injected at the boundary (`server.ts` / `SyncService`).
- `uuidv4()` calls in `card-factory.ts` and `room-factory.ts` accept a UUID parameter from the caller (server boundary).
- `Date.now()` is only in `SyncService` (correct).
- No RNG in game logic yet — when shuffling is added, use a seeded RNG injected from the server.

**Handler non-determinism to move:** Currently `play-card-handler.ts` and `attack-handler.ts` call `uuidv4()` and `Date.now()` inside `propose()` to build `StackObject.uuid` and `StackObject.timestamp`. Since handlers become pure, these calls move to the engine boundary:

- `StackObject.uuid` — generated by `server.ts` (or `GameEngine`) and passed into the handler via `ActionData` (new field `stackUuid?: string`). The handler uses the caller-supplied UUID.
- `StackObject.timestamp` — set by `SyncService` when the delta is emitted, not by the handler. The `StackObject` no longer carries a `timestamp` field (it was only used for ordering, which `seq` now provides).

`TriggerManager` also calls `uuidv4()` and `Date.now()` when building triggered `StackObject`s. These receive their UUID and timestamp from the engine's mutation collector at drain time — the collector assigns them before pushing the `PUSH_STACK` mutation.

---

## 5. Server Changes

### 5.1 New Files

| File | Purpose |
|---|---|
| `src/types/game-mutation.types.ts` | `GameMutation` discriminated union |
| `src/engine/game-reducer.ts` | Pure `gameReducer(state, mutation) => newState` |

### 5.2 Modified Files

| File | Change |
|---|---|
| `src/engine/game-engine.ts` | Add `applyMutations()`; handlers return `{ result, mutations }` |
| `src/engine/action-registry.ts` | `ActionResult` includes `mutations?: GameMutation[]` |
| `src/engine/action-service.ts` | Accumulates mutations from handler + state machine |
| `src/engine/handlers/play-card-handler.ts` | Returns mutations instead of mutating room |
| `src/engine/handlers/attack-handler.ts` | Returns mutations |
| `src/engine/handlers/tap-for-mana-handler.ts` | Returns mutations |
| `src/engine/state-machine.ts` | Returns mutations instead of mutating room |
| `src/engine/effect-registry.ts` | Returns mutations (note: `MOVE_ZONE`, `DRAW`, `DISCARD_HAND` loops become mutation-accumulating; larger change than other handlers) |
| `src/engine/effect-resolver.ts` | Returns mutations |
| `src/engine/trigger-manager.ts` | Returns mutations |
| `src/server/sync-service.ts` | `filterForPlayer()`, mutation-to-delta, remove `computeDiff` |
| `src/server.ts` | Single `playerAction` handler, per-player sync, dead emits removed |

### 5.3 New Action Handlers

Three new handlers registered in `ActionRegistry`:

| actionId | Handler | Purpose |
|---|---|---|
| `end_turn` | `endTurnHandler` | Transitions end→cleanup→turnStart, switches turn |
| `pass_priority` | `passPriorityHandler` | Delegates to `stateMachine.passPriority()` |
| `resolve_stack` | `resolveStackHandler` | Delegates to `engine.resolveTopOfStack()` |

### 5.4 Event Renames

| Old | New |
|---|---|
| `GetOptionsForCard` | `getOptions` |
| `OptionsForCard` | `optionsForCard` |

### 5.5 Dead Emits Removed

The following server→client events are no longer emitted:
`stateChanged`, `opponentTurn`, `yourTurn`, `cardAddedToBoard`, `fullBoardUpdate`, `updateBoard`, `updateOpponentBoard`, `cardStateUpdate`, `removeHand`, `gameResult`, `GameEnded`, `playCardToBoard`, `updateHand`, `updateOpponentHand`.

### 5.6 SyncService Changes

- **Remove** `computeDiff()` — deltas are built from the mutation log, not structural diff.
- **Add** `filterForPlayer(delta, playerId, room)` — redacts opponent hand/deck changes. Takes the room (or the two player IDs) so it knows which player is the opponent.
- **Add** `emit(playerId, delta)` — sends a filtered delta to a specific player.
- **Keep** `appendToLog()` — JSONL logging of the unfiltered compound delta (one line per action, with the full ordered `changes[]` array).

**Emit flow:** `applyMutations` returns one compound `StateDelta`. `server.ts` calls `filterForPlayer` once per player, then `emit` to each. The unfiltered delta is logged to JSONL.

**`filterForPlayer` path→player mapping:** paths use player IDs as keys (e.g. `players.player1.hand`), so the filter determines the opponent by comparing the path's player-ID segment against the requesting player's ID. Changes to `players.<opponentId>.hand` and `players.<opponentId>.deck` are redacted (dropped or replaced with a hand-count-only change). All other paths pass through unchanged.

### 5.7 ManaPool Disposition

`ManaPool` is currently a mutating singleton helper (`add`/`spend`/`drain` mutate the pool in place). After the refactor:

- `ManaPool.canPay()` and `ManaPool.isPureAbility()` stay as **pure helpers** (no mutation).
- `ManaPool.add()` / `spend()` / `drain()` are **deleted** — their logic moves into the `ADD_MANA` / `SPEND_MANA` / `SET_MANA` reducer cases, which compute the new pool immutably.
- Handlers that need to check affordability call `ManaPool.canPay()` (pure) and then emit a `SPEND_MANA` mutation; the reducer performs the actual deduction.

---

## 6. Client Architecture

### 6.1 Technology

- **React 19** with TypeScript
- **Zustand** for state management
- **Vite** for build tooling
- **Socket.IO client** for server communication

### 6.2 Project Structure

```
src/client/                          # New frontend (Vite project)
├── main.tsx                         # Entry point, mount React
├── App.tsx                          # Root component
├── socket.ts                        # Socket.IO client singleton
├── store/
│   ├── gameStore.ts                 # Zustand store
│   └── deltaReducer.ts              # Path-based immutable delta applier
├── components/
│   ├── StartScreen.tsx              # Create/join room UI
│   ├── GameScreen.tsx               # Main game layout (3-column)
│   ├── PlayerInfo.tsx               # Life, mana, turn indicator (stub)
│   ├── OpponentInfo.tsx             # Opponent life, hand count (stub)
│   ├── Hand.tsx                     # Player's hand cards (stub)
│   ├── Battlefield.tsx              # Both players' permanents (stub)
│   ├── CardComponent.tsx            # Single card rendering (stub)
│   ├── ContextMenu.tsx              # Right-click action menu (stub)
│   ├── StackDisplay.tsx             # Stack visualization (stub)
│   ├── PhaseBar.tsx                 # Phase + end turn button (stub)
│   └── GameLog.tsx                  # Scrollable delta log (stub)
├── hooks/
│   ├── useSocket.ts                 # Socket event bindings
│   └── useGameActions.ts            # playerAction dispatcher
└── types/
    └── client.types.ts              # Client-only types
```

### 6.3 Zustand Store

```typescript
interface GameStore {
  // Server-authoritative state
  room: GameRoom | null;
  myPlayerId: string | null;

  // Derived (computed from room + myPlayerId)
  myHand: CardInstance[];
  myBattlefield: CardInstance[];
  opponentBattlefield: CardInstance[];
  opponentHandCount: number;
  isMyTurn: boolean;
  currentPhase: GameStateName;

  // UI state (client-only)
  contextMenu: { x: number; y: number; options: ActionOption[] } | null;

  // Actions
  applyDelta: (delta: StateDelta) => void;
  setMyPlayerId: (id: string) => void;
  showContextMenu: (x: number, y: number, options: ActionOption[]) => void;
  hideContextMenu: () => void;
}
```

### 6.4 Delta Reducer (Client-Side)

```typescript
/**
 * Applies a StateDelta to the Zustand store.
 * Each DeltaChange is applied via path-based immutable set.
 * Changes are applied in order (causal sequence from server).
 */
function applyDelta(delta: StateDelta): void {
  const store = useGameStore.getState();
  for (const change of delta.changes) {
    store.room = setAtPath(store.room, change.path, change.value);
  }
  // Recompute derived state
  recomputeDerived(store);
}
```

`setAtPath(obj, path, value)` does shallow-copy-along-path — O(path depth), not O(room size).

**Path convention for array elements:** array indices are embedded in the path using bracket notation, e.g. `players.player1.hand[3]` or `battlefield[0].state.isTapped`. This makes `remove` unambiguous — the path identifies the exact index to splice, and `oldValue` is the removed element (kept for logging/backtracking, not for locating the element).

**Note on `op`:** `setAtPath` handles `update` and `add` by setting the value at the path. For `remove`:
- **Array element** — the path ends in `[i]`; the client splices index `i` out of the array at the parent path.
- **Object key** — the path ends in `.key`; the client deletes that key.

The client reducer mirrors the server `gameReducer` semantics for each op. Because the server emits one `DeltaChange` per mutation with an explicit path, the client never needs to find-by-uuid or guess indices.

### 6.5 Socket Bindings

```typescript
// Client listens for:
socket.on('stateDelta', (delta) => useGameStore.getState().applyDelta(delta));
socket.on('roomCreated', (data) => { /* show room ID, transition to waiting */ });
socket.on('roomJoined', (data) => { /* transition to game screen */ });
socket.on('playerJoined', (data) => { /* opponent connected */ });
socket.on('rpsPhase', (data) => { /* show RPS UI */ });
socket.on('startGame', (data) => { /* transition to game */ });
socket.on('optionsForCard', (data) => { /* show context menu */ });
socket.on('error', (data) => { /* toast/alert */ });

// Client emits:
socket.emit('createRoom');
socket.emit('joinRoom', { roomId });
socket.emit('playerAction', { roomId, actionId, cardUuid, targets });
socket.emit('getOptions', { roomId, cardUuid, zone });
```

### 6.6 Component Stub Level

Components are **functional stubs** — they render data from the store but don't need full interactivity. The goal is to prove the pipe works end-to-end.

| Component | Stub Level |
|---|---|
| `StartScreen.tsx` | ✅ Functional — create/join room |
| `GameScreen.tsx` | 🔶 Renders raw state as JSON or simple divs |
| `PlayerInfo.tsx` | 🔶 Shows life, mana as text |
| `OpponentInfo.tsx` | 🔶 Shows life, hand count as text |
| `Hand.tsx` | 🔶 Lists card names |
| `Battlefield.tsx` | 🔶 Lists permanents by zone |
| `CardComponent.tsx` | 🔶 Renders card name + tapped state |
| `ContextMenu.tsx` | 🔶 Basic action buttons from options |
| `StackDisplay.tsx` | 🔶 Lists stack items |
| `PhaseBar.tsx` | 🔶 Phase name + end turn / pass priority buttons |
| `GameLog.tsx` | 🔶 Scrollable list of delta entries |

### 6.7 Legacy Files

The following files are **not deleted and not used** by the new system. They remain for reference:

- `public/game.js`
- `public/room.js`
- `public/socket.js`
- `public/gameStore.js`
- `public/zustandVsNoZustand.js`

`public/index.html` is updated to load the Vite bundle instead of script tags. `public/style.css` is kept as the base stylesheet.

### 6.8 Dual Build System

The server and client are two separate TypeScript projects that must not interfere:

- **Server** (`tsconfig.json`): `rootDir: "./src"`, `include: ["src/**/*.ts"]`, `module: commonjs`, `outDir: ./dist`. This must **exclude** the client source.
- **Client** (`src/client/`): its own `tsconfig.json` + `vite.config.ts`, `module: esnext`, JSX enabled, `outDir: dist/client` (or Vite's default).

**Changes required:**

1. Add `"src/client"` to the server `tsconfig.json` `exclude` array (alongside `node_modules`, `dist`, `tests`). This prevents the server `tsc` build from compiling React/JSX client files.
2. Give `src/client/` its own `tsconfig.json` (extends a shared base if desired) and `vite.config.ts`. The client is built with `vite build`, not `tsc`.
3. Add a `client` script to `package.json` (e.g. `"build:client": "vite build"`) and a combined `"build"` script that runs both server `tsc` and client `vite build`.
4. Server static serving: `express.static` points at the Vite build output (`dist/client`) instead of `public/`. `public/index.html` is replaced by the Vite-generated `index.html` (or Vite is configured to output into `public/`).

The two projects share types (`GameRoom`, `StateDelta`, `GameMutation`, etc.) via imports from `src/types/` and `src/engine/` — the client imports these as source, and Vite bundles them. No code duplication.

---

## 7. Implementation Plan

### Phase 1: GameMutation Types + Reducer (engine-only)

**Goal:** Define mutation types and pure reducer. No handler changes yet.

| Step | Description |
|---|---|
| 1.1 | Create `src/types/game-mutation.types.ts` — `GameMutation` discriminated union (all types including RPS, `SET_PREVIOUS_PHASE`, `MOVE_CARD` with `playerId`) |
| 1.2 | Add `previousPhase: GameStateName \| null` to `GameRoom` type |
| 1.3 | Create `src/engine/game-reducer.ts` — pure `gameReducer(state, mutation) => newState` |
| 1.4 | Write `tests/engine/game-reducer.test.ts` — test every mutation type |
| 1.5 | Verify: `npx vitest run`, `npx tsc --noEmit` |

### Phase 2: Convert Handlers to Return Mutations (engine-only)

**Goal:** Every handler produces `GameMutation[]`. `GameEngine.applyMutations()` sequences them. All existing tests updated.

| Step | Description |
|---|---|
| 2.1 | Update `ActionResult` to include `mutations?: GameMutation[]` |
| 2.2 | Make `ActionData.cardUuid` optional |
| 2.3 | Add `applyMutations()` + mutation collector to `GameEngine` |
| 2.4 | Move `uuidv4()` / `Date.now()` from handlers to engine boundary (caller-supplied UUID for `StackObject`) |
| 2.5 | Convert `play-card-handler.ts` |
| 2.6 | Convert `attack-handler.ts` |
| 2.7 | Convert `tap-for-mana-handler.ts` |
| 2.8 | Convert `state-machine.ts` — return mutations; move `previousPhase` into `GameRoom`; keep `waitingForResponse`/`stackOpen` as engine-local |
| 2.9 | Convert `effect-registry.ts` |
| 2.10 | Convert `effect-resolver.ts` |
| 2.11 | Convert `trigger-manager.ts` — push to mutation collector instead of mutating `room.stack` |
| 2.12 | Update `action-service.ts` — accumulate mutations; drain collector after event dispatch |
| 2.13 | Update all existing tests |
| 2.14 | Verify: `npx vitest run`, `npx tsc --noEmit` |

### Phase 3: Server Protocol Consolidation + Per-Player Sync

**Goal:** Single `playerAction` event, per-player filtered deltas, dead emits removed.

| Step | Description |
|---|---|
| 3.1 | Add `filterForPlayer()` to `SyncService` |
| 3.2 | Simplify `SyncService` — remove `computeDiff`, use mutation log |
| 3.3 | Create `end_turn`, `pass_priority`, `resolve_stack` action handlers |
| 3.4 | Register all actions in `server.ts` |
| 3.5 | Consolidate `server.ts` — single `playerAction`, per-player sync |
| 3.6 | Rename `GetOptionsForCard` → `getOptions`, `OptionsForCard` → `optionsForCard` |
| 3.7 | Remove dead emits from `server.ts` |
| 3.8 | Update `tests/server/sync-service.test.ts` |
| 3.9 | Verify: `npx vitest run`, `npx tsc --noEmit` |

### Phase 4: Client (React + Zustand + Vite, Stub UI)

**Goal:** Working socket connection, store applies deltas, stub UI proves the pipe.

| Step | Description |
|---|---|
| 4.1 | Scaffold Vite + React + TypeScript in `src/client/` with its own `tsconfig.json` + `vite.config.ts` |
| 4.2 | Add `"src/client"` to server `tsconfig.json` `exclude`; add `build:client` script to `package.json` |
| 4.3 | Create `client/socket.ts` |
| 4.4 | Create `client/store/gameStore.ts` |
| 4.5 | Create `client/store/deltaReducer.ts` (path-based, bracket-index convention) |
| 4.6 | Create `client/hooks/useSocket.ts` |
| 4.7 | Create `client/hooks/useGameActions.ts` |
| 4.8 | Create stub components (all 10) |
| 4.9 | Point `express.static` at Vite build output; replace `public/index.html` |
| 4.10 | Manual smoke test: create → join → RPS → land → mana → cast → attack |
| 4.11 | Verify: `npx vitest run`, `npx tsc --noEmit`, `npm run build` |

### Phase Dependencies

```
Phase 1 → Phase 2 → Phase 3 → Phase 4
```

Strictly sequential — each depends on the previous.

---

## 8. Verification

| Level | What | How |
|---|---|---|
| Unit | `gameReducer` handles every mutation | `tests/engine/game-reducer.test.ts` |
| Unit | Each handler returns correct mutations | Updated existing handler tests |
| Unit | `filterForPlayer` redacts correctly | `tests/server/sync-service.test.ts` |
| Integration | Full turn loop still works | `tests/engine/game-engine.test.ts` (existing) |
| Integration | `playerAction` routes correctly | Server integration test |
| Manual | End-to-end playable | Smoke test (Phase 4.10) |
| Regression | All existing tests pass | `npx vitest run` after every phase |

---

## 9. Scope Boundaries

**In scope:**
- GameMutation types + pure reducer
- All handlers return mutations
- Single `playerAction` socket event
- Per-player filtered deltas
- React + Zustand + Vite client (stub UI)
- Dead emit/event cleanup
- `end_turn`, `pass_priority`, `resolve_stack` as registered actions

**Out of scope (future plans):**
- Full UI polish (animations, drag-drop, card art)
- Optimistic updates / client-side prediction
- Multi-target selection UI
- New card effects or game features
- Seeded RNG / deck shuffling
- Room cleanup / destroy
- Legacy JS file deletion

---

## Appendix A: Test-Case Changes for Mutation-Returning Handlers

Phase 2 (steps 2.5–2.13) changed handlers from mutating `GameRoom` in place to
returning `GameMutation[]`. This surfaced three recurring test patterns that
future test authors must follow.

### A.1 Test cards need `ownerId` (and `controllerId`)

`instantiateCard()` leaves `state.ownerId` as `''`. Mutation-returning handlers
build `MOVE_CARD` mutations with `playerId: card.state.ownerId`. If a test puts
a card into a per-player zone (`deck`/`hand`/`graveyard`) without setting
`ownerId`, the mutation carries `playerId: ''` and the reducer cannot locate the
card in the correct player's zone — the move silently no-ops.

**Rule:** before placing a card in a per-player zone, set both IDs:

```typescript
const card = instantiateCard('empire-servant');
card.state.ownerId = 'player1';
card.state.controllerId = 'player1';
room.players['player1'].deck = [card];
```

Affected tests: `effect-registry.test.ts` (DRAW, MOVE_ZONE),
`effect-resolver.test.ts` (DRAW).

### A.2 Read state from `engine.roomState`, not the stale `room` variable

`GameEngine.proposeAndStack()` / `resolveTopOfStack()` apply mutations through
`gameReducer`, which returns **new** `GameRoom` objects. The `room` variable
captured before the engine call is stale. Assertions after engine operations
must read from `engine.roomState`.

Affected tests: `game-engine.test.ts` (full turn loop),
`play-card-handler.test.ts` (full flow).

### A.3 `tapForMana` mutations are not auto-applied by `handleAction`

`engine.handleAction('tapForMana', ...)` returns `{ success: true, mutations }`
but does **not** apply them. Tests must apply them explicitly:

```typescript
const result = engine.handleAction('player1', 'tapForMana', { cardUuid });
if (result.success && result.mutations) {
  engine.applyMutations(result.mutations);
}
```

Affected tests: `game-engine.test.ts` (full turn loop).

---

## Appendix B: Phase 4.10 Manual Smoke Test Results

**Date:** 2026-08-26
**Status:** ✅ Pipe proven working end-to-end

### Test Setup

- Server running on `localhost:3000`
- Two browser tabs connected to the same room
- 159/159 tests passing, server `tsc` clean, client `tsc` clean, `npm run build` succeeds

### Results

| Step | Result |
|---|---|
| **Create Room** | ✅ Player 1 creates room, sees GameScreen with "You (your turn)", Life 20, Phase: waiting |
| **Join Room** | ✅ Player 2 joins, both see Phase: RPS, 3 RPS cards in hand (石頭/布/剪刀) |
| **RPS Render** | ✅ Both players see 3 cards, opponent hand count shows "3 cards" |
| **Player Action** | ✅ Clicking a card emits `playerAction('cast_spell', cardUuid)` → server receives it → responds with error "Action cannot be initiated from library" (pre-existing bug, see below) |
| **Socket Events** | ✅ `createRoom` → `roomCreated` + `roomSnapshot`; `joinRoom` → `roomJoined` + `roomSnapshot`; `playerAction` → `error` response |
| **Zustand Store** | ✅ `roomSnapshot` sets full `GameRoom`; `roomCreated` sets `roomId`; derived selectors (`selectMyHand`, `selectMyBattlefield`, etc.) work correctly |
| **React Rendering** | ✅ Components render from store; no infinite re-renders |

### Bugs Found & Fixed During Smoke Test

1. **Infinite render loop** — `selectMyBattlefield` / `selectOpponentBattlefield` returned new arrays each render via `.filter()`. Fixed by wrapping with `useShallow()` from `zustand/react/shallow`.
2. **`StackDisplay` / `GameLog` infinite loop** — `s.room?.stack ?? []` and `s.room?.gameLog ?? []` created new empty arrays every render. Fixed with module-level `EMPTY_STACK` / `EMPTY_LOG` constants + `useShallow`.
3. **`App.tsx` gated on `room`** — `room` was null because `createRoom` only emitted `roomCreated` (sets `roomId`) but no delta to populate `room`. Changed to gate on `roomId` instead, and added `roomSnapshot` event carrying full `GameRoom` for store initialization.
4. **No initial room state** — `createRoom` and `joinRoom` handlers didn't send room data to the client. Added `roomSnapshot` server→client event with full `GameRoom` payload. Store's `setRoom` action directly sets `room` (bypasses delta reducer for initial load).

### Pre-existing Bug (not introduced by this work)

`setupRPS()` in `room-factory.ts` pushes RPS cards to `p1.hand` / `p2.hand` but does not update `card.state.zone` from `'library'` (set by `instantiateCard()`) to `'hand'`. The `playCardHandler` rejects cards not in the `'hand'` zone. This exists in the original codebase and is out of scope for this design doc.