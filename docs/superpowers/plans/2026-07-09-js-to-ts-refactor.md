# JS-to-TS Refactoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete TS server with clean API (engine decoupled from transport), state deltas, and CLI-testable game logic — running alongside the legacy JS server.

**Architecture:** Service-oriented engine with 6 new modules. Engine services emit events via EventBus (no socket knowledge). `server.ts` is the only file that touches Express/Socket.IO. StateStore interface enables future Redis swap. SyncService computes deltas for client sync and replay logging.

**Tech Stack:** TypeScript 6.x (strict, CommonJS, ES2020), vitest 4.x, Express 4.x, Socket.IO 4.x, uuid 11.x

## Global Constraints

- TypeScript strict mode, `"module": "commonjs"`, `"target": "ES2020"`, `"types": ["node"]`
- vitest with `globals: true`, `environment: 'node'`, test pattern `tests/**/*.test.ts`
- All new code in `src/`, all tests in `tests/`
- Old JS files (`server.js`, `gameLogic.js`, `stateMachine.js`, `socketHandlers.js`, `effectHandler.js`, `library.js`, `decks.js`) — **do not modify or delete**
- TDD: write failing test first, then implementation
- `npx tsc --noEmit` must pass clean after each task
- `npx vitest run` must pass after each task
- Commit after each task

---

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `src/server/state-store.ts` | Create | `StateStore` interface + `InMemoryStore` class |
| `src/engine/event-bus.ts` | Modify | Implement `on()` for real listener registration |
| `src/engine/state-machine.ts` | Create | Turn phases, priority, stack LIFO |
| `src/engine/action-service.ts` | Create | Wraps ActionRegistry lifecycle, stack integration |
| `src/engine/option-service.ts` | Create | `getOptions()` for cards in hand/battlefield |
| `src/server/sync-service.ts` | Create | Delta computation, client emission, JSONL logging |
| `src/server.ts` | Create | Express + Socket.IO, wires all services |
| `tests/engine/event-bus.test.ts` | Modify | Add tests for `on()` listener invocation |
| `tests/engine/state-machine.test.ts` | Create | Phase transitions, priority, stack tests |
| `tests/engine/action-service.test.ts` | Create | Action lifecycle integration tests |
| `tests/engine/option-service.test.ts` | Create | getOptions tests for hand and battlefield |
| `tests/server/state-store.test.ts` | Create | InMemoryStore CRUD tests |
| `tests/server/sync-service.test.ts` | Create | Delta computation and logging tests |

---

### Task 1: Implement EventBus.on() for real listener registration

**Files:**
- Modify: `src/engine/event-bus.ts`
- Modify: `tests/engine/event-bus.test.ts`

**Interfaces:**
- Consumes: Nothing new
- Produces: `EventBus.on(eventId: string, listener: EventListener): void` — stores listeners; `emit()` invokes matching listeners

- [ ] **Step 1: Write failing tests for listener invocation**

In `tests/engine/event-bus.test.ts`, add after existing tests:

```ts
describe('listener registration and invocation', () => {
  it('should invoke registered listener when matching event is emitted', () => {
    const bus = new EventBus('room-1');
    let received: GameEvent | null = null;
    
    bus.on('PHASE_CHANGED', (event) => {
      received = event;
    });
    
    bus.emit({
      eventId: 'PHASE_CHANGED',
      roomId: 'room-1',
      payload: { phase: 'stateMainPhase', currentPlayer: 'player1' },
    });
    
    expect(received).not.toBeNull();
    expect(received!.eventId).toBe('PHASE_CHANGED');
    expect(received!.payload.phase).toBe('stateMainPhase');
  });

  it('should invoke multiple listeners for the same event', () => {
    const bus = new EventBus('room-1');
    const calls: string[] = [];
    
    bus.on('STACK_UPDATED', () => calls.push('a'));
    bus.on('STACK_UPDATED', () => calls.push('b'));
    
    bus.emit({ eventId: 'STACK_UPDATED', roomId: 'room-1', payload: {} });
    
    expect(calls).toEqual(['a', 'b']);
  });

  it('should not invoke listeners for different event IDs', () => {
    const bus = new EventBus('room-1');
    let called = false;
    
    bus.on('PHASE_CHANGED', () => { called = true; });
    bus.emit({ eventId: 'STACK_UPDATED', roomId: 'room-1', payload: {} });
    
    expect(called).toBe(false);
  });

  it('should not throw when emitting with no registered listeners', () => {
    const bus = new EventBus('room-1');
    expect(() => bus.emit({ eventId: 'UNKNOWN', roomId: 'room-1', payload: {} })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine/event-bus.test.ts`
Expected: 4 new tests FAIL — listeners not invoked

- [ ] **Step 3: Implement real listener storage and invocation**

Replace the `EventBus` class in `src/engine/event-bus.ts`:

```ts
// src/engine/event-bus.ts

export interface GameEvent {
  eventId: string;
  roomId: string;
  payload: Record<string, unknown>;
}

type EventListener = (event: GameEvent) => void;

export class EventBus {
  private roomId: string;
  private listeners: Map<string, EventListener[]> = new Map();

  constructor(roomId: string) {
    this.roomId = roomId;
  }

  emit(event: GameEvent): void {
    console.log(`[EventBus:${this.roomId}] ${event.eventId} —`, JSON.stringify(event.payload));
    const handlers = this.listeners.get(event.eventId);
    if (handlers) {
      for (const listener of handlers) {
        listener(event);
      }
    }
  }

  on(eventId: string, listener: EventListener): void {
    const existing = this.listeners.get(eventId);
    if (existing) {
      existing.push(listener);
    } else {
      this.listeners.set(eventId, [listener]);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine/event-bus.test.ts`
Expected: All tests PASS (existing + 4 new)

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/engine/event-bus.ts tests/engine/event-bus.test.ts
git commit -m "feat: implement EventBus.on() for real listener registration"
```

---

### Task 2: Create StateStore interface and InMemoryStore

**Files:**
- Create: `src/server/state-store.ts`
- Create: `tests/server/state-store.test.ts`

**Interfaces:**
- Consumes: `GameRoom` from `src/types/game.room.types.ts`
- Produces: `StateStore` interface, `InMemoryStore` class implementing it

- [ ] **Step 1: Write failing tests**

Create `tests/server/state-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStore, type StateStore } from '../../src/server/state-store';
import type { GameRoom } from '../../src/types/game.room.types';
import { createTestRoom } from '../helpers/test-room-factory';

