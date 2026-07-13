# JS-to-TS Refactoring — Design Document

**Date:** 2026-07-09
**Status:** Draft — Awaiting Review

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Client (Vanilla JS / Future Framework)                 │
│  Communicates via typed Socket.IO events only           │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│  server.ts — Express + Socket.IO                        │
│  Routes socket events → service calls                   │
│  No game logic here                                     │
└──────┬──────────┬──────────┬──────────┬─────────────────┘
       │          │          │          │
┌──────▼──┐ ┌─────▼────┐ ┌──▼──────┐ ┌─▼──────────┐
│StateStore│ │StateMach │ │ActionSvc│ │OptionSvc   │
│get/save  │ │phases    │ │validate │ │getOptions()│
│InMemory  │ │priority  │ │propose  │ │            │
│→Redis   │ │stack     │ │resolve  │ │            │
└──────────┘ └─────┬────┘ └──┬──────┘ └────────────┘
                   │          │
            ┌──────▼──────────▼──────┐
            │     SyncService        │
            │  computeDiff(old, new) │
            │  emit delta to clients │
            │  log delta to file     │
            └────────────────────────┘
```

**Key principles:**
- Engine services have **zero knowledge of Socket.IO** — they work with plain TS types
- `server.ts` is the only file that imports `socket.io` or `express`
- State is stored via `StateStore` interface — `InMemoryStore` now, `RedisStore` later
- Every state change produces a **delta** — sent to clients and logged for replay
- The engine is testable from the command line: import services, call methods, assert state

---

## 2. Module Design

### 2.1 StateStore (`src/server/state-store.ts`)

**Interface:**
```ts
interface StateStore {
  getRoom(roomId: string): GameRoom | undefined;
  saveRoom(room: GameRoom): void;
  deleteRoom(roomId: string): void;
  listRooms(): string[];
}
```

**Implementations:**
- `InMemoryStore` — `Map<string, GameRoom>`, for now
- `RedisStore` (future) — JSON serialized to Redis, same interface

**Why this exists:** The engine never touches a global `rooms` object. All state access goes through the store. Swapping to Redis means writing one new class.

---

### 2.2 StateMachine (`src/engine/state-machine.ts`)

**Responsibility:** Turn phases, priority, stack LIFO. No socket knowledge.

**Interface:**
```ts
class StateMachine {
  constructor(roomId: string, player1: PlayerId, player2: PlayerId, eventBus: EventBus);

  // Phase management
  currentPhase: GameStateName;
  transition(to: GameStateName): void;
  nextPhase(): void;

  // Turn management
  currentPlayer: PlayerId;
  switchTurn(): void;
  isPlayerTurn(playerId: PlayerId): boolean;

  // Priority system
  givePriorityTo(playerId: PlayerId): void;
  passPriority(playerId: PlayerId): void;
  resolveCurrentPhase(): void;

  // Stack management
  addToStack(stackObj: StackObject): void;
  resolveStack(actionService: ActionService, room: GameRoom): void;  // Pops each item, calls ActionService.resolveTopOfStack()
  stack: StackObject[];
}
```

**Events emitted (via EventBus):**
- `PHASE_CHANGED` — `{ phase, currentPlayer }`
- `TURN_SWITCHED` — `{ newPlayer }`
- `PRIORITY_GIVEN` — `{ playerId }`
- `STACK_UPDATED` — `{ stack, newAction }`
- `STACK_RESOLVED` — `{ resolvedActions }`

**Key difference from legacy:** The legacy `stateMachine.js` calls `this.io.to(roomId).emit(...)` directly. The TS version emits typed events through `EventBus`. `server.ts` listens and translates to socket events.

**Phase transitions (from legacy):**
```
waiting → RPS → stateTurnStart → stateDrawPhase → stateMainPhase
  → stateBattlePhase → endCombat → stateEndPhase → cleanupStep
  → stateTurnStart (loop)
```
Any phase can transition to `Stack` (if stack is open). `Stack` resolves back to `previousPhase`.

---

### 2.3 ActionService (`src/engine/action-service.ts`)

**Responsibility:** Wraps the existing `ActionRegistry` and `GameEngine` into a clean service interface.

**Interface:**
```ts
class ActionService {
  constructor(eventBus: EventBus);

  // Full action lifecycle
  handleAction(room: GameRoom, playerId: PlayerId, actionType: string, data: ActionData): ActionResult;
  resolveTopOfStack(room: GameRoom): ActionResult;

  // Stack integration
  proposeAndStack(room: GameRoom, playerId: PlayerId, actionType: string, data: ActionData, stateMachine: StateMachine): ActionResult;
}
```

**Flow:**
1. `handleAction` → validate → propose → return result
2. If propose succeeds, caller pushes to stack via `StateMachine.addToStack()`
3. When priority resolves, `resolveTopOfStack` pops and resolves

**Reuses existing:** `ActionRegistry`, `ActionValidator`, `EffectRegistry`, `playCardHandler`

---

### 2.4 OptionService (`src/engine/option-service.ts`)

**Responsibility:** Given a card and its zone, return the list of legal actions.

**Interface:**
```ts
interface ActionOption {
  actionId: string;       // e.g., 'playCardAction', 'tapForManaAction'
  label: string;          // e.g., 'Play Card', 'Tap for Mana'
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
}

