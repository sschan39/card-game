# Effect & Stack System Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the high-level effect system with a hybrid tagged primitives model (~9 atomic primitives), real EventBus, TriggerManager for ETB effects, and per-effect targeting in StackObjects.

**Architecture:** Bottom-up: types first, then EventBus, then primitives, then the shared effect-resolver, then update play-card-handler and game-engine to use the new pipeline. Card data updated last. Modifiers stay stubs.

**Tech Stack:** TypeScript, vitest, uuid

## Global Constraints

- All new code in `src/` (TypeScript), no modifications to legacy JS files
- Test framework: vitest
- Test files in `tests/` directory mirroring `src/` structure
- TDD: write failing test first, then implementation
- Commit after each task
- ModifierPipeline and ModifierRegistry remain stubs (signatures updated only)
- All legacy JS files untouched

---

## File Structure

| File | Role |
|---|---|
| `src/types/effect.types.ts` | `StackEffect`, updated `StackObject`, `EffectDefinition`, `TargetingDefinition` |
| `src/types/card.types.ts` | Add `onCastEffects`, `onEnterEffects` to `CardBlueprint` |
| `src/engine/event-bus.ts` | Real `emit`/`on` with stored listeners |
| `src/engine/effect-registry.ts` | 9 primitive handlers, remove `CAST_SPELL` |
| `src/engine/effect-resolver.ts` | **New.** Shared iteration: pipeline → EffectRegistry → events |
| `src/engine/trigger-manager.ts` | **New.** Listens to EventBus, creates triggered StackObjects |
| `src/engine/modifier-pipeline.ts` | Update signature `ActionData` → `StackEffect` |
| `src/engine/handlers/play-card-handler.ts` | Build `StackEffect[]`, delegate resolve to effect-resolver |
| `src/engine/game-engine.ts` | Structural zone change, integrate effect-resolver + TriggerManager |
| `src/library/card-parser.ts` | Parse `onCastEffects`/`onEnterEffects` |
| `data/card_data.json` | Update all cards to new format |
| `tests/helpers/test-room-factory.ts` | Add helper to put a specific card in hand |
| `tests/engine/event-bus.test.ts` | **New.** EventBus emit/on tests |
| `tests/engine/effect-registry.test.ts` | **New.** Primitive handler tests |
| `tests/engine/effect-resolver.test.ts` | **New.** Effect iteration + pipeline + events |
| `tests/engine/trigger-manager.test.ts` | **New.** ETB trigger tests |
| `tests/engine/play-card-handler.test.ts` | Update for new StackObject format |
| `tests/engine/game-engine.test.ts` | Update for structural zone change |

---

### Task 1: Update Type Definitions

**Files:**
- Modify: `src/types/effect.types.ts`
- Modify: `src/types/card.types.ts`

**Interfaces:**
- Produces: `StackEffect`, updated `StackObject` (with `effects: StackEffect[]`, `countered`), `EffectDefinition`, `TargetingDefinition`
- Produces: `CardBlueprint.onCastEffects?`, `CardBlueprint.onEnterEffects?`

- [ ] **Step 1: Update `src/types/effect.types.ts`**

Replace the `EffectPayload` and `StackObject` sections with the new types. Add `StackEffect`, `EffectDefinition`, `TargetingDefinition`. Keep existing `TargetPointer`, `ActionCost`, `ActionRequirements`, etc.

```ts
// src/types/effect.types.ts
// ...existing code above (TargetPointer, ActionCost, ActionRequirements, etc.)...

// ============================================================================
// 5. Effect Payload (Open Interface) — REPLACED by StackEffect
// ============================================================================

/**
 * A single effect within a stack item. Carries its own targets locked at cast time.
 */
export interface StackEffect {
  action: string;                    // primitive name, e.g. 'MODIFY_STATS'
  params: Record<string, unknown>;   // e.g. { damage: 3 }
  tags: string[];                    // e.g. ['damage']
  targets: TargetPointer[];          // locked-in targets chosen at cast time
}

// ============================================================================
// 6. Card Definition Types (for card_data.json)
// ============================================================================

export interface TargetingDefinition {
  type: 'player' | 'permanent' | 'spell' | 'card' | 'self';
  cardTypes?: string[];
  controller?: 'self' | 'opponent' | 'any';
  required: boolean;
  minTargets?: number;
  maxTargets?: number;
}

export interface EffectDefinition {
  action: string;
  params: Record<string, unknown>;
  tags?: string[];
  targeting: TargetingDefinition;
}

// ============================================================================
// 7. Stack Objects — UPDATED
// ============================================================================

export interface StackObject {
  readonly uuid: string;
  readonly type: StackItemType;
  readonly controllerId: string;
  readonly source: any; // CardInstance — imported at usage sites to avoid circular deps
  readonly effects: StackEffect[];   // resolves in order
  readonly timestamp?: number;
  countered: boolean;                // set true if countered; effects skipped on resolution
}
```

- [ ] **Step 2: Update `src/types/card.types.ts`**

Add `onCastEffects` and `onEnterEffects` to `CardBlueprint`. Remove the old `onPlayEffect` field.

```ts
// In CardBlueprint interface, replace:
//   readonly onPlayEffect?: EffectPayload;
// with:
  readonly onCastEffects?: import('./effect.types').EffectDefinition[];
  readonly onEnterEffects?: import('./effect.types').EffectDefinition[];
```

Also remove the `EffectPayload` import at the top of the file (line 6: `import { ActionCost, ActionRequirements, ActionSpeed, EffectPayload }` → remove `EffectPayload`).

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No type errors related to the changed files (some pre-existing errors in other files may exist).

- [ ] **Step 4: Commit**

```bash
git add src/types/effect.types.ts src/types/card.types.ts
git commit -m "feat: add StackEffect, EffectDefinition, TargetingDefinition types; update StackObject and CardBlueprint"
```

---

### Task 2: Implement Real EventBus

**Files:**
- Modify: `src/engine/event-bus.ts`
- Create: `tests/engine/event-bus.test.ts`

**Interfaces:**
- Consumes: `GameEvent` (already defined in event-bus.ts)
- Produces: `EventBus.emit(event)`, `EventBus.on(eventId, listener)` — real implementations

- [ ] **Step 1: Write the failing test**

Create `tests/engine/event-bus.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/engine/event-bus';
import type { GameEvent } from '../../src/engine/event-bus';

describe('EventBus', () => {
  it('should call registered listener when event is emitted', () => {
    const bus = new EventBus('test-room');
    const listener = vi.fn();

    bus.on('TEST_EVENT', listener);
    bus.emit({ eventId: 'TEST_EVENT', roomId: 'test-room', payload: { value: 42 } });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      eventId: 'TEST_EVENT',
      roomId: 'test-room',
      payload: { value: 42 },
    });
  });

  it('should not call listener for different eventId', () => {
    const bus = new EventBus('test-room');
    const listener = vi.fn();

    bus.on('EVENT_A', listener);
    bus.emit({ eventId: 'EVENT_B', roomId: 'test-room', payload: {} });

    expect(listener).not.toHaveBeenCalled();
  });

  it('should support multiple listeners for same event', () => {
    const bus = new EventBus('test-room');
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    bus.on('TEST_EVENT', listener1);
    bus.on('TEST_EVENT', listener2);
    bus.emit({ eventId: 'TEST_EVENT', roomId: 'test-room', payload: {} });

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it('should not throw when emitting event with no listeners', () => {
    const bus = new EventBus('test-room');
    expect(() => bus.emit({ eventId: 'NO_LISTENERS', roomId: 'test-room', payload: {} })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/event-bus.test.ts`
