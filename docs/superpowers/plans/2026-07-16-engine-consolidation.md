# Engine Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the engine layer so GameEngine is the single public API, StateMachine operates directly on GameRoom, and roomFactory becomes exported functions.

**Architecture:** GameEngine wraps EventBus, StateMachine, and ActionService internally. StateMachine reads/writes GameRoom fields directly instead of maintaining duplicates. server.ts talks only to GameEngine — no more manual state sync.

**Tech Stack:** TypeScript, Vitest (testing)

**Spec:** `docs/superpowers/specs/2026-07-16-engine-consolidation-design.md`

## Global Constraints

- All existing tests must pass after each task
- No changes to type files (`src/types/`)
- No changes to `action-registry.ts`, `action-validator.ts`, `effect-registry.ts`, `effect-resolver.ts`, `trigger-manager.ts`, `event-bus.ts`, `option-service.ts`, `modifier-pipeline.ts`, `modifier-registry.ts`, `play-card-handler.ts`
- No changes to `src/server/` files
- `previousPhase`, `waitingForResponse`, `stackOpen` stay on StateMachine (internal bookkeeping)

---

### Task 1: Convert roomFactory to Exported Functions

**Files:**
- Modify: `src/engine/room-factory.ts`
- Modify: `src/server.ts` (imports only)

**Interfaces:**
- Produces: `createRoom(roomId: string, player1Id: PlayerId): GameRoom`, `joinRoom(room: GameRoom, player2Id: PlayerId): void`, `setupRPS(room: GameRoom): void`, `dealStartingHands(room: GameRoom): void`

- [ ] **Step 1: Convert class to exported functions**

Replace the `roomFactory` class with individual exported functions. `createDefaultPlayer` stays as a non-exported function.

In `src/engine/room-factory.ts`, replace the entire file content:

```ts
import { v4 as uuidv4 } from 'uuid';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { PlayerState } from '../types/game.player.types';

import { instantiateCard } from '../library/card-factory';

function createDefaultPlayer(id: PlayerId): PlayerState {
    return {
        id,
        life: 20,
        mana: { red: 0, blue: 0, green: 0, black: 0, white: 0, colorless: 0 },
        deck: [],
        hand: [],
        graveyard: []
    };
}

export function createRoom(roomId: string, player1Id: PlayerId): GameRoom {
    return {
        roomId,
        player1Id: player1Id,
        player2Id: null,
        players: {
            [player1Id]: createDefaultPlayer(player1Id)
        },
        currentPhase: 'waiting',
        activeTurnPlayerId: player1Id,
        priorityPlayerId: null,
        lastPassedPlayerId: null,
        battlefield: [],
        stack: [],
        rpsState: {
            status: 'pending',
            playedCards: {}
        }
    };
}

export function joinRoom(room: GameRoom, player2Id: PlayerId): void {
    room.player2Id = player2Id;
    room.players[player2Id] = createDefaultPlayer(player2Id);
}

export function setupRPS(room: GameRoom): void {
    room.currentPhase = 'RPS';
    
    if (!room.player2Id) return;

    const p1 = room.players[room.player1Id];
    const p2 = room.players[room.player2Id];

    room.battlefield = [];
    p1.hand = [];
    p2.hand = [];

    p1.hand.push(instantiateCard('rock'), instantiateCard('paper'), instantiateCard('scissors'));
    p2.hand.push(instantiateCard('rock'), instantiateCard('paper'), instantiateCard('scissors'));
}

export function dealStartingHands(room: GameRoom): void {
    if (!room.player2Id) return;

    const p1 = room.players[room.player1Id];
    const p2 = room.players[room.player2Id];

    p1.hand = [];
    p2.hand = [];

    for (let i = 0; i < 4; i++) {
        const p1Card = p1.deck.pop();
        if (p1Card) p1.hand.push(p1Card);

        const p2Card = p2.deck.pop();
        if (p2Card) p2.hand.push(p2Card);
    }
}
```