class OptionService {
  getOptions(room: GameRoom, playerId: PlayerId, cardUuid: string, zone: 'hand' | 'battlefield'): ActionOption[];
}
```

**Logic (ported from legacy `gameLogic.getOptions()`):**
- **Hand cards:** If enough mana and legal timing → `playCardAction`. If card has alternative modes → those too.
- **Battlefield cards:** If has tap ability and untapped → `tapForManaAction`. If has activated abilities → those too.
- **Validation:** Each option runs through `ActionValidator.canActivate()` to determine if it's currently legal.

---

### 2.5 SyncService (`src/server/sync-service.ts`)

**Responsibility:** Compute state deltas, emit to clients, log for replay.

**Interface:**
```ts
interface StateDelta {
  roomId: string;
  seq: number;
  timestamp: number;
  action?: string;          // The action that caused this delta
  playerId?: PlayerId;
  changes: {
    path: string;           // e.g., 'players.p1.hand'
    op: 'add' | 'remove' | 'replace' | 'update';
    value?: unknown;
    oldValue?: unknown;
  }[];
}

class SyncService {
  constructor(io: Server, deltaLogPath?: string);

  // Called after every state change
  sync(oldState: GameRoom, newState: GameRoom, context: { action: string; playerId: PlayerId }): void;

  // Replay: reconstruct state from delta log
  replay(roomId: string, fromSeq?: number): StateDelta[];
}
```

**Delta computation:** Deep-compare `oldState` and `newState`, produce a list of changes. Only changed paths are included.

**Delta log format (JSONL):**
```json
{"seq":1,"roomId":"abc","action":"CARD_PLAYED","playerId":"p1","timestamp":1752000000000,"changes":[{"path":"players.p1.hand","op":"remove","value":{"uuid":"card-1"}},{"path":"players.p1.mana.red","op":"update","value":1,"oldValue":3},{"path":"battlefield","op":"add","value":{"uuid":"card-1","cardId":"crimson-hellkite"}}]}
```

**Client emission:** The delta is sent to both players as `stateDelta`. The client applies the delta to its local state to update the UI.

---

### 2.6 server.ts (`src/server.ts`)

**Responsibility:** The only file that touches Express and Socket.IO. Wires services together.

**Socket events (client → server):**

| Event | Payload | Handler |
|---|---|---|
| `createRoom` | `{}` | Create room, init state machine, return `roomCreated` |
| `joinRoom` | `{ roomId }` | Join room, if full → start game, return `roomJoined` |
| `getOptions` | `{ cardUuid, zone }` | Call `OptionService.getOptions()`, return `optionsForCard` |
| `executeAction` | `{ actionId, cardUuid, targets? }` | Call `ActionService.proposeAndStack()`, sync state |
| `passPriority` | `{}` | Call `StateMachine.passPriority()` |
| `endTurn` | `{}` | Validate turn, transition to end phase |
| `drawCard` | `{}` | Draw from deck to hand, sync state |

**Socket events (server → client):**

| Event | Payload | Purpose |
|---|---|---|
| `roomCreated` | `{ roomId }` | Room ready for joining |
| `roomJoined` | `{ roomId }` | Successfully joined |
| `gameStarted` | `{ roomId, startingPlayer }` | Both players present, game begins |
| `stateDelta` | `StateDelta` | State changes to apply |
| `optionsForCard` | `{ cardUuid, options: ActionOption[] }` | Available actions for a card |
| `phaseChanged` | `{ phase, currentPlayer }` | Turn phase update |
| `yourTurn` | `{}` | This player can act |
| `opponentTurn` | `{}` | Waiting for opponent |
| `gameOver` | `{ winner, reason }` | Game ended |
| `error` | `{ message }` | Something went wrong |

**Note on frontend compatibility:** The existing frontend expects events like `updateHand`, `cardAddedToBoard`, `updateMana`, etc. These are replaced by `stateDelta`. The frontend will need adaptation — see Section 5.

---

## 3. Data Flow: Playing a Card (End to End)

```
1. Client clicks card → sends 'getOptions' { cardUuid, zone: 'hand' }
2. server.ts → OptionService.getOptions(room, playerId, cardUuid, 'hand')
   → Returns [{ actionId: 'playCardAction', label: 'Play Card' }]
3. server.ts → emits 'optionsForCard' to client
4. Client shows context menu, user clicks "Play Card"
5. Client → sends 'executeAction' { actionId: 'playCardAction', cardUuid }
6. server.ts:
   a. StateStore.getRoom(roomId) → room
   b. oldState = deepClone(room)
   c. ActionService.proposeAndStack(room, playerId, 'cast_spell', { cardUuid }, stateMachine)
      → validate: canPayCost? legal timing? → yes
      → propose: remove from hand, deduct mana, create StackObject
      → StateMachine.addToStack(stackObj)
   d. StateStore.saveRoom(room)
   e. SyncService.sync(oldState, room, { action: 'CARD_PLAYED', playerId })
      → compute diff, emit 'stateDelta' to both players
      → append diff to delta log