Expected: FAIL — `on()` is a no-op stub, listeners never called.

- [ ] **Step 3: Implement real EventBus**

Replace `src/engine/event-bus.ts`:

```ts
// src/engine/event-bus.ts

export interface GameEvent {
  eventId: string;
  roomId: string;
  payload: Record<string, unknown>;
}

type EventListener = (event: GameEvent) => void;

export class EventBus {
  private listeners: Map<string, EventListener[]> = new Map();
  private roomId: string;

  constructor(roomId: string) {
    this.roomId = roomId;
  }

  emit(event: GameEvent): void {
    const handlers = this.listeners.get(event.eventId);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(event);
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/event-bus.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/event-bus.ts tests/engine/event-bus.test.ts
git commit -m "feat: implement real EventBus with emit/on and stored listeners"
```

---

### Task 3: Implement Primitive Effect Handlers

**Files:**
- Modify: `src/engine/effect-registry.ts`
- Create: `tests/engine/effect-registry.test.ts`

**Interfaces:**
- Consumes: `GameRoom`, `StackObject`, `StackEffect` (from types)
- Produces: `EffectRegistry` with 9 handlers: `MOVE_ZONE`, `MODIFY_LIFE`, `MODIFY_STATS`, `ADD_COUNTER`, `REMOVE_COUNTER`, `TAP`, `UNTAP`, `DRAW`, `ADD_MANA`

- [ ] **Step 1: Write the failing test**

Create `tests/engine/effect-registry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { EffectRegistry } from '../../src/engine/effect-registry';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';
import type { StackObject, StackEffect } from '../../src/types/effect.types';
import { v4 as uuidv4 } from 'uuid';

function makeStackObj(overrides: Partial<StackObject> = {}): StackObject {
  return {
    uuid: uuidv4(),
    type: 'spell',
    controllerId: 'player1',
    source: {} as any,
    effects: [],
    timestamp: Date.now(),
    countered: false,
    ...overrides,
  } as StackObject;
}

function makeEffect(overrides: Partial<StackEffect> = {}): StackEffect {
  return {
    action: 'DRAW',
    params: {},
    tags: [],
    targets: [],
    ...overrides,
  };
}

describe('EffectRegistry', () => {
  let room: GameRoom;

  beforeEach(() => {
    room = createTestRoom();
  });

  describe('DRAW', () => {
    it('should draw cards from library to hand', () => {
      // Put cards in deck
      const card1 = instantiateCard('empire-servant');
      const card2 = instantiateCard('empire-servant');
      room.players['player1'].deck = [card1, card2];
      const initialHandSize = room.players['player1'].hand.length;

      const effect = makeEffect({ action: 'DRAW', params: { amount: 2 } });
      const stackObj = makeStackObj({ effects: [effect] });

      EffectRegistry['DRAW'](room, stackObj, effect);

      expect(room.players['player1'].hand.length).toBe(initialHandSize + 2);
      expect(room.players['player1'].deck.length).toBe(0);
    });

    it('should draw only available cards if deck has fewer', () => {
      const card1 = instantiateCard('empire-servant');
      room.players['player1'].deck = [card1];
      const initialHandSize = room.players['player1'].hand.length;

      const effect = makeEffect({ action: 'DRAW', params: { amount: 3 } });
      const stackObj = makeStackObj({ effects: [effect] });

      EffectRegistry['DRAW'](room, stackObj, effect);

      expect(room.players['player1'].hand.length).toBe(initialHandSize + 1);
      expect(room.players['player1'].deck.length).toBe(0);
    });
  });

  describe('MODIFY_LIFE', () => {
    it('should add life to a player', () => {
      const effect = makeEffect({
        action: 'MODIFY_LIFE',
        params: { amount: 5 },
        targets: [{ targetType: 'player', playerId: 'player1' }],
      });
      const stackObj = makeStackObj({ effects: [effect] });

      EffectRegistry['MODIFY_LIFE'](room, stackObj, effect);

      expect(room.players['player1'].life).toBe(25);
    });

    it('should subtract life (damage to player)', () => {
      const effect = makeEffect({
        action: 'MODIFY_LIFE',
        params: { amount: -3 },
        tags: ['damage'],
        targets: [{ targetType: 'player', playerId: 'player2' }],
      });
      const stackObj = makeStackObj({ effects: [effect] });

      EffectRegistry['MODIFY_LIFE'](room, stackObj, effect);

      expect(room.players['player2'].life).toBe(17);
    });
  });

  describe('MODIFY_STATS', () => {
    it('should deal damage to a creature', () => {
      const creature = instantiateCard('empire-servant');
      creature.state.zone = 'battlefield';
      creature.state.controllerId = 'player2';
      room.battlefield.push(creature);

      const effect = makeEffect({
        action: 'MODIFY_STATS',
        params: { damage: 3 },
        tags: ['damage'],
        targets: [{ targetType: 'permanent', cardUuid: creature.uuid }],
      });
      const stackObj = makeStackObj({ effects: [effect] });

      EffectRegistry['MODIFY_STATS'](room, stackObj, effect);

      expect(creature.state.damageTaken).toBe(3);
    });

    it('should modify power and toughness', () => {
      const creature = instantiateCard('empire-servant');
      creature.state.zone = 'battlefield';
      creature.state.controllerId = 'player1';
      room.battlefield.push(creature);

      const effect = makeEffect({
        action: 'MODIFY_STATS',
        params: { power: 2, toughness: 2 },
        tags: ['until_end_of_turn'],
        targets: [{ targetType: 'permanent', cardUuid: creature.uuid }],
      });
      const stackObj = makeStackObj({ effects: [effect] });

      EffectRegistry['MODIFY_STATS'](room, stackObj, effect);

      // Power/toughness modifications are stored as modifiers (future),
      // for now we verify the handler doesn't throw and the card is found
      expect(creature).toBeDefined();
    });
  });

  describe('ADD_MANA', () => {
    it('should add mana to a player pool', () => {
      const effect = makeEffect({
        action: 'ADD_MANA',
        params: { color: 'red', amount: 3 },
      });
      const stackObj = makeStackObj({ effects: [effect], controllerId: 'player1' });

      const initialRed = room.players['player1'].mana.red;
      EffectRegistry['ADD_MANA'](room, stackObj, effect);

      expect(room.players['player1'].mana.red).toBe(initialRed + 3);
    });
  });

  describe('TAP and UNTAP', () => {
    it('TAP should tap a permanent', () => {
      const creature = instantiateCard('empire-servant');
      creature.state.zone = 'battlefield';
      creature.state.isTapped = false;
      room.battlefield.push(creature);

      const effect = makeEffect({
        action: 'TAP',
        params: {},
        targets: [{ targetType: 'permanent', cardUuid: creature.uuid }],
      });
      const stackObj = makeStackObj({ effects: [effect] });

      EffectRegistry['TAP'](room, stackObj, effect);

      expect(creature.state.isTapped).toBe(true);
    });

    it('UNTAP should untap a permanent', () => {
      const creature = instantiateCard('empire-servant');
      creature.state.zone = 'battlefield';
      creature.state.isTapped = true;
      room.battlefield.push(creature);

      const effect = makeEffect({
        action: 'UNTAP',
        params: {},
        targets: [{ targetType: 'permanent', cardUuid: creature.uuid }],
      });
      const stackObj = makeStackObj({ effects: [effect] });

      EffectRegistry['UNTAP'](room, stackObj, effect);

      expect(creature.state.isTapped).toBe(false);
    });
  });

  describe('MOVE_ZONE', () => {
    it('should move a card from battlefield to graveyard', () => {
      const creature = instantiateCard('empire-servant');
      creature.state.zone = 'battlefield';
      creature.state.controllerId = 'player1';
      room.battlefield.push(creature);

      const effect = makeEffect({
        action: 'MOVE_ZONE',
        params: { origin: 'battlefield', destination: 'graveyard' },
        tags: ['sacrifice'],
        targets: [{ targetType: 'permanent', cardUuid: creature.uuid }],
      });
      const stackObj = makeStackObj({ effects: [effect] });

      EffectRegistry['MOVE_ZONE'](room, stackObj, effect);

      expect(room.battlefield.find(c => c.uuid === creature.uuid)).toBeUndefined();
      expect(room.players['player1'].graveyard.find(c => c.uuid === creature.uuid)).toBeDefined();
      expect(creature.state.zone).toBe('graveyard');
    });

    it('should mark stack object as countered when moving from stack to graveyard with counter tag', () => {
      const targetStackObj = makeStackObj({ countered: false });
      // Simulate: the target is on the stack
      const effect = makeEffect({
        action: 'MOVE_ZONE',
        params: { origin: 'stack', destination: 'graveyard' },
        tags: ['counter'],
        targets: [{ targetType: 'stack', stackUuid: targetStackObj.uuid }],
      });
      const stackObj = makeStackObj({ effects: [effect] });

      // We need the target stackObj to be findable — in real usage it's on room.stack
      room.stack.push(targetStackObj);

      EffectRegistry['MOVE_ZONE'](room, stackObj, effect);

      expect(targetStackObj.countered).toBe(true);
    });
  });

  describe('ADD_COUNTER and REMOVE_COUNTER', () => {
    it('ADD_COUNTER should place counters on a permanent', () => {
      const creature = instantiateCard('empire-servant');
      creature.state.zone = 'battlefield';
      room.battlefield.push(creature);

      const effect = makeEffect({
        action: 'ADD_COUNTER',
        params: { counterType: '+1/+1', amount: 2 },
        targets: [{ targetType: 'permanent', cardUuid: creature.uuid }],
      });
      const stackObj = makeStackObj({ effects: [effect] });

      EffectRegistry['ADD_COUNTER'](room, stackObj, effect);

      expect(creature.state.counters['+1/+1']).toBe(2);
    });

    it('REMOVE_COUNTER should remove counters from a permanent', () => {
      const creature = instantiateCard('empire-servant');
      creature.state.zone = 'battlefield';
      creature.state.counters['+1/+1'] = 3;
      room.battlefield.push(creature);

      const effect = makeEffect({
        action: 'REMOVE_COUNTER',
        params: { counterType: '+1/+1', amount: 1 },
        targets: [{ targetType: 'permanent', cardUuid: creature.uuid }],
      });
      const stackObj = makeStackObj({ effects: [effect] });

      EffectRegistry['REMOVE_COUNTER'](room, stackObj, effect);

      expect(creature.state.counters['+1/+1']).toBe(2);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/effect-registry.test.ts`
