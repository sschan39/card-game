# Engine Consolidation Design

**Date:** 2026-07-16
**Status:** Draft
**Scope:** Resolve ARCHITECTURE.md points 9.1–9.4

---

## 1. Motivation

The engine layer has four structural issues that create duplication and manual sync overhead:

| Point | Issue |
|---|---|
| 9.1 | `GameEngine` and `ActionService` are near-identical orchestrators; `server.ts` juggles 3 separate engine objects |
| 9.2 | `GameRoom.stack` and `StateMachine.stack` are separate arrays kept in sync manually |
| 9.3 | `StateMachine` duplicates `currentPhase`, `priorityPlayer`, `lastPlayerToPass`, `activeTurnPlayerId` from `GameRoom`; `server.ts` manually copies after every operation |
| 9.4 | `roomFactory` is a static-only class with non-standard `lowerCamelCase` naming |

All four converge on one principle: **each concept gets one canonical home, and the public API surface shrinks to one object.**

---

## 2. Design

### 2.1 GameEngine as Single Public API

`GameEngine` becomes the sole entry point that `server.ts` talks to. It internally owns and coordinates `EventBus`, `StateMachine`, and `ActionService`.

```
server.ts  →  GameEngine  →  EventBus (internal)
                           →  StateMachine (internal, operates on GameRoom)
                           →  ActionService (internal delegate)
```

**`GameEngine` public API:**

| Method | Delegates to |
|---|---|
| `constructor(room: GameRoom)` | Creates internal EventBus, StateMachine, ActionService |
| `initRoom()` | ActionService.initRoom (wires TriggerManager) |
| `handleAction(playerId, actionType, data)` | ActionService.handleAction |
| `proposeAndStack(playerId, actionType, data)` | ActionService.proposeAndStack, then StateMachine.addToStack (stack sync happens in GameEngine) |
| `resolveTopOfStack()` | ActionService.resolveTopOfStack |
| `transition(phase)` | StateMachine.transition |
| `switchTurn()` | StateMachine.switchTurn |
| `passPriority(playerId)` | StateMachine.passPriority |
| `isPlayerTurn(playerId)` | StateMachine.isPlayerTurn |
| `givePriorityTo(playerId)` | StateMachine.givePriorityTo |
| `get phase` / `get priorityPlayer` | StateMachine (reads from room) |

**`server.ts` changes:**
- Replace 3 `Map<string, EventBus|StateMachine|ActionService>` with 1 `Map<string, GameEngine>`
- Remove all `room.currentPhase = sm.currentPhase` manual sync lines (8 lines deleted)
- Each socket handler calls `engine.someMethod()` — the room is always current

### 2.2 StateMachine Operates on GameRoom Directly

`StateMachine` drops its duplicate fields and reads/writes `GameRoom` directly via a held reference.

**Removed fields and their replacements:**

| Removed | Replaced by |
|---|---|
| `this.currentPhase` | `this.room.currentPhase` |
| `this.currentPlayer` | `this.room.activeTurnPlayerId` |
| `this.priorityPlayer` | `this.room.priorityPlayerId` |
| `this.lastPlayerToPass` | `this.room.lastPassedPlayerId` |
| `this.stack` | `this.room.stack` |

**Fields kept on StateMachine (internal bookkeeping, not game data):**

| Field | Why it stays |
|---|---|
| `previousPhase` | Return address when stack empties — clients don't need this |
| `waitingForResponse` | Internal flag for priority loop state |
| `stackOpen` | Internal flag for whether new items can be added to stack |

**Constructor change:**
```ts
// Before:
constructor(roomId: string, player1: PlayerId, player2: PlayerId, eventBus: EventBus)

// After:
constructor(room: GameRoom, eventBus: EventBus)
```
Player IDs are read from `room.player1Id` / `room.player2Id`.

**`addToStack()` behavior:**
- Pushes to `room.stack` directly (handlers and triggers already do this)
- Focuses on phase transition (`Stack`), event emission (`STACK_UPDATED`), and priority handoff
- No more dual-push / dual-pop

**`resolveTopOfStack()` impact:**
- `ActionService.resolveTopOfStack()` no longer needs a `StateMachine` parameter
- No dual-pop — only `room.stack.pop()`

### 2.3 roomFactory → Exported Functions

Replace the static-only class with plain exported functions:

```ts
// Before:
export class roomFactory {
    public static createRoom(...) { }
    public static joinRoom(...) { }
    public static setupRPS(...) { }
    public static dealStartingHands(...) { }
}

// After:
export function createRoom(roomId: string, player1Id: PlayerId): GameRoom { }
export function joinRoom(room: GameRoom, player2Id: PlayerId): void { }
export function setupRPS(room: GameRoom): void { }
export function dealStartingHands(room: GameRoom): void { }
```

`createDefaultPlayer` stays private (not exported). Call sites update from `roomFactory.createRoom()` to `createRoom()`.

### 2.4 ActionService Kept as Internal Delegate

`ActionService` remains its own class, owned by `GameEngine`. It is no longer directly instantiated by `server.ts`. This preserves the existing `action-service.test.ts` with minimal changes.