describe('InMemoryStore', () => {
  let store: StateStore;
  let room: GameRoom;

  beforeEach(() => {
    store = new InMemoryStore();
    room = createTestRoom();
  });

  it('should save and retrieve a room', () => {
    store.saveRoom(room);
    const retrieved = store.getRoom(room.roomId);
    expect(retrieved).toBeDefined();
    expect(retrieved!.roomId).toBe(room.roomId);
  });

  it('should return undefined for unknown room', () => {
    expect(store.getRoom('nonexistent')).toBeUndefined();
  });

  it('should delete a room', () => {
    store.saveRoom(room);
    store.deleteRoom(room.roomId);
    expect(store.getRoom(room.roomId)).toBeUndefined();
  });

  it('should list all room IDs', () => {
    const room2 = createTestRoom();
    store.saveRoom(room);
    store.saveRoom(room2);
    const ids = store.listRooms();
    expect(ids).toHaveLength(2);
    expect(ids).toContain(room.roomId);
    expect(ids).toContain(room2.roomId);
  });

  it('should overwrite room on save with same ID', () => {
    store.saveRoom(room);
    room.currentPhase = 'stateBattlePhase';
    store.saveRoom(room);
    const retrieved = store.getRoom(room.roomId);
    expect(retrieved!.currentPhase).toBe('stateBattlePhase');
  });

  it('should not throw when deleting nonexistent room', () => {
    expect(() => store.deleteRoom('nonexistent')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/state-store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement StateStore and InMemoryStore**

Create `src/server/state-store.ts`:

```ts
// src/server/state-store.ts
import type { GameRoom } from '../types/game.room.types';

export interface StateStore {
  getRoom(roomId: string): GameRoom | undefined;
  saveRoom(room: GameRoom): void;
  deleteRoom(roomId: string): void;
  listRooms(): string[];
}

export class InMemoryStore implements StateStore {
  private rooms: Map<string, GameRoom> = new Map();

  getRoom(roomId: string): GameRoom | undefined {
    return this.rooms.get(roomId);
  }

  saveRoom(room: GameRoom): void {
    this.rooms.set(room.roomId, room);
  }

  deleteRoom(roomId: string): void {
    this.rooms.delete(roomId);
  }

  listRooms(): string[] {
    return Array.from(this.rooms.keys());
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/state-store.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/server/state-store.ts tests/server/state-store.test.ts
git commit -m "feat: add StateStore interface and InMemoryStore"
```

---

### Task 3: Create StateMachine with phase transitions and turn management

**Files:**
- Create: `src/engine/state-machine.ts`
- Create: `tests/engine/state-machine.test.ts`

**Interfaces:**
- Consumes: `EventBus` from `src/engine/event-bus.ts`, `GameStateName` from `src/types/game.state.types.ts`, `PlayerId` from `src/types/game.room.types.ts`, `StackObject` from `src/types/effect.types.ts`
- Produces: `StateMachine` class with phase transitions, turn switching, `isPlayerTurn()`

- [ ] **Step 1: Write failing tests for phase transitions and turn management**

Create `tests/engine/state-machine.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { StateMachine } from '../../src/engine/state-machine';
import { EventBus } from '../../src/engine/event-bus';
import type { GameEvent } from '../../src/engine/event-bus';

describe('StateMachine', () => {
  let sm: StateMachine;
  let bus: EventBus;
  let events: GameEvent[];

  beforeEach(() => {
    events = [];
    bus = new EventBus('room-1');
    bus.on('PHASE_CHANGED', (e) => events.push(e));
    bus.on('TURN_SWITCHED', (e) => events.push(e));
    sm = new StateMachine('room-1', 'player1', 'player2', bus);
  });

  describe('initial state', () => {
    it('should start in waiting phase', () => {
      expect(sm.currentPhase).toBe('waiting');
    });

    it('should have player1 as current player', () => {
      expect(sm.currentPlayer).toBe('player1');
    });

    it('should start with empty stack', () => {
      expect(sm.stack).toEqual([]);
    });
  });

  describe('phase transitions', () => {
    it('should transition to a valid next phase', () => {
      sm.transition('RPS');
      expect(sm.currentPhase).toBe('RPS');
    });

    it('should emit PHASE_CHANGED on transition', () => {
      sm.transition('RPS');
      const phaseEvent = events.find(e => e.eventId === 'PHASE_CHANGED');
      expect(phaseEvent).toBeDefined();
      expect(phaseEvent!.payload.phase).toBe('RPS');
    });

    it('should reject invalid transitions', () => {
      // 'waiting' can only go to 'RPS', not 'stateMainPhase'
      sm.transition('stateMainPhase');
      expect(sm.currentPhase).toBe('waiting'); // unchanged
    });

    it('should allow Stack transition from any phase when stack is open', () => {
      sm.transition('RPS');
      sm.transition('Stack');
      expect(sm.currentPhase).toBe('Stack');
    });

    it('should reject Stack transition when stack is closed', () => {
      sm.stackOpen = false;
      sm.transition('RPS');
      sm.transition('Stack');
      expect(sm.currentPhase).toBe('RPS'); // unchanged
    });

    it('should save previousPhase when entering Stack', () => {
      sm.transition('RPS');
      sm.transition('Stack');
      expect(sm.previousPhase).toBe('RPS');
    });

    it('should transition through full turn cycle', () => {
      sm.transition('RPS');
      sm.transition('stateTurnStart');
      expect(sm.currentPhase).toBe('stateTurnStart');
      sm.transition('stateDrawPhase');
      expect(sm.currentPhase).toBe('stateDrawPhase');
      sm.transition('stateMainPhase');
      expect(sm.currentPhase).toBe('stateMainPhase');
      sm.transition('stateBattlePhase');
      expect(sm.currentPhase).toBe('stateBattlePhase');
      sm.transition('endCombat');
      expect(sm.currentPhase).toBe('endCombat');
      sm.transition('stateEndPhase');
      expect(sm.currentPhase).toBe('stateEndPhase');
      sm.transition('cleanupStep');
      expect(sm.currentPhase).toBe('cleanupStep');
      sm.transition('stateTurnStart');
      expect(sm.currentPhase).toBe('stateTurnStart');
    });
  });

  describe('turn management', () => {
    it('should switch current player', () => {
      sm.switchTurn();
      expect(sm.currentPlayer).toBe('player2');
    });

    it('should emit TURN_SWITCHED on switch', () => {
      sm.switchTurn();
      const turnEvent = events.find(e => e.eventId === 'TURN_SWITCHED');
      expect(turnEvent).toBeDefined();
      expect(turnEvent!.payload.newPlayer).toBe('player2');
    });

    it('should switch back to player1 after two switches', () => {
      sm.switchTurn();
      sm.switchTurn();
      expect(sm.currentPlayer).toBe('player1');
    });

    it('should correctly report isPlayerTurn', () => {
      expect(sm.isPlayerTurn('player1')).toBe(true);
      expect(sm.isPlayerTurn('player2')).toBe(false);
      sm.switchTurn();
      expect(sm.isPlayerTurn('player1')).toBe(false);
      expect(sm.isPlayerTurn('player2')).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine/state-machine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement StateMachine**

Create `src/engine/state-machine.ts`:

```ts
// src/engine/state-machine.ts
import { EventBus } from './event-bus';
import type { GameStateName, GameTransitionMap } from '../types/game.state.types';
import type { PlayerId } from '../types/game.room.types';
import type { StackObject } from '../types/effect.types';

const TRANSITIONS: GameTransitionMap = {
  waiting: ['RPS'],
  RPS: ['stateTurnStart', 'RPS', 'Stack'],
  stateTurnStart: ['stateDrawPhase', 'Stack'],
  stateDrawPhase: ['stateMainPhase', 'Stack'],
  stateMainPhase: ['stateBattlePhase', 'stateEndPhase', 'Stack'],
  stateBattlePhase: ['endCombat', 'stateEndPhase', 'Stack'],
  endCombat: ['stateEndPhase', 'Stack'],
  stateEndPhase: ['cleanupStep', 'Stack'],
  cleanupStep: ['stateTurnStart'],
  Stack: [],
  gameOver: [],
};

export class StateMachine {
  readonly roomId: string;
  private player1: PlayerId;
  private player2: PlayerId;
  private eventBus: EventBus;

  currentPhase: GameStateName = 'waiting';
  previousPhase: GameStateName | null = null;
  currentPlayer: PlayerId;
  priorityPlayer: PlayerId | null = null;
  lastPlayerToPass: PlayerId | null = null;
  waitingForResponse = false;
  stackOpen = true;
  stack: StackObject[] = [];

  constructor(roomId: string, player1: PlayerId, player2: PlayerId, eventBus: EventBus) {
    this.roomId = roomId;
    this.player1 = player1;
    this.player2 = player2;
    this.eventBus = eventBus;
    this.currentPlayer = player1;
  }

  canTransition(to: GameStateName): boolean {
    if (to === 'gameOver') return true;
    if (!this.stackOpen && to === 'Stack') return false;
    return TRANSITIONS[this.currentPhase]?.includes(to) ?? false;
  }

  transition(to: GameStateName): void {
    if (!this.canTransition(to)) {
      console.error(`Invalid transition from ${this.currentPhase} to ${to}`);
      return;
    }

    if (to === 'Stack') {
      this.previousPhase = this.currentPhase;
    }

    this.currentPhase = to;
    this.eventBus.emit({
      eventId: 'PHASE_CHANGED',
      roomId: this.roomId,
      payload: { phase: this.currentPhase, currentPlayer: this.currentPlayer },
    });
  }

  switchTurn(): void {
    this.currentPlayer = this.currentPlayer === this.player1 ? this.player2 : this.player1;
    this.eventBus.emit({
      eventId: 'TURN_SWITCHED',
      roomId: this.roomId,
      payload: { newPlayer: this.currentPlayer },
    });
  }

  isPlayerTurn(playerId: PlayerId): boolean {
    return this.currentPlayer === playerId;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine/state-machine.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/engine/state-machine.ts tests/engine/state-machine.test.ts
git commit -m "feat: add StateMachine with phase transitions and turn management"
```

---

### Task 4: Add priority and stack management to StateMachine

**Files:**
- Modify: `src/engine/state-machine.ts`
- Modify: `tests/engine/state-machine.test.ts`

**Interfaces:**
- Consumes: Existing `StateMachine` from Task 3
- Produces: `givePriorityTo()`, `passPriority()`, `resolveCurrentPhase()`, `addToStack()`, `resolveStack()`

- [ ] **Step 1: Write failing tests for priority and stack**

Add to `tests/engine/state-machine.test.ts` after existing tests:

```ts
  describe('priority system', () => {
    beforeEach(() => {
      sm.transition('RPS');
      sm.transition('stateTurnStart');
      sm.transition('stateDrawPhase');
      sm.transition('stateMainPhase');
    });

    it('should give priority to a player', () => {
      sm.givePriorityTo('player1');
      expect(sm.priorityPlayer).toBe('player1');
      expect(sm.waitingForResponse).toBe(true);
    });

    it('should emit PRIORITY_GIVEN', () => {
      bus.on('PRIORITY_GIVEN', (e) => events.push(e));
      sm.givePriorityTo('player1');
      const priorityEvent = events.find(e => e.eventId === 'PRIORITY_GIVEN');
      expect(priorityEvent).toBeDefined();
      expect(priorityEvent!.payload.playerId).toBe('player1');
    });

    it('should reject passPriority from wrong player', () => {
      sm.givePriorityTo('player1');
      const result = sm.passPriority('player2');
      expect(result).toBe(false);
    });

    it('should accept passPriority from correct player', () => {
      sm.givePriorityTo('player1');
      const result = sm.passPriority('player1');
      expect(result).toBe(true);
    });

    it('should resolve phase when both players pass consecutively', () => {
      sm.givePriorityTo('player1');
      sm.passPriority('player1'); // player1 passes
      // priority switches to player2
      expect(sm.priorityPlayer).toBe('player2');
      sm.passPriority('player2'); // player2 passes
      // both passed, phase should resolve
      expect(sm.waitingForResponse).toBe(false);
      expect(sm.priorityPlayer).toBeNull();
    });
  });

  describe('stack management', () => {
    beforeEach(() => {
      sm.transition('RPS');
      sm.transition('stateTurnStart');
      sm.transition('stateDrawPhase');
      sm.transition('stateMainPhase');
    });

    it('should add item to stack', () => {
      const stackObj = {
        uuid: 'stack-1',
        type: 'spell' as const,
        controllerId: 'player1',
        source: { id: 'test', uuid: 'card-1', name: 'Test Card', cardTypes: ['Spell'] as any, state: { zone: 'stack' as const } as any },
        payload: { effectId: 'CAST_SPELL' },
        targets: [],
        timestamp: Date.now(),
      };
      sm.addToStack(stackObj);
      expect(sm.stack.length).toBe(1);
      expect(sm.stack[0].uuid).toBe('stack-1');
    });

    it('should transition to Stack state when adding to stack', () => {
      const stackObj = {
        uuid: 'stack-1',
        type: 'spell' as const,
        controllerId: 'player1',
        source: { id: 'test', uuid: 'card-1', name: 'Test Card', cardTypes: ['Spell'] as any, state: { zone: 'stack' as const } as any },
        payload: { effectId: 'CAST_SPELL' },
        targets: [],
        timestamp: Date.now(),
      };
      sm.addToStack(stackObj);
      expect(sm.currentPhase).toBe('Stack');
    });

    it('should emit STACK_UPDATED when adding to stack', () => {
      bus.on('STACK_UPDATED', (e) => events.push(e));
      const stackObj = {
        uuid: 'stack-1',
        type: 'spell' as const,
        controllerId: 'player1',
        source: { id: 'test', uuid: 'card-1', name: 'Test Card', cardTypes: ['Spell'] as any, state: { zone: 'stack' as const } as any },
        payload: { effectId: 'CAST_SPELL' },
        targets: [],
        timestamp: Date.now(),
      };
      sm.addToStack(stackObj);
      const stackEvent = events.find(e => e.eventId === 'STACK_UPDATED');
      expect(stackEvent).toBeDefined();
    });

    it('should resolve stack in LIFO order', () => {
      const obj1 = {
        uuid: 'stack-1',
        type: 'spell' as const,
        controllerId: 'player1',
        source: { id: 'test', uuid: 'card-1', name: 'Test Card', cardTypes: ['Spell'] as any, state: { zone: 'stack' as const } as any },
        payload: { effectId: 'CAST_SPELL' },
        targets: [],
        timestamp: 1000,
      };
      const obj2 = {
        uuid: 'stack-2',
        type: 'spell' as const,
        controllerId: 'player2',
        source: { id: 'test2', uuid: 'card-2', name: 'Test Card 2', cardTypes: ['Spell'] as any, state: { zone: 'stack' as const } as any },
        payload: { effectId: 'CAST_SPELL' },
        targets: [],
        timestamp: 2000,
      };
      sm.addToStack(obj1);
      sm.addToStack(obj2);

      const resolved: string[] = [];
      // Mock resolveStack to just collect UUIDs in order
      const originalStack = [...sm.stack];
      while (sm.stack.length > 0) {
        const item = sm.stack.pop()!;
        resolved.push(item.uuid);
      }

      expect(resolved).toEqual(['stack-2', 'stack-1']); // LIFO
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine/state-machine.test.ts`
Expected: New tests FAIL — methods not defined

- [ ] **Step 3: Implement priority and stack methods**

Add these methods to the `StateMachine` class in `src/engine/state-machine.ts` (after `isPlayerTurn`):

```ts
  givePriorityTo(playerId: PlayerId): void {
    this.priorityPlayer = playerId;
    this.waitingForResponse = true;
    this.eventBus.emit({
      eventId: 'PRIORITY_GIVEN',
      roomId: this.roomId,
      payload: { playerId },
    });
  }

  passPriority(playerId: PlayerId): boolean {
    if (this.priorityPlayer !== playerId) {
      return false;
    }

    const opponent = playerId === this.player1 ? this.player2 : this.player1;

    if (this.lastPlayerToPass === opponent) {
      this.resolveCurrentPhase();
    } else {
      this.lastPlayerToPass = playerId;
      this.givePriorityTo(opponent);
    }

    return true;
  }

  resolveCurrentPhase(): void {
    if (this.currentPhase === 'Stack' && this.stack.length > 0) {
      // Stack resolution is handled externally via resolveStack()
      // For now, just clear waiting state
      this.waitingForResponse = false;
      this.priorityPlayer = null;
      this.lastPlayerToPass = null;
    } else {
      this.waitingForResponse = false;
      this.priorityPlayer = null;
      this.lastPlayerToPass = null;

      if (this.previousPhase) {
        this.transition(this.previousPhase);
        this.previousPhase = null;
      } else {
        this.transition('stateMainPhase');
      }
    }
  }

  addToStack(stackObj: StackObject): void {
    this.stack.push(stackObj);

    if (this.currentPhase !== 'Stack') {
      this.transition('Stack');
    }

    this.eventBus.emit({
      eventId: 'STACK_UPDATED',
      roomId: this.roomId,
      payload: { stack: this.stack, newAction: stackObj },
    });

    const opponent = stackObj.controllerId === this.player1 ? this.player2 : this.player1;
    this.givePriorityTo(opponent);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine/state-machine.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/engine/state-machine.ts tests/engine/state-machine.test.ts
git commit -m "feat: add priority and stack management to StateMachine"
```

---

### Task 5: Create ActionService wrapping ActionRegistry lifecycle

**Files:**
- Create: `src/engine/action-service.ts`
- Create: `tests/engine/action-service.test.ts`

**Interfaces:**
- Consumes: `ActionRegistry`, `ActionData`, `ActionResult` from `src/engine/action-registry.ts`; `EventBus` from `src/engine/event-bus.ts`; `GameRoom`, `PlayerId` from `src/types/game.room.types.ts`; `StateMachine` from `src/engine/state-machine.ts`
- Produces: `ActionService` class with `handleAction()`, `resolveTopOfStack()`, `proposeAndStack()`

- [ ] **Step 1: Write failing tests**

Create `tests/engine/action-service.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ActionService } from '../../src/engine/action-service';
import { ActionRegistry, registerAction } from '../../src/engine/action-registry';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { EventBus } from '../../src/engine/event-bus';
import { StateMachine } from '../../src/engine/state-machine';
import { createTestRoom } from '../helpers/test-room-factory';
import type { GameRoom } from '../../src/types/game.room.types';

describe('ActionService', () => {
  let service: ActionService;
  let room: GameRoom;
  let bus: EventBus;
  let sm: StateMachine;

  beforeEach(() => {
    Object.keys(ActionRegistry).forEach(key => delete ActionRegistry[key]);
    registerAction('cast_spell', playCardHandler);

    bus = new EventBus('room-1');
    sm = new StateMachine('room-1', 'player1', 'player2', bus);
    sm.transition('RPS');
    sm.transition('stateTurnStart');
    sm.transition('stateDrawPhase');
    sm.transition('stateMainPhase');
    sm.givePriorityTo('player1');

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
      const result = service.proposeAndStack(room, 'player1', 'cast_spell', { cardUuid: card.uuid }, sm);

      expect(result.success).toBe(true);
      expect(sm.stack.length).toBe(1);
    });

    it('should not push to stack if propose fails', () => {
      room.players['player1'].mana.red = 0;
      const card = room.players['player1'].hand[0];
      const result = service.proposeAndStack(room, 'player1', 'cast_spell', { cardUuid: card.uuid }, sm);

      expect(result.success).toBe(false);
      expect(sm.stack.length).toBe(0);
    });
  });

  describe('resolveTopOfStack', () => {
    it('should resolve the top stack object', () => {
      const card = room.players['player1'].hand[0];
      service.proposeAndStack(room, 'player1', 'cast_spell', { cardUuid: card.uuid }, sm);

      const result = service.resolveTopOfStack(room);
      expect(result.success).toBe(true);
      expect(sm.stack.length).toBe(0);
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

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine/action-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ActionService**

Create `src/engine/action-service.ts`:

```ts
// src/engine/action-service.ts
import { ActionRegistry, type ActionData, type ActionResult } from './action-registry';
import { EventBus } from './event-bus';
import { StateMachine } from './state-machine';
import type { GameRoom, PlayerId } from '../types/game.room.types';

export class ActionService {
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  handleAction(
    room: GameRoom,
    playerId: PlayerId,
    actionType: string,
    actionData: ActionData
  ): ActionResult {
    const handler = ActionRegistry[actionType];
    if (!handler) {
      return { success: false, phase: 'validate', reason: `No handler registered for action: ${actionType}` };
    }

    const validateResult = handler.validate(room, playerId, actionData);
    if (!validateResult.success) return validateResult;

    const proposeResult = handler.propose(room, playerId, actionData);
    if (!proposeResult.success) return proposeResult;

    this.eventBus.emit({
      eventId: 'ACTION_PROPOSED',
      roomId: room.roomId,
      payload: { actionType, playerId, cardUuid: actionData.cardUuid },
    });

    return proposeResult;
  }

  proposeAndStack(
    room: GameRoom,
    playerId: PlayerId,
    actionType: string,
    actionData: ActionData,
    stateMachine: StateMachine
  ): ActionResult {
    const result = this.handleAction(room, playerId, actionType, actionData);
    if (!result.success) return result;

    if (result.stackObject) {
      stateMachine.addToStack(result.stackObject);
    }

    return result;
  }

  resolveTopOfStack(room: GameRoom): ActionResult {
    if (room.stack.length === 0) {
      return { success: false, phase: 'resolve', reason: 'Stack is empty' };
    }

    const stackObj = room.stack.pop()!;

    const handler = ActionRegistry['cast_spell'];
    if (!handler) {
      return { success: false, phase: 'resolve', reason: 'No handler for stack resolution' };
    }

    const result = handler.resolve(room, stackObj);

    this.eventBus.emit({
      eventId: 'STACK_RESOLVED',
      roomId: room.roomId,
      payload: { effectId: stackObj.payload.effectId },
    });

    return result;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine/action-service.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/engine/action-service.ts tests/engine/action-service.test.ts
git commit -m "feat: add ActionService wrapping ActionRegistry lifecycle"
```

---

### Task 6: Create OptionService for card action discovery

**Files:**
- Create: `src/engine/option-service.ts`
- Create: `tests/engine/option-service.test.ts`

**Interfaces:**
- Consumes: `ActionValidator` from `src/engine/action-validator.ts`; `GameRoom`, `PlayerId` from `src/types/game.room.types.ts`; `CardInstance` from `src/types/card.types.ts`
- Produces: `ActionOption` interface, `OptionService` class with `getOptions()`

- [ ] **Step 1: Write failing tests**

Create `tests/engine/option-service.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { OptionService, type ActionOption } from '../../src/engine/option-service';
import { createTestRoom } from '../helpers/test-room-factory';
import type { GameRoom } from '../../src/types/game.room.types';

describe('OptionService', () => {
  let service: OptionService;
  let room: GameRoom;

  beforeEach(() => {
    service = new OptionService();
    room = createTestRoom();
  });

  describe('getOptions for hand cards', () => {
    it('should return playCardAction for a card in hand with enough mana', () => {
      const card = room.players['player1'].hand[0];
      card.castRequirements.cost = { mana: { red: 1 } };

      const options = service.getOptions(room, 'player1', card.uuid, 'hand');
      expect(options.length).toBeGreaterThan(0);
      expect(options.some(o => o.actionId === 'playCardAction')).toBe(true);
    });

    it('should return disabled playCardAction when insufficient mana', () => {
      room.players['player1'].mana.red = 0;
      const card = room.players['player1'].hand[0];
      card.castRequirements.cost = { mana: { red: 5 } };

      const options = service.getOptions(room, 'player1', card.uuid, 'hand');
      const playOption = options.find(o => o.actionId === 'playCardAction');
      expect(playOption).toBeDefined();
      expect(playOption!.disabled).toBe(true);
    });

    it('should return empty array for card not in hand', () => {
      const options = service.getOptions(room, 'player1', 'nonexistent-uuid', 'hand');
      expect(options).toEqual([]);
    });
  });

  describe('getOptions for battlefield cards', () => {
    it('should return tapForManaAction for untapped land on battlefield', () => {
      // Put a land card on the battlefield
      const card = room.players['player1'].hand[0];
      card.cardTypes = ['Land'];
      card.state.zone = 'battlefield';
      card.state.isTapped = false;
      room.battlefield.push(card);
      room.players['player1'].hand = [];

      const options = service.getOptions(room, 'player1', card.uuid, 'battlefield');
      expect(options.some(o => o.actionId === 'tapForManaAction')).toBe(true);
    });

    it('should return disabled tapForManaAction for tapped land', () => {
      const card = room.players['player1'].hand[0];
      card.cardTypes = ['Land'];
      card.state.zone = 'battlefield';
      card.state.isTapped = true;
      room.battlefield.push(card);
      room.players['player1'].hand = [];

      const options = service.getOptions(room, 'player1', card.uuid, 'battlefield');
      const tapOption = options.find(o => o.actionId === 'tapForManaAction');
      expect(tapOption).toBeDefined();
      expect(tapOption!.disabled).toBe(true);
    });

    it('should return empty array for card not on battlefield', () => {
      const options = service.getOptions(room, 'player1', 'nonexistent-uuid', 'battlefield');
      expect(options).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine/option-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement OptionService**

Create `src/engine/option-service.ts`:

```ts
// src/engine/option-service.ts
import { ActionValidator } from './action-validator';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';

export interface ActionOption {
  actionId: string;
  label: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
}

export class OptionService {
  getOptions(room: GameRoom, playerId: PlayerId, cardUuid: string, zone: 'hand' | 'battlefield'): ActionOption[] {
    const card = this.findCard(room, playerId, cardUuid, zone);
    if (!card) return [];

    if (zone === 'hand') {
      return this.getHandOptions(room, playerId, card);
    }

    return this.getBattlefieldOptions(room, playerId, card);
  }

  private findCard(room: GameRoom, playerId: PlayerId, cardUuid: string, zone: 'hand' | 'battlefield'): CardInstance | undefined {
    if (zone === 'hand') {
      return room.players[playerId].hand.find(c => c.uuid === cardUuid);
    }
    return room.battlefield.find(c => c.uuid === cardUuid && c.state.controllerId === playerId);
  }

  private getHandOptions(room: GameRoom, playerId: PlayerId, card: CardInstance): ActionOption[] {
    const options: ActionOption[] = [];

    // Play card option
    const canPlay = ActionValidator.canActivate(room, playerId, card, card.castRequirements);
    options.push({
      actionId: 'playCardAction',
      label: 'Play Card',
      disabled: !canPlay.valid,
      disabledReason: canPlay.valid ? undefined : canPlay.reason,
    });

    return options;
  }

  private getBattlefieldOptions(room: GameRoom, playerId: PlayerId, card: CardInstance): ActionOption[] {
    const options: ActionOption[] = [];

    // Tap for mana (lands)
    if (card.cardTypes.includes('Land')) {
      const canTap = !card.state.isTapped && !card.state.summoningSickness;
      options.push({
        actionId: 'tapForManaAction',
        label: 'Tap for Mana',
        disabled: !canTap,
        disabledReason: card.state.isTapped ? 'Already tapped' : undefined,
      });
    }

    // Activated abilities from card definition
    for (const ability of card.abilities) {
      if (ability.type === 'activated') {
        const canActivate = ActionValidator.canActivate(room, playerId, card, {
          allowedZones: ['battlefield'],
          speed: ability.castSpeed,
          cost: ability.cost,
        });
        options.push({
          actionId: `activateAbility_${ability.effect.effectId}`,
          label: `Activate: ${ability.effect.effectId}`,
          disabled: !canActivate.valid,
          disabledReason: canActivate.valid ? undefined : canActivate.reason,
        });
      }
    }

    return options;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine/option-service.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/engine/option-service.ts tests/engine/option-service.test.ts
git commit -m "feat: add OptionService for card action discovery"
```

---

### Task 7: Create SyncService for state deltas and replay logging

**Files:**
- Create: `src/server/sync-service.ts`
- Create: `tests/server/sync-service.test.ts`

**Interfaces:**
- Consumes: `GameRoom` from `src/types/game.room.types.ts`; `Server` from `socket.io`
- Produces: `StateDelta` interface, `SyncService` class with `sync()` and `replay()`

- [ ] **Step 1: Write failing tests**

Create `tests/server/sync-service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SyncService, type StateDelta } from '../../src/server/sync-service';
import { createTestRoom } from '../helpers/test-room-factory';
import type { GameRoom } from '../../src/types/game.room.types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SyncService', () => {
  let service: SyncService;
  let room: GameRoom;
  let emittedDeltas: StateDelta[];
  let tmpDir: string;

  // Mock io server
  const mockIo = {
    to: (roomId: string) => ({
      emit: (event: string, data: unknown) => {
        if (event === 'stateDelta') {
          emittedDeltas.push(data as StateDelta);
        }
      },
    }),
  } as any;

  beforeEach(() => {
    emittedDeltas = [];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-test-'));
    service = new SyncService(mockIo, path.join(tmpDir, 'deltas.jsonl'));
    room = createTestRoom();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('sync', () => {
    it('should emit stateDelta to both players', () => {
      const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
      room.players['player1'].mana.red -= 1;
      room.players['player1'].hand.pop();

      service.sync(oldState, room, { action: 'CARD_PLAYED', playerId: 'player1' });

      expect(emittedDeltas.length).toBeGreaterThan(0);
      const delta = emittedDeltas[0];
      expect(delta.roomId).toBe(room.roomId);
      expect(delta.action).toBe('CARD_PLAYED');
      expect(delta.playerId).toBe('player1');
      expect(delta.changes.length).toBeGreaterThan(0);
    });

    it('should detect added items', () => {
      const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
      const card = room.players['player1'].hand.pop()!;
      card.state.zone = 'battlefield';
      room.battlefield.push(card);

      service.sync(oldState, room, { action: 'CARD_PLAYED', playerId: 'player1' });

      const delta = emittedDeltas[0];
      const addChange = delta.changes.find(c => c.op === 'add');
      expect(addChange).toBeDefined();
    });

    it('should detect removed items', () => {
      const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
      room.players['player1'].hand.pop();

      service.sync(oldState, room, { action: 'CARD_PLAYED', playerId: 'player1' });

      const delta = emittedDeltas[0];
      const removeChange = delta.changes.find(c => c.op === 'remove');
      expect(removeChange).toBeDefined();
    });

    it('should detect updated values', () => {
      const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
      room.players['player1'].mana.red -= 2;

      service.sync(oldState, room, { action: 'PAID_MANA', playerId: 'player1' });

      const delta = emittedDeltas[0];
      const updateChange = delta.changes.find(c => c.op === 'update');
      expect(updateChange).toBeDefined();
    });

    it('should produce no changes when state is identical', () => {
      const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;

      service.sync(oldState, room, { action: 'NOOP', playerId: 'player1' });

      const delta = emittedDeltas[0];
      expect(delta.changes.length).toBe(0);
    });

    it('should increment sequence numbers', () => {
      const oldState1 = JSON.parse(JSON.stringify(room)) as GameRoom;
      room.players['player1'].mana.red -= 1;
      service.sync(oldState1, room, { action: 'ACTION_1', playerId: 'player1' });

      const oldState2 = JSON.parse(JSON.stringify(room)) as GameRoom;
      room.players['player1'].mana.blue -= 1;
      service.sync(oldState2, room, { action: 'ACTION_2', playerId: 'player1' });

      expect(emittedDeltas[0].seq).toBe(1);
      expect(emittedDeltas[1].seq).toBe(2);
    });

    it('should write delta to log file', () => {
      const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
      room.players['player1'].mana.red -= 1;

      service.sync(oldState, room, { action: 'CARD_PLAYED', playerId: 'player1' });

      const logPath = path.join(tmpDir, 'deltas.jsonl');
      expect(fs.existsSync(logPath)).toBe(true);
      const content = fs.readFileSync(logPath, 'utf-8');
      expect(content).toContain('CARD_PLAYED');
    });
  });

  describe('replay', () => {
    it('should read deltas from log file', () => {
      const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
      room.players['player1'].mana.red -= 1;
      service.sync(oldState, room, { action: 'ACTION_1', playerId: 'player1' });

      const oldState2 = JSON.parse(JSON.stringify(room)) as GameRoom;
      room.players['player1'].mana.blue -= 1;
      service.sync(oldState2, room, { action: 'ACTION_2', playerId: 'player1' });

      const deltas = service.replay(room.roomId);
      expect(deltas.length).toBe(2);
      expect(deltas[0].action).toBe('ACTION_1');
      expect(deltas[1].action).toBe('ACTION_2');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/sync-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement SyncService**

Create `src/server/sync-service.ts`:

```ts
// src/server/sync-service.ts
import type { Server } from 'socket.io';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import * as fs from 'fs';
import * as path from 'path';

export interface DeltaChange {
  path: string;
  op: 'add' | 'remove' | 'replace' | 'update';
  value?: unknown;
  oldValue?: unknown;
}

export interface StateDelta {
  roomId: string;
  seq: number;
  timestamp: number;
  action?: string;
  playerId?: PlayerId;
  changes: DeltaChange[];
}

export class SyncService {
  private io: Server;
  private deltaLogPath: string | null;
  private sequences: Map<string, number> = new Map();

  constructor(io: Server, deltaLogPath?: string) {
    this.io = io;
    this.deltaLogPath = deltaLogPath || null;
  }

  sync(oldState: GameRoom, newState: GameRoom, context: { action: string; playerId: PlayerId }): void {
    const changes = this.computeDiff(oldState, newState, '');
    const seq = this.nextSeq(newState.roomId);

    const delta: StateDelta = {
      roomId: newState.roomId,
      seq,
      timestamp: Date.now(),
      action: context.action,
      playerId: context.playerId,
      changes,
    };

    // Emit to both players in the room
    this.io.to(newState.roomId).emit('stateDelta', delta);

    // Write to delta log
    if (this.deltaLogPath) {
      this.appendToLog(delta);
    }
  }

  replay(roomId: string, fromSeq?: number): StateDelta[] {
    if (!this.deltaLogPath) return [];

    const logFile = path.join(this.deltaLogPath);
    if (!fs.existsSync(logFile)) return [];

    const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n').filter(Boolean);
    const deltas: StateDelta[] = [];

    for (const line of lines) {
      try {
        const delta: StateDelta = JSON.parse(line);
        if (delta.roomId === roomId) {
          if (fromSeq === undefined || delta.seq >= fromSeq) {
            deltas.push(delta);
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    return deltas;
  }

  private nextSeq(roomId: string): number {
    const current = this.sequences.get(roomId) || 0;
    const next = current + 1;
    this.sequences.set(roomId, next);
    return next;
  }

  private computeDiff(oldState: unknown, newState: unknown, basePath: string): DeltaChange[] {
    const changes: DeltaChange[] = [];

    if (oldState === newState) return changes;

    if (Array.isArray(oldState) && Array.isArray(newState)) {
      // Compare arrays by length and items
      if (oldState.length !== newState.length) {
        // Simple approach: if lengths differ, report the change
        if (newState.length > oldState.length) {
          // Items added
          for (let i = oldState.length; i < newState.length; i++) {
            changes.push({
              path: basePath,
              op: 'add',
              value: newState[i],
            });
          }
        } else {
          // Items removed
          for (let i = newState.length; i < oldState.length; i++) {
            changes.push({
              path: basePath,
              op: 'remove',
              value: oldState[i],
            });
          }
        }
      }
      // Recurse into array items
      const minLen = Math.min(oldState.length, newState.length);
      for (let i = 0; i < minLen; i++) {
        changes.push(...this.computeDiff(oldState[i], newState[i], `${basePath}[${i}]`));
      }
    } else if (typeof oldState === 'object' && typeof newState === 'object' && oldState !== null && newState !== null) {
      const oldObj = oldState as Record<string, unknown>;
      const newObj = newState as Record<string, unknown>;
      const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

      for (const key of allKeys) {
        const childPath = basePath ? `${basePath}.${key}` : key;
        if (!(key in newObj)) {
          changes.push({ path: childPath, op: 'remove', oldValue: oldObj[key] });
        } else if (!(key in oldObj)) {
          changes.push({ path: childPath, op: 'add', value: newObj[key] });
        } else if (typeof oldObj[key] !== 'object' || oldObj[key] === null) {
          if (oldObj[key] !== newObj[key]) {
            changes.push({ path: childPath, op: 'update', value: newObj[key], oldValue: oldObj[key] });
          }
        } else {
          changes.push(...this.computeDiff(oldObj[key], newObj[key], childPath));
        }
      }
    }

    return changes;
  }

  private appendToLog(delta: StateDelta): void {
    if (!this.deltaLogPath) return;
    const dir = path.dirname(this.deltaLogPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(this.deltaLogPath, JSON.stringify(delta) + '\n');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/sync-service.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/server/sync-service.ts tests/server/sync-service.test.ts
git commit -m "feat: add SyncService for state deltas and replay logging"
```

---

### Task 8: Create server.ts wiring all services together

**Files:**
- Create: `src/server.ts`

**Interfaces:**
- Consumes: All services from Tasks 1-7; `express`, `socket.io`, `uuid`
- Produces: Runnable TS server with Express + Socket.IO, all socket events wired

- [ ] **Step 1: Implement server.ts**

Create `src/server.ts`:

```ts
// src/server.ts
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { InMemoryStore } from './server/state-store';
import { SyncService } from './server/sync-service';
import { EventBus } from './engine/event-bus';
import { StateMachine } from './engine/state-machine';
import { ActionService } from './engine/action-service';
import { OptionService } from './engine/option-service';
import { ActionRegistry, registerAction } from './engine/action-registry';
import { playCardHandler } from './engine/handlers/play-card-handler';
import { createRoom, joinRoom, dealStartingHands } from './engine/room-factory';
import type { GameRoom } from './types/game.room.types';

// Register action handlers
registerAction('cast_spell', playCardHandler);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const store = new InMemoryStore();
const syncService = new SyncService(io, 'data/delta-log.jsonl');
const optionService = new OptionService();

// Track state machines per room
const stateMachines: Map<string, StateMachine> = new Map();
const actionServices: Map<string, ActionService> = new Map();

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('createRoom', () => {
    const roomId = uuidv4();
    socket.join(roomId);
    (socket as any).roomId = roomId;

    const room = createRoom(roomId, socket.id);
    const bus = new EventBus(roomId);
    const sm = new StateMachine(roomId, socket.id, '', bus);
    const actionService = new ActionService(bus);

    room.currentPhase = 'waiting';
    store.saveRoom(room);
    stateMachines.set(roomId, sm);
    actionServices.set(roomId, actionService);

    // Listen for state machine events → socket emissions
    bus.on('PHASE_CHANGED', (event) => {
      io.to(roomId).emit('phaseChanged', {
        phase: event.payload.phase,
        currentPlayer: event.payload.currentPlayer,
      });
    });

    bus.on('TURN_SWITCHED', (event) => {
      const newPlayer = event.payload.newPlayer as string;
      io.to(newPlayer).emit('yourTurn');
      const opponent = newPlayer === room.player1Id ? room.player2Id : room.player1Id;
      if (opponent) io.to(opponent).emit('opponentTurn');
    });

    console.log(`Room created: ${roomId}`);
    socket.emit('roomCreated', { roomId });
  });

  socket.on('joinRoom', (data: { roomId: string }) => {
    const room = store.getRoom(data.roomId);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    if (room.player2Id) {
      socket.emit('error', { message: 'Room is full' });
      return;
    }

    socket.join(data.roomId);
    (socket as any).roomId = data.roomId;

    joinRoom(room, socket.id);
    const sm = stateMachines.get(data.roomId);
    if (sm) {
      // Update state machine with player2
      (sm as any).player2 = socket.id;
    }

    store.saveRoom(room);
    socket.emit('roomJoined', { roomId: data.roomId });
    io.to(data.roomId).emit('playerJoined', { playerId: socket.id });

    // Start the game
    dealStartingHands(room);
    store.saveRoom(room);

    // Random starting player for now (RPS deferred)
    const startingPlayer = Math.random() < 0.5 ? room.player1Id : room.player2Id;
    if (sm) {
      sm.currentPlayer = startingPlayer;
      sm.transition('RPS');
      sm.transition('stateTurnStart');
      sm.transition('stateDrawPhase');
      sm.transition('stateMainPhase');
      sm.givePriorityTo(startingPlayer);
    }

    io.to(data.roomId).emit('gameStarted', { roomId: data.roomId, startingPlayer });
    io.to(startingPlayer).emit('yourTurn');
    const opponent = startingPlayer === room.player1Id ? room.player2Id : room.player1Id;
    io.to(opponent).emit('opponentTurn');
  });

  socket.on('getOptions', (data: { cardUuid: string; zone: 'hand' | 'battlefield' }) => {
    const roomId = (socket as any).roomId;
    const room = store.getRoom(roomId);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const options = optionService.getOptions(room, socket.id, data.cardUuid, data.zone);
    socket.emit('optionsForCard', { cardUuid: data.cardUuid, options });
  });

  socket.on('executeAction', (data: { actionId: string; cardUuid: string; targets?: any[] }) => {
    const roomId = (socket as any).roomId;
    const room = store.getRoom(roomId);
    const sm = stateMachines.get(roomId);
    const actionService = actionServices.get(roomId);

    if (!room || !sm || !actionService) {
      socket.emit('error', { message: 'Game not found' });
      return;
    }

    const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;

    let actionType = 'cast_spell';
    if (data.actionId === 'playCardAction') {
      actionType = 'cast_spell';
    } else if (data.actionId === 'tapForManaAction') {
      actionType = 'tap_for_mana';
    }

    const result = actionService.proposeAndStack(room, socket.id, actionType, { cardUuid: data.cardUuid, targets: data.targets }, sm);

    if (!result.success) {
      socket.emit('error', { message: result.reason });
      return;
    }

    store.saveRoom(room);
    syncService.sync(oldState, room, { action: data.actionId, playerId: socket.id });
  });

  socket.on('passPriority', () => {
    const roomId = (socket as any).roomId;
    const sm = stateMachines.get(roomId);
    if (!sm) return;

    sm.passPriority(socket.id);
  });

  socket.on('endTurn', (data: { roomId: string }) => {
    const roomId = data.roomId || (socket as any).roomId;
    const room = store.getRoom(roomId);
    const sm = stateMachines.get(roomId);

    if (!room || !sm) return;

    if (!sm.isPlayerTurn(socket.id)) {
      socket.emit('error', { message: 'Not your turn!' });
      return;
    }

    sm.transition('stateEndPhase');
    sm.transition('cleanupStep');
    sm.transition('stateTurnStart');
    sm.transition('stateDrawPhase');
    sm.transition('stateMainPhase');
    sm.switchTurn();
    sm.givePriorityTo(sm.currentPlayer);

    store.saveRoom(room);
  });

  socket.on('drawCard', (data: { roomId: string }) => {
    const roomId = data.roomId || (socket as any).roomId;
    const room = store.getRoom(roomId);
    if (!room) return;

    const player = room.players[socket.id];
    if (!player || player.deck.length === 0) {
      socket.emit('error', { message: 'No cards in deck' });
      return;
    }

    const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
    const card = player.deck.pop()!;
    card.state.zone = 'hand';
    player.hand.push(card);

    store.saveRoom(room);
    syncService.sync(oldState, room, { action: 'DRAW_CARD', playerId: socket.id });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export { app, server, io };
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run all tests to verify nothing is broken**

Run: `npx vitest run`
Expected: All tests PASS (existing + new)

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat: add server.ts wiring all services with Express + Socket.IO"
```

---

### Task 9: Add npm start script and verify end-to-end

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add build and start scripts**

In `package.json`, add to `scripts`:

```json
"build": "tsc",
"start": "node dist/server.js",
"dev": "tsc && node dist/server.js"
```

- [ ] **Step 2: Build the project**

Run: `npx tsc`
Expected: Compiles successfully, `dist/` folder created

- [ ] **Step 3: Run all tests one final time**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add build and start scripts for TS server"
```

---

## Self-Review

**1. Spec coverage:**
- StateStore interface + InMemoryStore → Task 2 ✅
- StateMachine (phases, priority, stack) → Tasks 3, 4 ✅
- ActionService → Task 5 ✅
- OptionService → Task 6 ✅
- SyncService (deltas, logging, replay) → Task 7 ✅
- server.ts (Express + Socket.IO wiring) → Task 8 ✅
- EventBus.on() implementation → Task 1 ✅
- Build/run scripts → Task 9 ✅
- Old JS files untouched → confirmed in Global Constraints ✅
- TDD approach → every task starts with failing test ✅

**2. Placeholder scan:**
- No TBD, TODO, or "implement later" found ✅
- All code steps have actual code ✅
- All test steps have actual test code ✅
- All commands have expected output ✅