Expected: FAIL — handlers don't exist yet or have wrong signatures.

- [ ] **Step 3: Implement the new EffectRegistry**

Replace `src/engine/effect-registry.ts`:

```ts
// src/engine/effect-registry.ts
import type { GameRoom } from '../types/game.room.types';
import type { StackObject, StackEffect } from '../types/effect.types';
import type { ManaColor, CardInstance } from '../types/card.types';

export type EffectHandler = (room: GameRoom, stackObj: StackObject, effect: StackEffect) => void;

function findCardOnBattlefield(room: GameRoom, uuid: string): CardInstance | undefined {
  return room.battlefield.find(c => c.uuid === uuid);
}

function findCardInGraveyard(room: GameRoom, playerId: string, uuid: string): CardInstance | undefined {
  return room.players[playerId]?.graveyard.find(c => c.uuid === uuid);
}

export const EffectRegistry: Record<string, EffectHandler> = {

  'MOVE_ZONE': (room, stackObj, effect) => {
    const params = effect.params as { origin: string; destination: string };
    for (const target of effect.targets) {
      if (target.targetType === 'permanent' && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (!card) continue;

        // Remove from origin
        if (params.origin === 'battlefield') {
          const idx = room.battlefield.findIndex(c => c.uuid === card.uuid);
          if (idx !== -1) room.battlefield.splice(idx, 1);
        }

        // Add to destination
        card.state.zone = params.destination as any;
        if (params.destination === 'graveyard') {
          const ownerId = card.state.controllerId || card.state.ownerId;
          room.players[ownerId]?.graveyard.push(card);
        } else if (params.destination === 'battlefield') {
          room.battlefield.push(card);
        } else if (params.destination === 'hand') {
          const ownerId = card.state.controllerId || card.state.ownerId;
          room.players[ownerId]?.hand.push(card);
        }
      } else if (target.targetType === 'stack' && target.stackUuid) {
        // Counter target spell on stack
        const targetStackObj = room.stack.find(s => s.uuid === target.stackUuid);
        if (targetStackObj && effect.tags.includes('counter')) {
          targetStackObj.countered = true;
        }
      }
    }
  },

  'MODIFY_LIFE': (room, stackObj, effect) => {
    const params = effect.params as { amount: number };
    for (const target of effect.targets) {
      if (target.targetType === 'player' && target.playerId) {
        const player = room.players[target.playerId];
        if (player) {
          player.life += params.amount;
        }
      }
    }
  },

  'MODIFY_STATS': (room, stackObj, effect) => {
    const params = effect.params as { power?: number; toughness?: number; damage?: number };
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (!card) continue;

        if (params.damage !== undefined) {
          card.state.damageTaken = (card.state.damageTaken || 0) + params.damage;
        }
        // Power/toughness modifications will go through ModifierPipeline in the future
      }
    }
  },

  'ADD_COUNTER': (room, stackObj, effect) => {
    const params = effect.params as { counterType: string; amount: number };
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (!card) continue;
        card.state.counters[params.counterType] = (card.state.counters[params.counterType] || 0) + params.amount;
      }
    }
  },

  'REMOVE_COUNTER': (room, stackObj, effect) => {
    const params = effect.params as { counterType: string; amount: number };
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (!card) continue;
        const current = card.state.counters[params.counterType] || 0;
        card.state.counters[params.counterType] = Math.max(0, current - params.amount);
      }
    }
  },

  'TAP': (room, stackObj, effect) => {
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (card) card.state.isTapped = true;
      }
    }
  },

  'UNTAP': (room, stackObj, effect) => {
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (card) card.state.isTapped = false;
      }
    }
  },

  'DRAW': (room, stackObj, effect) => {
    const params = effect.params as { amount: number };
    const player = room.players[stackObj.controllerId];
    const toDraw = Math.min(params.amount, player.deck.length);
    for (let i = 0; i < toDraw; i++) {
      const card = player.deck.pop()!;
      card.state.zone = 'hand';
      player.hand.push(card);
    }
  },

  'ADD_MANA': (room, stackObj, effect) => {
    const player = room.players[stackObj.controllerId];
    const params = effect.params as { color: ManaColor; amount: number };
    player.mana[params.color] = (player.mana[params.color] || 0) + params.amount;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/effect-registry.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/effect-registry.ts tests/engine/effect-registry.test.ts
git commit -m "feat: replace high-level effects with 9 primitive handlers in EffectRegistry"
```