- [ ] **Step 2: Update server.ts imports**

In `src/server.ts`, change the import line:

```ts
// Before:
import { roomFactory } from './engine/room-factory';

// After:
import { createRoom, joinRoom, setupRPS } from './engine/room-factory';
```

- [ ] **Step 3: Update server.ts call sites**

Replace all `roomFactory.` prefixed calls:

```ts
// Before (line ~88):
const room = roomFactory.createRoom(roomId, socket.id);

// After:
const room = createRoom(roomId, socket.id);
```

```ts
// Before (line ~111):
roomFactory.joinRoom(room, socket.id);

// After:
joinRoom(room, socket.id);
```

```ts
// Before (line ~122):
roomFactory.setupRPS(room);

// After:
setupRPS(room);
```

- [ ] **Step 4: Run tests to verify no regressions**

Run: `npx vitest run`
Expected: All existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/room-factory.ts src/server.ts
git commit -m "refactor: convert roomFactory class to exported functions"
```

---

### Task 2: Refactor StateMachine to Operate on GameRoom Directly

**Files:**
- Modify: `src/engine/state-machine.ts`

**Interfaces:**
- Consumes: `GameRoom` (from types)
- Produces: `StateMachine` constructor takes `(room: GameRoom, eventBus: EventBus)` instead of `(roomId, player1, player2, eventBus)`
- Produces: All methods read/write `this.room.*` instead of `this.*` for phase/priority/stack fields

- [ ] **Step 1: Rewrite StateMachine constructor and fields**

Replace the constructor and field declarations in `src/engine/state-machine.ts`:

```ts
export class StateMachine {
  readonly roomId: string;
  private room: GameRoom;
  private eventBus: EventBus;

  previousPhase: GameStateName | null = null;
  waitingForResponse = false;
  stackOpen = true;

  constructor(room: GameRoom, eventBus: EventBus) {
    this.roomId = room.roomId;
    this.room = room;
    this.eventBus = eventBus;
  }
```

Remove these fields: `currentPhase`, `currentPlayer`, `priorityPlayer`, `lastPlayerToPass`, `stack`.

- [ ] **Step 2: Update all method bodies to use this.room**

Replace every reference to removed fields with `this.room.*` equivalents:

| Old | New |
|---|---|
| `this.currentPhase` | `this.room.currentPhase` |
| `this.currentPlayer` | `this.room.activeTurnPlayerId` |
| `this.priorityPlayer` | `this.room.priorityPlayerId` |
| `this.lastPlayerToPass` | `this.room.lastPassedPlayerId` |
| `this.stack` | `this.room.stack` |
| `this.player1` | `this.room.player1Id` |
| `this.player2` | `this.room.player2Id` |

Full updated methods:

```ts
  canTransition(to: GameStateName): boolean {
    if (to === 'gameOver') return true;
    if (!this.stackOpen && to === 'Stack') return false;
    return TRANSITIONS[this.room.currentPhase]?.includes(to) ?? false;
  }

  transition(to: GameStateName): void {
    if (!this.canTransition(to)) {
      console.error(`Invalid transition from ${this.room.currentPhase} to ${to}`);
      return;
    }

    if (to === 'Stack') {
      this.previousPhase = this.room.currentPhase;
    }

    this.room.currentPhase = to;
    this.eventBus.emit({
      eventId: 'PHASE_CHANGED',
      roomId: this.roomId,
      payload: { phase: this.room.currentPhase, currentPlayer: this.room.activeTurnPlayerId },
    });
  }

  switchTurn(): void {
    this.room.activeTurnPlayerId = this.room.activeTurnPlayerId === this.room.player1Id
      ? this.room.player2Id!
      : this.room.player1Id;
    this.eventBus.emit({
      eventId: 'TURN_SWITCHED',
      roomId: this.roomId,
      payload: { newPlayer: this.room.activeTurnPlayerId },
    });
  }