7. [Priority passes, both players pass]
8. StateMachine.resolveStack()
   → ActionService.resolveTopOfStack(room)
   → EffectRegistry['CAST_SPELL'](room, stackObj)
   → Card moves to battlefield
9. SyncService.sync(oldState, room, ...) → emit 'stateDelta'
```

---

## 4. What We Keep, Change, Delete

### Keep (existing TS, minor updates)
| File | Changes |
|---|---|
| `src/types/*.ts` | None — complete |
| `src/engine/action-registry.ts` | None — complete |
| `src/engine/action-validator.ts` | None — complete |
| `src/engine/effect-registry.ts` | Add missing handlers: `GRANT_STATS`, `DRAW_CARDS`, `COUNTER_SPELL` |
| `src/engine/event-bus.ts` | Implement `on()` for real (currently no-op stub) |
| `src/engine/game-engine.ts` | Refactor into `ActionService` or keep as thin delegate |
| `src/engine/handlers/play-card-handler.ts` | None — complete |
| `src/library/card-parser.ts` | None — complete |
| `src/library/card-factory.ts` | None — complete |
| `data/card_data.json` | Add ~15 legacy cards |
| `public/*` | Adapt to `stateDelta` events (see Section 5) |

### New (TS)
| File | Purpose | ~Lines |
|---|---|---|
| `src/server.ts` | Express + Socket.IO, wires services | 150 |
| `src/server/state-store.ts` | StateStore interface + InMemoryStore | 50 |
| `src/server/sync-service.ts` | Delta computation, emission, logging | 100 |
| `src/engine/state-machine.ts` | Turn phases, priority, stack | 200 |
| `src/engine/action-service.ts` | Action lifecycle wrapper | 80 |
| `src/engine/option-service.ts` | getOptions() for cards | 100 |
| `data/decks.json` | Deck configurations | 20 |

### Old JS (untouched)
All legacy JS files remain in place with no modifications:
`server.js`, `gameLogic.js`, `stateMachine.js`, `socketHandlers.js`, `effectHandler.js`, `library.js`, `decks.js`

The TS server runs alongside — switch by changing the start script (`node server.js` vs `node dist/server.js`).

---

## 5. Frontend Adaptation

The existing frontend expects granular events (`updateHand`, `cardAddedToBoard`, `updateMana`, etc.). The new server emits `stateDelta` instead.

**What changes in the frontend:**
- Replace all granular event listeners with a single `stateDelta` handler
- The handler applies the delta to a local `GameRoom` state object
- UI re-renders from the local state (or diffs the relevant parts)

**Minimal adaptation strategy:**
1. Add a `gameState` object in the frontend that mirrors `GameRoom`
2. On `stateDelta`, apply each change to `gameState`
3. Call existing render functions (`addCardToHand`, `addCardToBoard`, etc.) based on what changed
4. This is ~50-100 lines of new frontend code, mostly in `public/game.js`

**Future frontend rewrite:** When you move to React/Vue/etc., the `stateDelta` protocol stays the same. The new frontend just needs to apply deltas to its own state store.

---

## 6. Testing Strategy

### Unit tests (vitest)
- `StateMachine` — phase transitions, turn switching, priority passing, stack LIFO
- `ActionService` — validate/propose/resolve lifecycle, error cases
- `OptionService` — correct options for hand cards, battlefield cards, edge cases
- `SyncService` — diff computation correctness, delta log format
- `StateStore` — CRUD operations

### Integration tests
- Full action flow: create room → join → play card → resolve stack → verify state
- Turn flow: draw → main → battle → end → switch → repeat
- Error paths: not your turn, insufficient mana, invalid target

### CLI playability
- Write a small test script that creates a room, plays cards, and prints state — no browser needed
- This is the "test from command line" requirement

---

## 7. What's Deferred

| Item | Reason |
|---|---|
| RPS phase | Hardcode or randomize starting player for now |
| Player reconnection | Requires session management, deferred |
| Redis storage | InMemoryStore works; swap later via interface |
| Frontend rewrite | Vanilla JS adaptation first |
| ModifierRegistry/Pipeline | Stubs are fine until continuous effects needed |
| Card library completion | Port ~15 legacy cards; new cards later |

---

## 8. Key Design Decisions

1. **Engine has no socket knowledge** — `EventBus` decouples engine from transport
2. **State deltas, not full state** — efficient for network and enables replay logging
3. **StateStore interface** — swap storage without touching engine
4. **Server computes options** — MTGA style, server is always authority
5. **Old JS preserved** — legacy files untouched; TS server runs alongside, switch via start script
6. **Delta log = poor man's event sourcing** — replayable history without architectural overhead