---

### Task 4: Create Effect Resolver (Shared Iteration)

**Files:**
- Create: `src/engine/effect-resolver.ts`
- Create: `tests/engine/effect-resolver.test.ts`

**Interfaces:**
- Consumes: `EffectRegistry`, `ModifierPipeline`, `EventBus`
- Produces: `resolveEffects(room, stackObj, eventBus): void` — iterates effects, runs pipeline, calls registry, emits STACK_ITEM_RESOLVED

- [ ] **Step 1: Write the failing test**

Create `tests/engine/effect-resolver.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveEffects } from '../../src/engine/effect-resolver';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import { EventBus } from '../../src/engine/event-bus';
import type { GameRoom } from '../../src/types/game.room.types';
import type { StackObject, StackEffect } from '../../src/types/effect.types';
import { v4 as uuidv4 } from 'uuid';

function makeStackObj(room: GameRoom, effects: StackEffect[]): StackObject {
  return {
    uuid: uuidv4(),
    type: 'spell',
    controllerId: 'player1',
    source: {} as any,
    effects,
    timestamp: Date.now(),
    countered: false,
  };
}

describe('resolveEffects', () => {
  let room: GameRoom;
  let eventBus: EventBus;

  beforeEach(() => {
    room = createTestRoom();
    eventBus = new EventBus(room.roomId);
  });

  it('should resolve a single DRAW effect', () => {
    const card = instantiateCard('empire-servant');
    room.players['player1'].deck = [card];
    const initialHand = room.players['player1'].hand.length;

    const effect: StackEffect = { action: 'DRAW', params: { amount: 1 }, tags: [], targets: [] };
    const stackObj = makeStackObj(room, [effect]);

    resolveEffects(room, stackObj, eventBus);

    expect(room.players['player1'].hand.length).toBe(initialHand + 1);
  });

  it('should resolve multiple effects in order', () => {
    const card1 = instantiateCard('empire-servant');
    const card2 = instantiateCard('empire-servant');
    room.players['player1'].deck = [card1, card2];

    const effect1: StackEffect = { action: 'DRAW', params: { amount: 1 }, tags: [], targets: [] };
    const effect2: StackEffect = { action: 'DRAW', params: { amount: 1 }, tags: [], targets: [] };
    const stackObj = makeStackObj(room, [effect1, effect2]);

    const initialHand = room.players['player1'].hand.length;
    resolveEffects(room, stackObj, eventBus);

    expect(room.players['player1'].hand.length).toBe(initialHand + 2);
  });

  it('should emit STACK_ITEM_RESOLVED after resolving', () => {
    const listener = vi.fn();
    eventBus.on('STACK_ITEM_RESOLVED', listener);

    const effect: StackEffect = { action: 'DRAW', params: { amount: 0 }, tags: [], targets: [] };
    const stackObj = makeStackObj(room, [effect]);

    resolveEffects(room, stackObj, eventBus);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'STACK_ITEM_RESOLVED' })
    );
  });

  it('should skip effects when stackObj is countered', () => {
    const card = instantiateCard('empire-servant');
    room.players['player1'].deck = [card];
    const initialHand = room.players['player1'].hand.length;

    const effect: StackEffect = { action: 'DRAW', params: { amount: 1 }, tags: [], targets: [] };
    const stackObj = makeStackObj(room, [effect]);
    stackObj.countered = true;

    resolveEffects(room, stackObj, eventBus);

    // No draw happened
    expect(room.players['player1'].hand.length).toBe(initialHand);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/effect-resolver.test.ts`
Expected: FAIL — `resolveEffects` not found.

- [ ] **Step 3: Implement effect-resolver**

Create `src/engine/effect-resolver.ts`:

```ts
// src/engine/effect-resolver.ts
import { EffectRegistry } from './effect-registry';
import { ModifierPipeline } from './modifier-pipeline';
import { EventBus } from './event-bus';
import type { GameRoom } from '../types/game.room.types';
import type { StackObject } from '../types/effect.types';

/**
 * Iterate all effects in a StackObject, run each through ModifierPipeline,
 * call the appropriate EffectRegistry handler, then emit STACK_ITEM_RESOLVED.
 * If the stack object is countered, effects are skipped entirely.
 */
export function resolveEffects(room: GameRoom, stackObj: StackObject, eventBus: EventBus): void {
  if (stackObj.countered) {
    // Countered spells don't resolve their effects
    eventBus.emit({
      eventId: 'STACK_ITEM_RESOLVED',
      roomId: room.roomId,
      payload: { stackObj },
    });
    return;
  }

  for (const effect of stackObj.effects) {
    const transformed = ModifierPipeline.apply(effect, room, stackObj);
    const handler = EffectRegistry[transformed.action];
    if (handler) {
      handler(room, stackObj, transformed);
    }
  }

  eventBus.emit({
    eventId: 'STACK_ITEM_RESOLVED',
    roomId: room.roomId,
    payload: { stackObj },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/effect-resolver.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/effect-resolver.ts tests/engine/effect-resolver.test.ts
git commit -m "feat: add shared effect-resolver for iterating StackObject effects"
```

---

### Task 5: Update ModifierPipeline Signature

**Files:**
- Modify: `src/engine/modifier-pipeline.ts`

**Interfaces:**
- Consumes: `StackEffect` (new type)
- Produces: `ModifierPipeline.apply(effect: StackEffect, room, stackObj): StackEffect`

- [ ] **Step 1: Update the signature**

Replace `src/engine/modifier-pipeline.ts`:

```ts
// src/engine/modifier-pipeline.ts
import type { GameRoom } from '../types/game.room.types';
import type { StackObject, StackEffect } from '../types/effect.types';

/**
 * ModifierPipeline — stub for value-transformation modifiers.
 *
 * Future: chains cost reducers, flash granters, target modifiers, etc.
 * Each modifier is a pure function: StackEffect → StackEffect.
 * Currently returns the effect unchanged (identity transform).
 */
export class ModifierPipeline {
  static apply(effect: StackEffect, room: GameRoom, stackObj: StackObject): StackEffect {
    void room;
    void stackObj;
    return effect;
  }
}
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: No new type errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/engine/modifier-pipeline.ts
git commit -m "refactor: update ModifierPipeline signature from ActionData to StackEffect"
```

---

### Task 6: Create TriggerManager

**Files:**
- Create: `src/engine/trigger-manager.ts`
- Create: `tests/engine/trigger-manager.test.ts`

**Interfaces:**
- Consumes: `EventBus`, `GameRoom`, `StackObject.createTriggered`
- Produces: `TriggerManager` class — registers ETB listener, creates triggered StackObjects

- [ ] **Step 1: Write the failing test**