**API changes:**
- `proposeAndStack()` drops the `StateMachine` parameter — the `addToStack` call moves up to `GameEngine.proposeAndStack()`. `ActionService.proposeAndStack()` only does validate → propose.
- `resolveTopOfStack()` drops the `StateMachine` parameter — no dual-pop needed

---

## 3. Stack Lifecycle (Reference)

Understanding how the `'Stack'` pseudo-phase works is critical to the refactor. Here is the full lifecycle:

### 3.1 Entering the Stack Phase

When a spell/ability is proposed, `addToStack()` runs:
1. Push to `room.stack`
2. If `currentPhase !== 'Stack'`: save current phase to `previousPhase`, transition to `'Stack'`
3. Emit `STACK_UPDATED`
4. Give priority to the opponent of the controller (they get first chance to respond)

### 3.2 Priority Passing on the Stack

Players can add more items or pass. Each `addToStack()` gives priority to the opponent. `passPriority()` tracks consecutive passes — when both players pass back-to-back, `resolveCurrentPhase()` fires.

### 3.3 Both Players Pass (resolveCurrentPhase)

- If `phase === 'Stack'` AND `stack.length > 0`: clears priority state, waits for client to emit `'resolveStack'`. Does NOT auto-resolve.
- If stack is empty: transitions back to `previousPhase` (the phase saved when entering Stack).

### 3.4 Resolving One Item (resolveTopOfStack)

Client emits `'resolveStack'` → pops `room.stack` → `resolveStackObject()` handles zone change + effects + triggers. If more items remain, client emits `'resolveStack'` again. LIFO order.

### 3.5 Exiting the Stack Phase

After the last item resolves, the next `passPriority` → `resolveCurrentPhase()` sees empty stack and transitions back to `previousPhase`.

### 3.6 Stack Writers (all push to room.stack)

| Writer | Trigger |
|---|---|
| `play-card-handler.ts` (propose) | Spell cast |
| `trigger-manager.ts` | ETB triggered abilities |
| `StateMachine.addToStack()` | After refactor: phase transition + event + priority only (push already done by handler) |

### 3.7 Stack Readers (all read from room.stack)

| Reader | Purpose |
|---|---|
| `action-validator.ts` | Sorcery speed check (stack must be empty) |
| `effect-registry.ts` | Counter target spell on stack |
| `effect-resolver.ts` | Revalidate stack targets at resolve time |
| `StateMachine.resolveCurrentPhase()` | Check if stack is non-empty |
| `StateMachine.addToStack()` | `STACK_UPDATED` event payload |

---

## 4. File-by-File Changes

| File | Change |
|---|---|
| `src/engine/game-engine.ts` | **Rewrite.** Takes `GameRoom` in constructor. Owns EventBus, StateMachine, ActionService. Exposes unified public API (~120 lines). |
| `src/engine/state-machine.ts` | **Refactor.** Remove 5 duplicate fields. Constructor takes `(room, eventBus)`. All methods read/write `this.room.*`. |
| `src/engine/action-service.ts` | **Minor.** Remove `StateMachine` params from `proposeAndStack()` and `resolveTopOfStack()`. |
| `src/engine/room-factory.ts` | **Refactor.** `class roomFactory` → 4 exported functions + 1 private helper. |
| `src/server.ts` | **Simplify.** 3 Maps → 1 Map. Remove 8 manual sync lines. Import `GameEngine` and functions from `room-factory.ts`. |
| `tests/engine/game-engine.test.ts` | **Update.** New constructor: `new GameEngine(room)`. |
| `tests/engine/play-card-handler.test.ts` | **Update.** New constructor in full-flow test. |
| `tests/engine/action-service.test.ts` | **Minor.** Remove `StateMachine` params from `proposeAndStack`/`resolveTopOfStack` calls. |

**Files NOT changed:**
`action-registry.ts`, `action-validator.ts`, `effect-registry.ts`, `effect-resolver.ts`, `trigger-manager.ts`, `event-bus.ts`, `option-service.ts`, `modifier-pipeline.ts`, `modifier-registry.ts`, `play-card-handler.ts`, all type files, all server/ files.

---

## 5. Error Handling & Edge Cases

| Scenario | Handling |
|---|---|
| `GameEngine` created with null/undefined room | Constructor throws — room is required |
| `resolveTopOfStack()` on empty stack | Returns `{ success: false, reason: 'Stack is empty' }` (unchanged) |
| `StateMachine` transition to invalid phase | Logs error via `console.error`, no-ops (unchanged) |
| `passPriority()` when not priority player | Returns `false` (unchanged) |
| Room destroyed / player disconnects | `GameEngine` instance deleted from Map; TriggerManager cleanup deferred (point 9.6, out of scope) |

---

## 6. Migration Order

1. **`room-factory.ts`** — mechanical refactor, no dependencies on other changes
2. **`state-machine.ts`** — take `GameRoom` reference, remove duplicate fields
3. **`action-service.ts`** — remove `StateMachine` params
4. **`game-engine.ts`** — rewrite as wrapper owning all three
5. **`server.ts`** — switch to `GameEngine`, remove sync lines
6. **Tests** — update constructor calls and removed params
7. Run full test suite, verify no regressions