  isPlayerTurn(playerId: PlayerId): boolean {
    return this.room.activeTurnPlayerId === playerId;
  }

  givePriorityTo(playerId: PlayerId): void {
    this.room.priorityPlayerId = playerId;
    this.waitingForResponse = true;
    this.eventBus.emit({
      eventId: 'PRIORITY_GIVEN',
      roomId: this.roomId,
      payload: { playerId },
    });
  }

  passPriority(playerId: PlayerId): boolean {
    if (this.room.priorityPlayerId !== playerId) {
      return false;
    }

    const opponent = playerId === this.room.player1Id ? this.room.player2Id! : this.room.player1Id;

    if (this.room.lastPassedPlayerId === opponent) {
      this.resolveCurrentPhase();
    } else {
      this.room.lastPassedPlayerId = playerId;
      this.givePriorityTo(opponent);
    }

    return true;
  }

  resolveCurrentPhase(): void {
    if (this.room.currentPhase === 'Stack' && this.room.stack.length > 0) {
      this.waitingForResponse = false;
      this.room.priorityPlayerId = null;
      this.room.lastPassedPlayerId = null;
    } else {
      this.waitingForResponse = false;
      this.room.priorityPlayerId = null;
      this.room.lastPassedPlayerId = null;

      if (this.previousPhase) {
        this.transition(this.previousPhase);
        this.previousPhase = null;
      } else {
        this.transition('stateMainPhase');
      }
    }
  }