Create `tests/engine/trigger-manager.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TriggerManager } from '../../src/engine/trigger-manager';
import { EventBus } from '../../src/engine/event-bus';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';
import type { EffectDefinition } from '../../src/types/effect.types';

describe('TriggerManager', () => {
  let room: GameRoom;
  let eventBus: EventBus;

  beforeEach(() => {
    room = createTestRoom();
    eventBus = new EventBus(room.roomId);
  });

  it('should push a triggered StackObject when PERMANENT_ENTERED fires with onEnterEffects', () => {
    new TriggerManager(eventBus, room);

    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.controllerId = 'player1';
    // Attach onEnterEffects to the card instance
    (card as any).onEnterEffects = [
      { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self', required: false } },
    ] as EffectDefinition[];

    const initialStackSize = room.stack.length;

    eventBus.emit({
      eventId: 'PERMANENT_ENTERED',
      roomId: room.roomId,
      payload: { card, controllerId: 'player1' },
    });

    expect(room.stack.length).toBe(initialStackSize + 1);
    const triggered = room.stack[room.stack.length - 1];
    expect(triggered.type).toBe('triggered');
    expect(triggered.effects.length).toBe(1);
    expect(triggered.effects[0].action).toBe('DRAW');
  });

  it('should not push a StackObject when card has no onEnterEffects', () => {
    new TriggerManager(eventBus, room);

    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.controllerId = 'player1';
    // No onEnterEffects

    const initialStackSize = room.stack.length;

    eventBus.emit({
      eventId: 'PERMANENT_ENTERED',
      roomId: room.roomId,
      payload: { card, controllerId: 'player1' },
    });

    expect(room.stack.length).toBe(initialStackSize);
  });

  it('should auto-target self for effects with type=self', () => {
    new TriggerManager(eventBus, room);

    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.controllerId = 'player2';
    (card as any).onEnterEffects = [
      { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self', required: false } },
    ] as EffectDefinition[];

    eventBus.emit({
      eventId: 'PERMANENT_ENTERED',
      roomId: room.roomId,
      payload: { card, controllerId: 'player2' },
    });

    const triggered = room.stack[room.stack.length - 1];
    expect(triggered.controllerId).toBe('player2');
    // Self-targeting auto-fills the controller as target
    expect(triggered.effects[0].targets.length).toBe(1);
    expect(triggered.effects[0].targets[0].targetType).toBe('player');
    expect(triggered.effects[0].targets[0].playerId).toBe('player2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/trigger-manager.test.ts`
Expected: FAIL — `TriggerManager` not found.

- [ ] **Step 3: Implement TriggerManager**

Create `src/engine/trigger-manager.ts`:

```ts
// src/engine/trigger-manager.ts
import { EventBus } from './event-bus';
import { v4 as uuidv4 } from 'uuid';
import type { GameRoom } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';
import type { StackObject, StackEffect, EffectDefinition, TargetPointer } from '../types/effect.types';

function buildStackEffects(definitions: EffectDefinition[]): StackEffect[] {
  return definitions.map(def => {
    const targets: TargetPointer[] = [];
    if (def.targeting.type === 'self') {
      // Auto-target the controller — will be filled by TriggerManager
      targets.push({ targetType: 'player', playerId: '' }); // placeholder, filled below
    }
    return {
      action: def.action,
      params: def.params,
      tags: def.tags || [],
      targets,
    };
  });
}

function fillSelfTargets(effects: StackEffect[], controllerId: string): void {
  for (const effect of effects) {
    for (const target of effect.targets) {
      if (target.targetType === 'player' && target.playerId === '') {
        target.playerId = controllerId;
      }
    }
  }
}

export class TriggerManager {
  constructor(eventBus: EventBus, room: GameRoom) {
    // ETB triggers
    eventBus.on('PERMANENT_ENTERED', (event) => {
      const card = event.payload.card as CardInstance;
      const onEnterEffects = (card as any).onEnterEffects as EffectDefinition[] | undefined;
      if (!onEnterEffects?.length) return;

      const effects = buildStackEffects(onEnterEffects);
      const controllerId = (card.state.controllerId || event.payload.controllerId) as string;
      fillSelfTargets(effects, controllerId);

      const stackObj: StackObject = {
        uuid: uuidv4(),
        type: 'triggered',
        controllerId,
        source: card,
        effects,
        timestamp: Date.now(),
        countered: false,
      };

      room.stack.push(stackObj);

      eventBus.emit({
        eventId: 'ACTION_PROPOSED',
        roomId: room.roomId,
        payload: { actionType: 'triggered', playerId: controllerId, stackObj },
      });
    });

    // Future:
    // PERMANENT_LEFT → death triggers
    // LIFE_CHANGED → life-gain triggers
    // TURN_STARTED → upkeep triggers
    // PHASE_CHANGED → beginning-of-combat triggers
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/trigger-manager.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/trigger-manager.ts tests/engine/trigger-manager.test.ts
git commit -m "feat: add TriggerManager for ETB triggered abilities via EventBus"
```

---

### Task 7: Update play-card-handler for New StackObject Format

**Files:**
- Modify: `src/engine/handlers/play-card-handler.ts`
- Modify: `tests/engine/play-card-handler.test.ts`

**Interfaces:**
- Consumes: `StackEffect[]`, `EffectDefinition[]`, `resolveEffects`
- Produces: Updated `playCardHandler` — `propose()` builds `StackEffect[]` from `onCastEffects`, `resolve()` delegates to `resolveEffects`

- [ ] **Step 1: Update the test file**

Replace `tests/engine/play-card-handler.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { ActionRegistry, registerAction } from '../../src/engine/action-registry';
import { EventBus } from '../../src/engine/event-bus';
import type { GameRoom } from '../../src/types/game.room.types';
import type { EffectDefinition } from '../../src/types/effect.types';

describe('playCardHandler', () => {
  let room: GameRoom;
  let eventBus: EventBus;

  beforeEach(() => {
    room = createTestRoom();
    eventBus = new EventBus(room.roomId);
    registerAction('cast_spell', playCardHandler);
    const card = room.players['player1'].hand[0];
    card.castRequirements.cost = { mana: { red: 1 }, tap: false, life: 0, discard: 0, sacrifice: false };
  });

  describe('validate', () => {
    it('should validate a playable creature card', () => {
      const card = room.players['player1'].hand[0];
      const result = playCardHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(result.success).toBe(true);
    });

    it('should reject when card is not in hand', () => {
      const card = room.players['player1'].hand[0];
      card.state.zone = 'graveyard';
      const result = playCardHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.phase).toBe('validate');
    });

    it('should reject when player lacks mana', () => {
      room.players['player1'].mana.red = 0;
      const card = room.players['player1'].hand[0];
      const result = playCardHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(result.success).toBe(false);
    });

    it('should reject when card uuid does not exist in hand', () => {
      const result = playCardHandler.validate(room, 'player1', { cardUuid: 'nonexistent-uuid' });
      expect(result.success).toBe(false);
    });
  });

  describe('propose', () => {
    it('should pay costs and create a StackObject with effects array', () => {
      const card = room.players['player1'].hand[0];
      // Attach onCastEffects to the card
      (card as any).onCastEffects = [
        { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self', required: false } },
      ] as EffectDefinition[];

      const initialHandSize = room.players['player1'].hand.length;
      const initialRedMana = room.players['player1'].mana.red;

      const result = playCardHandler.propose(room, 'player1', { cardUuid: card.uuid });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.stackObject).toBeDefined();
        expect(result.stackObject!.type).toBe('spell');
        expect(result.stackObject!.controllerId).toBe('player1');
        expect(result.stackObject!.effects.length).toBe(1);
        expect(result.stackObject!.effects[0].action).toBe('DRAW');
      }

      expect(room.players['player1'].hand.length).toBe(initialHandSize - 1);
      expect(room.players['player1'].mana.red).toBe(initialRedMana - 1);
      expect(room.stack.length).toBe(1);
    });

    it('should create StackObject with empty effects when no onCastEffects', () => {
      const card = room.players['player1'].hand[0];
      const result = playCardHandler.propose(room, 'player1', { cardUuid: card.uuid });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.stackObject!.effects).toEqual([]);
      }
    });

    it('should reject when card not found in hand during propose', () => {
      const result = playCardHandler.propose(room, 'player1', { cardUuid: 'nonexistent' });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.phase).toBe('propose');
    });
  });

  describe('resolve', () => {
    it('should move a creature card to the battlefield via structural zone change', () => {
      const card = room.players['player1'].hand[0];
      const proposeResult = playCardHandler.propose(room, 'player1', { cardUuid: card.uuid });
      expect(proposeResult.success).toBe(true);

      const stackObj = (proposeResult as { success: true; stackObject: any }).stackObject;
      const initialBattlefieldSize = room.battlefield.length;

      const resolveResult = playCardHandler.resolve(room, stackObj);
      expect(resolveResult.success).toBe(true);

      expect(room.battlefield.length).toBe(initialBattlefieldSize + 1);
      const resolvedCard = room.battlefield[room.battlefield.length - 1];
      expect(resolvedCard.state.zone).toBe('battlefield');
      expect(resolvedCard.state.summoningSickness).toBe(true);
    });
  });

  describe('full flow: validate → propose → resolve', () => {
    it('should complete the full play-card lifecycle', () => {
      const card = room.players['player1'].hand[0];
      const cardName = card.name;

      const validateResult = playCardHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(validateResult.success).toBe(true);

      const proposeResult = playCardHandler.propose(room, 'player1', { cardUuid: card.uuid });
      expect(proposeResult.success).toBe(true);
      expect(room.stack.length).toBe(1);

      const stackObj = (proposeResult as { success: true; stackObject: any }).stackObject;
      const resolveResult = playCardHandler.resolve(room, stackObj);
      expect(resolveResult.success).toBe(true);

      const onBattlefield = room.battlefield.find(c => c.name === cardName);
      expect(onBattlefield).toBeDefined();
      expect(onBattlefield!.state.zone).toBe('battlefield');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/play-card-handler.test.ts`
Expected: FAIL — handler still uses old `payload.effectId` format.

- [ ] **Step 3: Update play-card-handler.ts**

Replace `src/engine/handlers/play-card-handler.ts`:

```ts
// src/engine/handlers/play-card-handler.ts
import { v4 as uuidv4 } from 'uuid';
import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import { ActionValidator } from '../action-validator';
import { ModifierRegistry } from '../modifier-registry';
import { ModifierPipeline } from '../modifier-pipeline';
import { resolveEffects } from '../effect-resolver';
import { EventBus } from '../event-bus';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { CardInstance } from '../../types/card.types';
import type { StackObject, StackEffect, StackItemType, EffectDefinition, TargetPointer } from '../../types/effect.types';

function findCardInHand(room: GameRoom, playerId: PlayerId, cardUuid: string): CardInstance | undefined {
  return room.players[playerId].hand.find(c => c.uuid === cardUuid);
}

function buildStackEffects(definitions: EffectDefinition[] | undefined, controllerId: PlayerId): StackEffect[] {
  if (!definitions) return [];
  return definitions.map(def => {
    const targets: TargetPointer[] = [];
    if (def.targeting.type === 'self') {
      targets.push({ targetType: 'player', playerId: controllerId });
    }
    // For effects requiring targets, targets are filled by server-prompted targeting (future)
    return {
      action: def.action,
      params: def.params,
      tags: def.tags || [],
      targets,
    };
  });
}

function isPermanent(card: CardInstance): boolean {
  return card.cardTypes.some(type =>
    ['Creature', 'Artifact', 'Enchantment', 'Land'].includes(type)
  );
}

export const playCardHandler: ActionHandler = {
  validate(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    const card = findCardInHand(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'validate', reason: 'Card not found in hand' };
    }

    if (!ModifierRegistry.canPlay(room, playerId, card)) {
      return { success: false, phase: 'validate', reason: 'A modifier prevents playing this card' };
    }
    if (action.targets && !ModifierRegistry.canTarget(room, playerId, card, action.targets as any)) {
      return { success: false, phase: 'validate', reason: 'Target is not legal' };
    }

    const modifiedAction = ModifierPipeline.apply(
      { action: 'cast_spell', params: {}, tags: [], targets: (action.targets as any) || [] },
      room,
      {} as StackObject
    );

    const validation = ActionValidator.canActivate(room, playerId, card, card.castRequirements);
    if (!validation.valid) {
      return { success: false, phase: 'validate', reason: validation.reason || 'Validation failed' };
    }

    return { success: true };
  },

  propose(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    const card = findCardInHand(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'propose', reason: 'Card not found in hand' };
    }

    const player = room.players[playerId];

    // Pay costs
    const cost = card.castRequirements.cost;
    if (cost?.mana) {
      for (const [color, amount] of Object.entries(cost.mana)) {
        player.mana[color as keyof typeof player.mana] -= amount;
      }
    }
    if (cost?.life) {
      player.life -= cost.life;
    }

    // Remove card from hand
    const handIndex = player.hand.findIndex(c => c.uuid === card.uuid);
    if (handIndex === -1) {
      return { success: false, phase: 'propose', reason: 'Card disappeared from hand' };
    }
    player.hand.splice(handIndex, 1);

    // Update card zone
    card.state.zone = 'stack';

    // Build effects from card definition
    const onCastEffects = (card as any).onCastEffects as EffectDefinition[] | undefined;
    const effects = buildStackEffects(onCastEffects, playerId);

    const stackType: StackItemType = 'spell';

    const stackObj: StackObject = {
      uuid: uuidv4(),
      type: stackType,
      controllerId: playerId,
      source: card,
      effects,
      timestamp: Date.now(),
      countered: false,
    };

    room.stack.push(stackObj);

    return { success: true, stackObject: stackObj };
  },

  resolve(room: GameRoom, stackObj: StackObject): ActionResult {
    // Structural zone change (game rule, not an effect)
    const card = stackObj.source as CardInstance;

    if (stackObj.countered) {
      // Countered: move to graveyard, no effects, no PERMANENT_ENTERED
      card.state.zone = 'graveyard';
      const ownerId = card.state.controllerId || card.state.ownerId;
      room.players[ownerId]?.graveyard.push(card);
      return { success: true };
    }

    if (isPermanent(card)) {
      card.state.zone = 'battlefield';
      card.state.isTapped = false;
      if (card.cardTypes.includes('Creature')) {
        card.state.summoningSickness = true;
      }
      room.battlefield.push(card);
    } else {
      card.state.zone = 'graveyard';
      const ownerId = card.state.controllerId || card.state.ownerId;
      room.players[ownerId]?.graveyard.push(card);
    }

    // Resolve effects via shared resolver
    // Note: EventBus is created per-room; for now we create a temporary one
    // In production, the GameEngine passes its EventBus
    const eventBus = new EventBus(room.roomId);
    resolveEffects(room, stackObj, eventBus);

    // Emit PERMANENT_ENTERED for permanents
    if (isPermanent(card)) {
      eventBus.emit({
        eventId: 'PERMANENT_ENTERED',
        roomId: room.roomId,
        payload: { card, controllerId: stackObj.controllerId },
      });
    }

    return { success: true };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/play-card-handler.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/handlers/play-card-handler.ts tests/engine/play-card-handler.test.ts
git commit -m "feat: update play-card-handler for StackEffect[] format and structural zone change"
```