  addToStack(stackObj: StackObject): void {
    this.room.stack.push(stackObj);

    if (this.room.currentPhase !== 'Stack') {
      this.transition('Stack');
    }

    this.eventBus.emit({
      eventId: 'STACK_UPDATED',
      roomId: this.roomId,
      payload: { stack: this.room.stack, newAction: stackObj },
    });

    const opponent = stackObj.controllerId === this.room.player1Id
      ? this.room.player2Id!
      : this.room.player1Id;
    this.givePriorityTo(opponent);
  }
```

- [ ] **Step 3: Update imports in state-machine.ts**

Remove the `PlayerId` import (no longer needed for constructor params — still used in method signatures, so keep it). Add `GameRoom` import:

```ts
// Before:
import type { PlayerId } from '../types/game.room.types';

// After:
import type { GameRoom, PlayerId } from '../types/game.room.types';
```

- [ ] **Step 4: Run tests to verify no regressions**

Run: `npx vitest run`
Expected: Tests that use StateMachine directly will fail due to constructor change. This is expected — they'll be fixed in Task 6.

- [ ] **Step 5: Commit**

```bash
git add src/engine/state-machine.ts
git commit -m "refactor: StateMachine operates on GameRoom directly, removes duplicate fields"
```

---

### Task 3: Remove StateMachine Params from ActionService

**Files:**
- Modify: `src/engine/action-service.ts`

**Interfaces:**
- Consumes: `StateMachine` (import removed from params)
- Produces: `proposeAndStack(room, playerId, actionType, actionData)` — no StateMachine param
- Produces: `resolveTopOfStack(room)` — no StateMachine param

- [ ] **Step 1: Update proposeAndStack signature and body**

In `src/engine/action-service.ts`:

```ts
  proposeAndStack(
    room: GameRoom,
    playerId: PlayerId,
    actionType: string,
    actionData: ActionData
  ): ActionResult {
    const result = this.handleAction(room, playerId, actionType, actionData);
    if (!result.success) return result;

    // The handler's propose() already pushed to room.stack.
    // Stack sync (addToStack) is now handled by the caller (GameEngine).
    return result;
  }
```

- [ ] **Step 2: Update resolveTopOfStack signature and body**

```ts
  resolveTopOfStack(room: GameRoom): ActionResult {
    if (room.stack.length === 0) {
      return { success: false, phase: 'resolve', reason: 'Stack is empty' };
    }

    const stackObj = room.stack.pop()!;

    // Full resolution: zone change + effects + PERMANENT_ENTERED + STACK_RESOLVED
    resolveStackObject(room, stackObj, this.eventBus);

    return { success: true };
  }
```

- [ ] **Step 3: Remove StateMachine import**

```ts
// Remove this line:
import { StateMachine } from './state-machine';
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: `action-service.test.ts` tests will fail due to changed signatures. This is expected — they'll be fixed in Task 6.

- [ ] **Step 5: Commit**

```bash
git add src/engine/action-service.ts
git commit -m "refactor: remove StateMachine params from ActionService methods"
```

---

### Task 4: Rewrite GameEngine as Unified Wrapper

**Files:**
- Modify: `src/engine/game-engine.ts`

**Interfaces:**
- Consumes: `EventBus`, `StateMachine`, `ActionService` (internal)
- Produces: `GameEngine` constructor takes `(room: GameRoom)`, exposes unified public API

- [ ] **Step 1: Rewrite game-engine.ts**

Replace the entire file:

```ts
// src/engine/game-engine.ts
import { EventBus } from './event-bus';
import { StateMachine } from './state-machine';
import { ActionService } from './action-service';
import { ActionRegistry, type ActionData, type ActionResult } from './action-registry';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { GameStateName } from '../types/game.state.types';

/**
 * GameEngine — single public API for all engine operations.
 *
 * Owns and coordinates EventBus, StateMachine, and ActionService internally.
 * server.ts talks only to GameEngine — no more juggling 3 separate engine objects.
 */
export class GameEngine {
  private eventBus: EventBus;
  private stateMachine: StateMachine;
  private actionService: ActionService;
  private room: GameRoom;

  constructor(room: GameRoom) {
    this.room = room;
    this.eventBus = new EventBus(room.roomId);
    this.stateMachine = new StateMachine(room, this.eventBus);
    this.actionService = new ActionService(this.eventBus);
  }

  /** Wire TriggerManager for ETB/triggered abilities. Call once after room creation. */
  initRoom(): void {
    this.actionService.initRoom(this.room);
  }

  // -- Action pipeline --

  handleAction(playerId: PlayerId, actionType: string, actionData: ActionData): ActionResult {
    return this.actionService.handleAction(this.room, playerId, actionType, actionData);
  }

  proposeAndStack(playerId: PlayerId, actionType: string, actionData: ActionData): ActionResult {
    const result = this.actionService.proposeAndStack(this.room, playerId, actionType, actionData);
    if (!result.success) return result;

    // Sync stack to StateMachine (phase transition + event + priority)
    if (result.stackObject) {
      this.stateMachine.addToStack(result.stackObject);
    }

    return result;
  }

  resolveTopOfStack(): ActionResult {
    return this.actionService.resolveTopOfStack(this.room);
  }

  // -- Phase / Turn delegation --

  transition(to: GameStateName): void {
    this.stateMachine.transition(to);
  }

  switchTurn(): void {
    this.stateMachine.switchTurn();
  }

  isPlayerTurn(playerId: PlayerId): boolean {
    return this.stateMachine.isPlayerTurn(playerId);
  }

  // -- Priority delegation --

  givePriorityTo(playerId: PlayerId): void {
    this.stateMachine.givePriorityTo(playerId);
  }

  passPriority(playerId: PlayerId): boolean {
    return this.stateMachine.passPriority(playerId);
  }

  // -- Accessors --

  get phase(): GameStateName {
    return this.room.currentPhase;
  }

  get activeTurnPlayerId(): PlayerId {
    return this.room.activeTurnPlayerId;
  }

  get priorityPlayerId(): PlayerId | null {
    return this.room.priorityPlayerId;
  }
}
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run`
Expected: `game-engine.test.ts` and `play-card-handler.test.ts` will fail due to constructor change. This is expected — they'll be fixed in Task 6.

- [ ] **Step 3: Commit**

```bash
git add src/engine/game-engine.ts
git commit -m "refactor: GameEngine as unified wrapper owning EventBus, StateMachine, ActionService"
```

---

### Task 5: Update server.ts to Use GameEngine

**Files:**
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `GameEngine` (new unified API)
- Consumes: `createRoom, joinRoom, setupRPS` (from Task 1)

- [ ] **Step 1: Update imports**

Replace the multi-import with a single GameEngine import:

```ts
// Remove:
import { EventBus } from './engine/event-bus';
import { StateMachine } from './engine/state-machine';
import { ActionService } from './engine/action-service';

// Add:
import { GameEngine } from './engine/game-engine';
```

- [ ] **Step 2: Replace 3 Maps with 1 Map**

```ts
// Remove:
const eventBuses = new Map<string, EventBus>();
const stateMachines = new Map<string, StateMachine>();
const actionServices = new Map<string, ActionService>();

// Add:
const engines = new Map<string, GameEngine>();
```

- [ ] **Step 3: Rewrite getOrCreateEngine helper**

```ts
function getOrCreateEngine(roomId: string, player1Id: PlayerId, player2Id: PlayerId | null): GameEngine {
  if (!engines.has(roomId)) {
    // Create a temporary room for engine initialization
    // The actual room from the store will be used by callers
    const room = getRoom(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);
    const engine = new GameEngine(room);
    engines.set(roomId, engine);
  }
  return engines.get(roomId)!;
}
```

- [ ] **Step 4: Update createRoom handler**

```ts
socket.on('createRoom', () => {
    const roomId = uuidv4();
    socket.join(roomId);
    (socket as any).roomId = roomId;

    const room = createRoom(roomId, socket.id);
    saveRoom(room);
    const engine = new GameEngine(room);
    engines.set(roomId, engine);
    engine.initRoom();

    console.log(`[server] room created: ${roomId} by ${socket.id}`);
    socket.emit('roomCreated', { roomId });
  });
```

- [ ] **Step 5: Update joinRoom handler**

```ts
socket.on('joinRoom', (data: { roomId: string }) => {
    const room = getRoom(data.roomId);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    if (room.player2Id !== null) {
      socket.emit('roomFull');
      return;
    }

    socket.join(data.roomId);
    (socket as any).roomId = data.roomId;

    joinRoom(room, socket.id);
    saveRoom(room);

    // Re-create engine with both players (room now has player2Id)
    const engine = new GameEngine(room);
    engines.set(data.roomId, engine);

    console.log(`[server] ${socket.id} joined room: ${data.roomId}`);
    socket.emit('roomJoined', { roomId: data.roomId });
    io.to(data.roomId).emit('playerJoined', { playerId: socket.id });

    // Start RPS phase
    setupRPS(room);
    saveRoom(room);
    engine.transition('RPS');

    io.to(data.roomId).emit('startGame', { roomId: data.roomId });
    io.to(data.roomId).emit('rpsPhase', { message: 'Choose Rock, Paper, or Scissors!' });

    io.to(room.player1Id).emit('updateHand', {
      roomId: data.roomId,
      hand: room.players[room.player1Id].hand,
    });
    io.to(room.player2Id!).emit('updateHand', {
      roomId: data.roomId,
      hand: room.players[room.player2Id!].hand,
    });
  });
```

- [ ] **Step 6: Update nextState handler**

```ts
socket.on('nextState', (data: { roomId: string }) => {
    const room = getRoom(data.roomId);
    const engine = engines.get(data.roomId);
    if (!room || !engine) return;

    const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
    engine.transition('stateTurnStart');
    saveRoom(room);
    syncService.sync(oldState, room, { action: 'nextState', playerId: socket.id });
  });
```

- [ ] **Step 7: Update endTurn handler**

```ts
socket.on('endTurn', (data: { roomId: string }) => {
    const room = getRoom(data.roomId);
    const engine = engines.get(data.roomId);
    if (!room || !engine) return;

    if (engine.phase === 'RPS') {
      socket.emit('error', { message: 'Cannot end turn during Rock Paper Scissors phase!' });
      return;
    }

    if (!engine.isPlayerTurn(socket.id)) {
      socket.emit('error', { message: 'Not your turn!' });
      return;
    }

    const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
    engine.transition('stateEndPhase');
    engine.transition('cleanupStep');
    engine.transition('stateTurnStart');
    engine.switchTurn();
    saveRoom(room);
    syncService.sync(oldState, room, { action: 'endTurn', playerId: socket.id });
  });
```

- [ ] **Step 8: Update playCard handler**

```ts
socket.on('playCard', (data: { roomId: string; cardUuid: string; targets?: any[] }) => {
    const room = getRoom(data.roomId);
    const engine = engines.get(data.roomId);
    if (!room || !engine) return;

    const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
    const result = engine.proposeAndStack(socket.id, 'cast_spell', {
      cardUuid: data.cardUuid,
      targets: data.targets,
    });

    if (!result.success) {
      socket.emit('error', { message: result.reason });
      return;
    }

    saveRoom(room);
    syncService.sync(oldState, room, { action: 'playCard', playerId: socket.id });
  });
```

- [ ] **Step 9: Update resolveStack handler**

```ts
socket.on('resolveStack', (data: { roomId: string }) => {
    const room = getRoom(data.roomId);
    const engine = engines.get(data.roomId);
    if (!room || !engine) return;

    const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
    const result = engine.resolveTopOfStack();

    if (!result.success) {
      socket.emit('error', { message: result.reason });
      return;
    }

    saveRoom(room);
    syncService.sync(oldState, room, { action: 'resolveStack', playerId: socket.id });
  });
```

- [ ] **Step 10: Update passPriority handler**

```ts
socket.on('passPriority', (data: { roomId: string }) => {
    const room = getRoom(data.roomId);
    const engine = engines.get(data.roomId);
    if (!room || !engine) return;

    const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
    engine.passPriority(socket.id);
    saveRoom(room);
    syncService.sync(oldState, room, { action: 'passPriority', playerId: socket.id });
  });
```

- [ ] **Step 11: Update GetOptionsForCard handler**

```ts
socket.on('GetOptionsForCard', (data: any, callback?: (result: any) => void) => {
    const roomId = data.roomId || (socket as any).roomId;
    const room = getRoom(roomId);
    if (!room) {
      const empty: any[] = [];
      if (callback) callback(empty);
      socket.emit('OptionsForCard', { place: data.place, options: empty });
      return;
    }

    const cardUuid = data.uuid || data.card?.uuid;
    const zone = data.place as 'hand' | 'battlefield';
    const options = optionService.getOptions(room, socket.id, cardUuid, zone);

    if (callback) callback(options);
    socket.emit('OptionsForCard', { place: zone, options });
  });
```

- [ ] **Step 12: Verify server.ts compiles**

Run: `npx tsc --noEmit`
Expected: No TypeScript errors in server.ts.

- [ ] **Step 13: Commit**

```bash
git add src/server.ts
git commit -m "refactor: server.ts uses GameEngine exclusively, removes manual state sync"
```

---

### Task 6: Update Tests for New Signatures

**Files:**
- Modify: `tests/engine/game-engine.test.ts`
- Modify: `tests/engine/play-card-handler.test.ts`
- Modify: `tests/engine/action-service.test.ts`
- Modify: `tests/engine/state-machine.test.ts`

**Interfaces:**
- Consumes: `GameEngine(room)` constructor, `StateMachine(room, eventBus)` constructor, `ActionService` methods without StateMachine params

- [ ] **Step 1: Update game-engine.test.ts**

Replace constructor calls and remove manual StateMachine setup:

```ts
// tests/engine/game-engine.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { ActionRegistry, registerAction } from '../../src/engine/action-registry';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';

describe('GameEngine', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    Object.keys(ActionRegistry).forEach(key => delete ActionRegistry[key]);
    registerAction('cast_spell', playCardHandler);

    room = createTestRoom();
    const card = room.players['player1'].hand[0];
    card.castRequirements.cost = { mana: { red: 1 }, tap: false, life: 0, discard: 0, sacrifice: false };
    engine = new GameEngine(room);
  });

  describe('handleAction', () => {
    it('should validate and propose a valid action', () => {
      const card = room.players['player1'].hand[0];
      const result = engine.handleAction('player1', 'cast_spell', { cardUuid: card.uuid });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.stackObject).toBeDefined();
        expect(room.stack.length).toBe(1);
      }
    });

    it('should reject an unregistered action type', () => {
      const card = room.players['player1'].hand[0];
      const result = engine.handleAction('player1', 'nonexistent_action', { cardUuid: card.uuid });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toContain('No handler registered');
      }
    });

    it('should reject when validation fails', () => {
      room.players['player1'].mana.red = 0;
      const card = room.players['player1'].hand[0];
      const result = engine.handleAction('player1', 'cast_spell', { cardUuid: card.uuid });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.phase).toBe('validate');
      }
    });
  });

  describe('proposeAndStack', () => {
    it('should propose action and push to stack', () => {
      const card = room.players['player1'].hand[0];
      const result = engine.proposeAndStack('player1', 'cast_spell', { cardUuid: card.uuid });

      expect(result.success).toBe(true);
      expect(room.stack.length).toBe(1);
    });
  });

  describe('resolveTopOfStack', () => {
    it('should resolve the top stack object', () => {
      const card = room.players['player1'].hand[0];
      engine.proposeAndStack('player1', 'cast_spell', { cardUuid: card.uuid });

      const result = engine.resolveTopOfStack();
      expect(result.success).toBe(true);
      expect(room.stack.length).toBe(0);
    });

    it('should fail when stack is empty', () => {
      const result = engine.resolveTopOfStack();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('Stack is empty');
      }
    });
  });
});
```

- [ ] **Step 2: Update play-card-handler.test.ts full-flow test**

Replace the GameEngine usage in the "full flow" test:

```ts
  describe('full flow: validate → propose → resolve', () => {
    it('should complete the full play-card lifecycle via GameEngine', () => {
      const card = room.players['player1'].hand[0];
      const cardName = card.name;

      const validateResult = playCardHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(validateResult.success).toBe(true);

      const proposeResult = playCardHandler.propose(room, 'player1', { cardUuid: card.uuid });
      expect(proposeResult.success).toBe(true);
      expect(room.stack.length).toBe(1);

      // Use GameEngine for full resolution (zone change + effects + PERMANENT_ENTERED)
      const engine = new GameEngine(room);
      engine.initRoom();
      const resolveResult = engine.resolveTopOfStack();
      expect(resolveResult.success).toBe(true);

      const onBattlefield = room.battlefield.find(c => c.name === cardName);
      expect(onBattlefield).toBeDefined();
      expect(onBattlefield!.state.zone).toBe('battlefield');
    });
  });
```

Add the import at the top of the file:

```ts
import { GameEngine } from '../../src/engine/game-engine';
```

- [ ] **Step 3: Update action-service.test.ts**

Remove StateMachine params from `proposeAndStack` and `resolveTopOfStack` calls. Remove StateMachine-related assertions:

```ts
// tests/engine/action-service.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ActionService } from '../../src/engine/action-service';
import { ActionRegistry, registerAction } from '../../src/engine/action-registry';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { EventBus } from '../../src/engine/event-bus';
import { createTestRoom } from '../helpers/test-room-factory';
import type { GameRoom } from '../../src/types/game.room.types';

describe('ActionService', () => {
  let service: ActionService;
  let room: GameRoom;
  let bus: EventBus;

  beforeEach(() => {
    Object.keys(ActionRegistry).forEach(key => delete ActionRegistry[key]);
    registerAction('cast_spell', playCardHandler);

    bus = new EventBus('room-1');
    service = new ActionService(bus);
    room = createTestRoom();
    const card = room.players['player1'].hand[0];
    card.castRequirements.cost = { mana: { red: 1 } };
  });

  describe('handleAction', () => {
    it('should validate and propose a valid action', () => {
      const card = room.players['player1'].hand[0];
      const result = service.handleAction(room, 'player1', 'cast_spell', { cardUuid: card.uuid });

      expect(result.success).toBe(true);
    });

    it('should reject unknown action type', () => {
      const card = room.players['player1'].hand[0];
      const result = service.handleAction(room, 'player1', 'unknown', { cardUuid: card.uuid });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toContain('No handler registered');
      }
    });

    it('should reject when validation fails', () => {
      room.players['player1'].mana.red = 0;
      const card = room.players['player1'].hand[0];
      const result = service.handleAction(room, 'player1', 'cast_spell', { cardUuid: card.uuid });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.phase).toBe('validate');
      }
    });
  });

  describe('proposeAndStack', () => {
    it('should propose action and push to stack', () => {
      const card = room.players['player1'].hand[0];
      const result = service.proposeAndStack(room, 'player1', 'cast_spell', { cardUuid: card.uuid });

      expect(result.success).toBe(true);
      expect(room.stack.length).toBe(1);
    });

    it('should not push to stack if propose fails', () => {
      room.players['player1'].mana.red = 0;
      const card = room.players['player1'].hand[0];
      const result = service.proposeAndStack(room, 'player1', 'cast_spell', { cardUuid: card.uuid });

      expect(result.success).toBe(false);
      expect(room.stack.length).toBe(0);
    });
  });

  describe('resolveTopOfStack', () => {
    it('should resolve the top stack object', () => {
      const card = room.players['player1'].hand[0];
      service.proposeAndStack(room, 'player1', 'cast_spell', { cardUuid: card.uuid });

      const result = service.resolveTopOfStack(room);
      expect(result.success).toBe(true);
      expect(room.stack.length).toBe(0);
    });

    it('should fail when stack is empty', () => {
      const result = service.resolveTopOfStack(room);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('Stack is empty');
      }
    });
  });
});
```

- [ ] **Step 4: Update state-machine.test.ts**

Update constructor calls from `new StateMachine(roomId, p1, p2, bus)` to `new StateMachine(room, bus)`:

```ts
// Find and replace all occurrences of:
new StateMachine('room-1', 'player1', 'player2', bus)
// With:
new StateMachine(room, bus)
```

Also update any assertions that reference removed fields:
- `sm.currentPhase` → `room.currentPhase`
- `sm.stack` → `room.stack`
- `sm.priorityPlayer` → `room.priorityPlayerId`
- `sm.lastPlayerToPass` → `room.lastPassedPlayerId`

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/engine/game-engine.test.ts tests/engine/play-card-handler.test.ts tests/engine/action-service.test.ts tests/engine/state-machine.test.ts
git commit -m "test: update tests for new GameEngine, StateMachine, ActionService signatures"
```

---

### Task 7: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass, zero failures.

- [ ] **Step 2: Type-check the project**

Run: `npx tsc --noEmit`
Expected: No TypeScript errors.

- [ ] **Step 3: Verify no remaining references to old patterns**

Run: `git grep "roomFactory\."` — should return nothing.
Run: `git grep "stateMachines\.get\|actionServices\.get\|eventBuses\.get" src/server.ts` — should return nothing.
Run: `git grep "room\.currentPhase = sm\.\|room\.priorityPlayerId = sm\.\|room\.lastPassedPlayerId = sm\.\|room\.activeTurnPlayerId = sm\." src/server.ts` — should return nothing.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: final verification after engine consolidation"
```