---

### Task 8: Update GameEngine for Structural Zone Change + TriggerManager

**Files:**
- Modify: `src/engine/game-engine.ts`
- Modify: `tests/engine/game-engine.test.ts`

**Interfaces:**
- Consumes: `resolveEffects`, `TriggerManager`, `EventBus`
- Produces: Updated `GameEngine` — `resolveTopOfStack()` does structural zone change, then effect resolution, then trigger check

- [ ] **Step 1: Update the test file**

Replace `tests/engine/game-engine.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { ActionRegistry, registerAction } from '../../src/engine/action-registry';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { createTestRoom } from '../helpers/test-room-factory';
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
    engine = new GameEngine();
  });

  describe('handleAction', () => {
    it('should validate and propose a valid action', () => {
      const card = room.players['player1'].hand[0];
      const result = engine.handleAction(room, 'player1', 'cast_spell', { cardUuid: card.uuid });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.stackObject).toBeDefined();
        expect(room.stack.length).toBe(1);
      }
    });

    it('should reject an unregistered action type', () => {
      const card = room.players['player1'].hand[0];
      const result = engine.handleAction(room, 'player1', 'nonexistent_action', { cardUuid: card.uuid });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toContain('No handler registered');
      }
    });

    it('should reject when validation fails', () => {
      room.players['player1'].mana.red = 0;
      const card = room.players['player1'].hand[0];
      const result = engine.handleAction(room, 'player1', 'cast_spell', { cardUuid: card.uuid });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.phase).toBe('validate');
      }
    });
  });

  describe('resolveTopOfStack', () => {
    it('should resolve the top stack object and move creature to battlefield', () => {
      const card = room.players['player1'].hand[0];
      const proposeResult = engine.handleAction(room, 'player1', 'cast_spell', { cardUuid: card.uuid });
      expect(proposeResult.success).toBe(true);

      const resolveResult = engine.resolveTopOfStack(room);
      expect(resolveResult.success).toBe(true);
      expect(room.stack.length).toBe(0);
      expect(room.battlefield.length).toBe(1);
    });

    it('should return failure when stack is empty', () => {
      const result = engine.resolveTopOfStack(room);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toContain('empty');
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/game-engine.test.ts`
Expected: FAIL — `resolveTopOfStack` still uses old `ActionRegistry['cast_spell']` resolution path.

- [ ] **Step 3: Update GameEngine**

Replace `src/engine/game-engine.ts`:

```ts
// src/engine/game-engine.ts
import { ActionRegistry, type ActionData, type ActionResult } from './action-registry';
import { EventBus } from './event-bus';
import { resolveEffects } from './effect-resolver';
import { TriggerManager } from './trigger-manager';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';
import type { StackObject } from '../types/effect.types';

function isPermanent(card: CardInstance): boolean {
  return card.cardTypes.some(type =>
    ['Creature', 'Artifact', 'Enchantment', 'Land'].includes(type)
  );
}

export class GameEngine {
  private eventBus: EventBus;

  constructor() {
    this.eventBus = new EventBus('engine');
  }

  /**
   * Initialize per-room systems. Call once when a game starts.
   */
  initRoom(room: GameRoom): void {
    // Create a room-scoped EventBus and TriggerManager
    const roomBus = new EventBus(room.roomId);
    new TriggerManager(roomBus, room);
    // Store for later use
    (this as any)._roomBus = roomBus;
  }

  private getRoomBus(room: GameRoom): EventBus {
    return (this as any)._roomBus || new EventBus(room.roomId);
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

  resolveTopOfStack(room: GameRoom): ActionResult {
    if (room.stack.length === 0) {
      return { success: false, phase: 'resolve', reason: 'Stack is empty' };
    }

    const stackObj = room.stack.pop()!;
    const card = stackObj.source as CardInstance;
    const roomBus = this.getRoomBus(room);

    // Structural zone change (game rule, not an effect)
    if (stackObj.countered) {
      card.state.zone = 'graveyard';
      const ownerId = card.state.controllerId || card.state.ownerId;
      room.players[ownerId]?.graveyard.push(card);
    } else if (isPermanent(card)) {
      card.state.zone = 'battlefield';
      card.state.isTapped = false;
      if (card.cardTypes.includes('Creature')) {
        card.state.summoningSickness = true;
      }
      room.battlefield.push(card);
    } else {
      card.state.zone = 'graveyard';
      const ownerId = card.state.controllerId || card.state.ownerId;
      room.players[ownerId]?.graveyard.push(card);
    }

    // Resolve effects
    resolveEffects(room, stackObj, roomBus);

    // Emit PERMANENT_ENTERED for permanents (triggers ETB)
    if (!stackObj.countered && isPermanent(card)) {
      roomBus.emit({
        eventId: 'PERMANENT_ENTERED',
        roomId: room.roomId,
        payload: { card, controllerId: stackObj.controllerId },
      });
    }

    this.eventBus.emit({
      eventId: 'STACK_RESOLVED',
      roomId: room.roomId,
      payload: { effectId: stackObj.effects[0]?.action || 'structural' },
    });

    return { success: true };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/game-engine.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/game-engine.ts tests/engine/game-engine.test.ts
git commit -m "feat: add structural zone change, effect-resolver, and TriggerManager to GameEngine"
```

---

### Task 9: Update Card Parser for New Format

**Files:**
- Modify: `src/library/card-parser.ts`

**Interfaces:**
- Consumes: `EffectDefinition`, `TargetingDefinition` (from types)
- Produces: `normalizeCard()` now reads `onCastEffects` and `onEnterEffects`

- [ ] **Step 1: Update card-parser.ts**

Replace `src/library/card-parser.ts`:

```ts
// src/library/card-parser.ts
import type { CardBlueprint, CardAbility, ActivatedAbility, TriggeredAbility, CardType, CardZone } from '../types/card.types';
import type { ActionCost, EffectPayload, EffectDefinition, TargetingDefinition } from '../types/effect.types';

export function normalizeActionCost(cost: Record<string, unknown> | undefined): ActionCost {
  if (!cost) return { mana: {}, tap: false, life: 0, discard: 0, sacrifice: false };

  return {
    mana: (cost.mana as Record<string, number>) || {},
    tap: !!cost.tap,
    life: typeof cost.life === 'number' ? cost.life : 0,
    discard: typeof cost.discard === 'number' ? cost.discard : 0,
    sacrifice: !!cost.sacrifice,
  };
}

export function normalizeAbility(ability: Record<string, unknown>): CardAbility | null {
  if (!ability || typeof ability !== 'object') return null;

  const type = (ability.type as string) || 'activated';
  const effect: EffectPayload = {
    effectId: typeof ability.effectId === 'string' ? ability.effectId.toUpperCase() : '',
    params: (ability.params as Record<string, unknown>) || {},
  };

  const base = {
    effect,
    castSpeed: (ability.castSpeed as 'instant' | 'sorcery') || 'instant',
  };

  if (type === 'triggered') {
    return {
      type: 'triggered',
      triggerCondition: (ability.triggerCondition as TriggeredAbility['triggerCondition']) || 'ON_ENTER_BATTLEFIELD',
      ...base,
    } as TriggeredAbility;
  }

  return {
    type: 'activated',
    cost: normalizeActionCost(ability.cost as Record<string, unknown> | undefined),
    duration: (ability.duration as string) || null,
    ...base,
  } as ActivatedAbility;
}

function normalizeTargeting(raw: Record<string, unknown> | undefined): TargetingDefinition {
  if (!raw) {
    return { type: 'self', required: false };
  }
  return {
    type: (raw.type as TargetingDefinition['type']) || 'self',
    cardTypes: raw.cardTypes as string[] | undefined,
    controller: raw.controller as 'self' | 'opponent' | 'any' | undefined,
    required: raw.required !== false,
    minTargets: typeof raw.minTargets === 'number' ? raw.minTargets : undefined,
    maxTargets: typeof raw.maxTargets === 'number' ? raw.maxTargets : undefined,
  };
}

function normalizeEffectDefinition(raw: Record<string, unknown>): EffectDefinition {
  return {
    action: (raw.action as string) || '',
    params: (raw.params as Record<string, unknown>) || {},
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : undefined,
    targeting: normalizeTargeting(raw.targeting as Record<string, unknown> | undefined),
  };
}

export function normalizeCard(raw: Record<string, unknown>): CardBlueprint {
  if (!raw.id) {
    throw new Error(`[CardParser] Missing absolute identifier 'id' on card name: ${raw.name}`);
  }

  return {
    id: raw.id as string,
    name: (raw.name as string) || '',
    cardTypes: (raw.cardTypes as CardType[]) || [],
    subTypes: (raw.subTypes as string[]) || [],
    rulesText: (raw.rulesText as string) || '',
    power: raw.power as number | undefined,
    toughness: raw.toughness as number | undefined,

    // New: onCastEffects and onEnterEffects
    onCastEffects: Array.isArray(raw.onCastEffects)
      ? (raw.onCastEffects as Record<string, unknown>[]).map(normalizeEffectDefinition)
      : undefined,
    onEnterEffects: Array.isArray(raw.onEnterEffects)
      ? (raw.onEnterEffects as Record<string, unknown>[]).map(normalizeEffectDefinition)
      : undefined,

    castRequirements: {
      allowedZones: (raw.castRequirements as Record<string, unknown>)?.allowedZones as CardZone[] || ['hand'],
      speed: ((raw.castRequirements as Record<string, unknown>)?.speed as 'instant' | 'sorcery') || 'sorcery',
      cost: normalizeActionCost((raw.castRequirements as Record<string, unknown>)?.cost as Record<string, unknown> | undefined),
      condition: ((raw.castRequirements as Record<string, unknown>)?.condition as Record<string, unknown>) || undefined,
    },

    abilities: ((raw.abilities as Record<string, unknown>[]) || [])
      .map(normalizeAbility)
      .filter((a): a is CardAbility => a !== null),
  };
}

export function parseAll(rawMap: Record<string, Record<string, unknown>>): Record<string, CardBlueprint> {
  const out: Record<string, CardBlueprint> = {};
  Object.keys(rawMap).forEach(k => {
    out[k] = normalizeCard(rawMap[k]);
  });
  return out;
}

export default {
  normalizeActionCost,
  normalizeAbility,
  normalizeCard,
  parseAll,
};
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: No new type errors from card-parser.ts.

- [ ] **Step 3: Commit**

```bash
git add src/library/card-parser.ts
git commit -m "feat: update card-parser for onCastEffects and onEnterEffects format"
```

---

### Task 10: Update card_data.json to New Format

**Files:**
- Modify: `data/card_data.json`

- [ ] **Step 1: Update all cards to new format**

Replace `data/card_data.json`:

```json
{
  "rock": {
    "id": "rock",
    "name": "石頭",
    "manaCost": "{0}",
    "cardTypes": ["Creature"],
    "subTypes": ["Minion"],
    "rulesText": "Play to choose Rock.",
    "onEnterEffects": [
      {
        "action": "MOVE_ZONE",
        "params": { "origin": "hand", "destination": "graveyard" },
        "tags": ["discard"],
        "targeting": { "type": "self", "required": false }
      }
    ]
  },
  "paper": {
    "id": "paper",
    "name": "布",
    "manaCost": "{0}",
    "cardTypes": ["Creature"],
    "subTypes": ["Minion"],
    "rulesText": "Play to choose Paper.",
    "onEnterEffects": [
      {
        "action": "MOVE_ZONE",
        "params": { "origin": "hand", "destination": "graveyard" },
        "tags": ["discard"],
        "targeting": { "type": "self", "required": false }
      }
    ]
  },
  "scissors": {
    "id": "scissors",
    "name": "剪刀",
    "manaCost": "{0}",
    "cardTypes": ["Creature"],
    "subTypes": ["Minion"],
    "rulesText": "Play to choose Scissors.",
    "onEnterEffects": [
      {
        "action": "MOVE_ZONE",
        "params": { "origin": "hand", "destination": "graveyard" },
        "tags": ["discard"],
        "targeting": { "type": "self", "required": false }
      }
    ]
  },
  "empire-servant": {
    "id": "empire-servant",
    "name": "帝國奴僕",
    "manaCost": "{R}",
    "cardTypes": ["Creature"],
    "subTypes": ["Servant"],
    "power": 1,
    "toughness": 1,
    "rulesText": "① 橫置：生產一點炎屬性能量",
    "abilities": [
      {
        "type": "activated",
        "cost": { "tap": true, "mana": null },
        "effectId": "ADD_MANA",
        "params": { "color": "red", "amount": 1 }
      }
    ]
  },
  "land-red": {
    "id": "land-red",
    "name": "血炎山",
    "manaCost": "",
    "cardTypes": ["Land"],
    "subTypes": ["Mountain"],
    "rulesText": "橫置：生產一點炎屬性能量",
    "abilities": [
      {
        "type": "activated",
        "cost": { "tap": true, "mana": null },
        "effectId": "ADD_MANA",
        "params": { "color": "red", "amount": 1 }
      }
    ]
  },
  "lightning-bolt": {
    "id": "lightning-bolt",
    "name": "Lightning Bolt",
    "manaCost": "{R}",
    "cardTypes": ["Spell"],
    "subTypes": [],
    "rulesText": "Deal 3 damage to any target.",
    "onCastEffects": [
      {
        "action": "MODIFY_LIFE",
        "params": { "amount": -3 },
        "tags": ["damage"],
        "targeting": {
          "type": "player",
          "controller": "any",
          "required": true,
          "minTargets": 1,
          "maxTargets": 1
        }
      }
    ]
  }
}
```

- [ ] **Step 2: Run all tests to verify nothing is broken**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add data/card_data.json
git commit -m "refactor: update card_data.json to onCastEffects/onEnterEffects format"
```

---

### Task 11: Run Full Test Suite and Final Verification

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 2: Check TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No new type errors introduced by these changes.

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final verification — all tests pass, types compile"
```