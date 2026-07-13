# Play Card From Hand — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the vertical slice for playing a card from hand through the stack to battlefield, with validation, cost payment, and effect resolution.

**Architecture:** ActionRegistry pattern (mirroring EffectRegistry) with 3-phase handler lifecycle (validate → propose → resolve). Thin GameEngine orchestrator. ModifierRegistry and EventBus as stubs for future extension.

**Tech Stack:** TypeScript, Node.js, vitest (test runner), uuid

## Global Constraints

- All new code in `src/` (TypeScript), no modifications to legacy JS files
- Test framework: vitest (install as devDependency)
- Test files in `tests/` directory mirroring `src/` structure
- TDD: write failing test first, then implementation
- Commit after each task
- `EffectId` and `ActionType` type aliases live in `src/types/effect.types.ts`
- Registries use typed Records: `Record<EffectId, EffectHandler>` and `Record<ActionType, ActionHandler>`

---

## Phase 1: Foundation — Type Fixes & Test Setup

### Task 1: Install vitest and create test infrastructure

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/helpers/test-room-factory.ts`

**Interfaces:**
- Produces: `createTestRoom(overrides?: Partial<GameRoom>): GameRoom` — factory for test rooms with two players, full mana, one card in hand, main phase, priority on player1

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Update package.json test script**

In `package.json`, replace the test script:
```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create tests/helpers/test-room-factory.ts**

```typescript
import { v4 as uuidv4 } from 'uuid';
import type { GameRoom, PlayerId } from '../../src/types/game.room.types';
import type { PlayerState } from '../../src/types/game.player.types';
import type { CardInstance } from '../../src/types/card.types';
import { instantiateCard } from '../../src/library/card-factory';

export function createTestRoom(overrides?: Partial<GameRoom>): GameRoom {
  const player1Id: PlayerId = 'player1';
  const player2Id: PlayerId = 'player2';

  const defaultPlayer = (id: PlayerId): PlayerState => ({
    id,
    life: 20,
    mana: { red: 5, blue: 5, green: 5, black: 5, white: 5, colorless: 5 },
    deck: [],
    hand: [],
    graveyard: [],
  });

  const p1 = defaultPlayer(player1Id);
  const p2 = defaultPlayer(player2Id);

  // Put empire-servant in player1's hand
  const card = instantiateCard('empire-servant');
  card.state.zone = 'hand';
  card.state.ownerId = player1Id;
  card.state.controllerId = player1Id;
  p1.hand.push(card);

  const room: GameRoom = {
    roomId: uuidv4(),
    player1Id,
    player2Id,
    players: {
      [player1Id]: p1,
      [player2Id]: p2,
    },
    currentPhase: 'stateMainPhase',
    activeTurnPlayerId: player1Id,
    priorityPlayerId: player1Id,
    lastPassedPlayerId: null,
    stack: [],
    battlefield: [],
    rpsState: { status: 'resolved', playedCards: {} },
    ...overrides,
  };

  return room;
}
```

- [ ] **Step 5: Verify test infrastructure works**

```bash
npx vitest run
```
Expected: "No test files found" (not an error — confirms vitest is configured)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/helpers/test-room-factory.ts
git commit -m "chore: add vitest and test room factory"
```

---

### Task 2: Open EffectPayload and fix type definitions

**Files:**
- Modify: `src/types/effect.types.ts`
- Modify: `src/types/card.types.ts`

**Interfaces:**
- Produces: `EffectId = string`, `ActionType = string` (in effect.types.ts)
- Produces: `EffectPayload = { effectId: string; params?: Record<string, unknown> }` (open interface)
- Produces: `CardType` widened to include `'Artifact' | 'Enchantment'`
- Produces: `CardSubType` widened to `string`
- Produces: `TriggerEvent` union type (in card.types.ts)
- Removes: `allowedZones` from `ActionCost`
- Removes: dead `CardEffect` type, dead `EffectId` union from card.types.ts
- Removes: `globalFlag` closed union, widens to `string`

- [ ] **Step 1: Modify src/types/effect.types.ts**

Replace the `EffectPayload` discriminated union with an open interface. Add `EffectId` and `ActionType` type aliases. Remove `allowedZones` from `ActionCost`. Widen `globalFlag` to `string`.

The full replacement for `effect.types.ts`:

```typescript
/**
 * src/types/effect.types.ts
 * Stack and target typing for resolving card actions and abilities.
 */

import type { CardInstance, CardType, CardZone, ManaColor } from './card.types';

// ============================================================================
// 1. Registry Key Types
// ============================================================================

/** Key type for EffectRegistry — open string for extensibility */
export type EffectId = string;

/** Key type for ActionRegistry — open string for extensibility */
export type ActionType = string;

// ============================================================================
// 2. Speed, Stack, and Target Primitives
// ============================================================================

export type ActionSpeed = 'instant' | 'sorcery';
export type StackItemType = 'spell' | 'activated' | 'triggered';
export type TargetType = 'player' | 'card' | 'permanent' | 'spell' | 'stack' | 'zone' | 'any';

// ============================================================================
// 3. Cost and Condition Definitions
// ============================================================================

export interface ActionCost {
    mana?: Partial<Record<ManaColor, number>>;
    tap?: boolean;
    life?: number;
    discard?: number;
    sacrifice?: boolean;
}

export interface ActionCondition {
    zoneCheck?: {
        zone: CardZone[];
        ownedBy: 'self' | 'opponent' | 'any';
        cardType?: CardType;
        cardId?: string;
        minCount?: number;
    };
    /** Open string for extensibility — new flags added without type changes */
    globalFlag?: string;
}

export interface ActionRequirements {
    allowedZones: CardZone[];
    speed: 'instant' | 'sorcery';
    cost?: ActionCost;
    condition?: ActionCondition;
}

// ============================================================================
// 4. Targeting
// ============================================================================

export interface TargetPointer {
    targetType: TargetType;
    controllerId?: string;
    playerId?: string;
    cardUuid?: string;
    cardId?: string;
    zone?: string;
    stackUuid?: string;
    required?: boolean;
    index?: number;
    metadata?: Record<string, any>;
}

// ============================================================================
// 5. Effect Payload (Open Interface)
// ============================================================================

/**
 * Open interface for effect payloads.
 * New effects add entries to EffectRegistry without changing this type.
 * Handlers narrow params as needed.
 */
export interface EffectPayload {
    effectId: string;
    params?: Record<string, unknown>;
}

// ============================================================================
// 6. Stack Objects
// ============================================================================

export interface StackObject {
    readonly uuid: string;
    readonly type: StackItemType;
    readonly controllerId: string;
    readonly source: CardInstance;
    readonly payload: EffectPayload;
    readonly targets: TargetPointer[];
    readonly timestamp?: number;
}

export interface StackObjectConfig {
    type: StackItemType;
    controllerId: string;
    source: CardInstance;
    payload: StackObject['payload'];
    targets?: TargetPointer[] | TargetPointer;
}
```

- [ ] **Step 2: Modify src/types/card.types.ts**

Widen `CardType`, `CardSubType`. Add `TriggerEvent` union. Remove dead `CardEffect` type and old `EffectId` union. Remove `allowedZones` from `ActionCost` import (no longer exists there).

The full replacement for `card.types.ts`:

```typescript
/**
 * src/types/card.types.ts
 * Core types governing card blueprint data, abilities, and active match instances.
 */
import { ActionCost, ActionRequirements, ActionSpeed, EffectPayload } from "./effect.types";

// ============================================================================
// 1. Primitive Game Domains
// ============================================================================

export type ManaColor = 'white' | 'blue' | 'green' | 'black' | 'red' | 'colorless';

export type ManaCost = Partial<Record<ManaColor, number>>;

export const CARD_TYPES = ['Creature', 'Spell', 'Land', 'Artifact', 'Enchantment'] as const;
export type CardType = typeof CARD_TYPES[number];

/** Open string for extensibility — known subtypes: 'Minion', 'Servant', 'Equipment', 'Dragon' */
export type CardSubType = string;

export type CardZone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'stack';

// ============================================================================
// 2. Trigger Events (for TriggeredAbility)
// ============================================================================

export type TriggerEvent =
    | 'ON_ENTER_BATTLEFIELD'
    | 'ON_LEAVE_BATTLEFIELD'
    | 'ON_DIE'
    | 'ON_DRAW'
    | 'ON_DISCARD'
    | 'BEGIN_UPKEEP'
    | 'END_OF_TURN'
    | 'ON_DAMAGE_TAKEN'
    | 'ON_LIFE_GAIN'
    | 'ON_SPELL_CAST';

// ============================================================================
// 3. Ability Architecture (Discriminated Unions)
// ============================================================================

export interface ActivatedAbility {
    type: 'activated';
    cost: ActionCost;
    effect: EffectPayload;
    duration?: string | null;
    castSpeed: ActionSpeed;
}

export interface TriggeredAbility {
    type: 'triggered';
    triggerCondition: TriggerEvent;
    effect: EffectPayload;
    castSpeed: ActionSpeed;
}

export type CardAbility = ActivatedAbility | TriggeredAbility;

// ============================================================================
// 4. The Game Engine Data Pipeline Definitions
// ============================================================================

export interface CardBlueprint {
    readonly id: string;
    readonly name: string;
    readonly cardTypes: CardType[];
    readonly subTypes?: CardSubType[];
    readonly castRequirements: ActionRequirements;
    readonly rulesText: string;
    readonly power?: number;
    readonly toughness?: number;
    readonly abilities: CardAbility[];
    readonly onPlayEffect?: EffectPayload;
}

export interface CardState {
    zone: CardZone;
    ownerId: string;
    controllerId: string;
    isTapped: boolean;
    damageTaken: number;
    summoningSickness: boolean;
    counters: Record<string, number>;
}

export interface CardInstance extends CardBlueprint {
    readonly uuid: string;
    state: CardState;
}

export { ActionCost };
```

- [ ] **Step 3: Verify types compile**

```bash
npx tsc --noEmit
```
Expected: No type errors (or only pre-existing errors in untouched files)

- [ ] **Step 4: Commit**

```bash
git add src/types/effect.types.ts src/types/card.types.ts
git commit -m "refactor: open EffectPayload interface, widen CardType/CardSubType, add TriggerEvent"
```

---

### Task 3: Fix card-parser and card-factory issues

**Files:**
- Modify: `src/library/card-parser.ts`
- Modify: `src/library/card-factory.ts`
- Modify: `data/card_data.json`

**Interfaces:**
- Consumes: `CardAbility` from card.types.ts, `ActionCost` from effect.types.ts
- Produces: `normalizeAbility(ability: Record<string, unknown>): CardAbility | null` (typed return)
- Produces: `getBlueprint`, `instantiateCard` (named exports, no Proxy)

- [ ] **Step 1: Fix card-parser.ts — type normalizeAbility, fix onPlay/onPlayEffect**

Replace `src/library/card-parser.ts`:

```typescript
// src/library/card-parser.ts
import type { CardBlueprint, CardAbility, ActivatedAbility, TriggeredAbility } from '../types/card.types';
import type { ActionCost, EffectPayload } from '../types/effect.types';

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

export function normalizeCard(raw: Record<string, unknown>): CardBlueprint {
  if (!raw.id) {
    throw new Error(`[CardParser] Missing absolute identifier 'id' on card name: ${raw.name}`);
  }

  return {
    id: raw.id as string,
    name: (raw.name as string) || '',
    cardTypes: (raw.cardTypes as string[]) || [],
    subTypes: (raw.subTypes as string[]) || [],
    rulesText: (raw.rulesText as string) || '',
    power: raw.power as number | undefined,
    toughness: raw.toughness as number | undefined,
    // Fix: read both onPlay and onPlayEffect for backward compatibility
    onPlayEffect: (raw.onPlayEffect || raw.onPlay) as EffectPayload | undefined,

    castRequirements: {
      allowedZones: (raw.castRequirements as Record<string, unknown>)?.allowedZones as string[] || ['hand'],
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

- [ ] **Step 2: Fix card-factory.ts — remove Proxy, use named exports only**

Replace `src/library/card-factory.ts`:

```typescript
// src/library/card-factory.ts
import rawCardData from '../../data/card_data.json';
import { normalizeCard } from './card-parser';
import type { CardBlueprint, CardInstance, CardState } from '../types/card.types';
import { v4 as uuidv4 } from 'uuid';

type BlueprintCache = Record<string, CardBlueprint>;
const blueprintCache: BlueprintCache = {};

export function getBlueprint(cardId: string): CardBlueprint {
  const raw = (rawCardData as Record<string, unknown>)[cardId] as Record<string, unknown>;
  if (!raw) {
    throw new Error(`[CardFactory] No raw card data found for ID: ${cardId}`);
  }

  if (!blueprintCache[cardId]) {
    blueprintCache[cardId] = normalizeCard(raw);
  }
  return blueprintCache[cardId];
}

export function instantiateCard(cardId: string): CardInstance {
  const blueprint = getBlueprint(cardId);

  // Deep clone abilities to prevent shared references
  const abilities = blueprint.abilities.map(a => ({
    ...a,
    cost: { ...a.cost, mana: { ...(a.cost?.mana || {}) } },
  }));

  // Deep clone castRequirements
  const rawCost = blueprint.castRequirements.cost || { mana: {} };
  const castRequirements = {
    ...blueprint.castRequirements,
    allowedZones: [...blueprint.castRequirements.allowedZones],
    cost: {
      ...rawCost,
      mana: { ...(rawCost.mana || {}) },
    },
    condition: blueprint.castRequirements.condition
      ? { ...blueprint.castRequirements.condition }
      : undefined,
  };

  const instance: CardInstance = {
    ...blueprint,
    uuid: uuidv4(),
    castRequirements,
    abilities,
    state: {
      zone: 'library',
      ownerId: '',
      controllerId: '',
      isTapped: false,
      summoningSickness: blueprint.cardTypes.includes('Creature'),
      damageTaken: 0,
      counters: {},
    } as CardState,
  } as unknown as CardInstance;

  return instance;
}
```

- [ ] **Step 3: Fix data/card_data.json — rename onPlay to onPlayEffect**

In `data/card_data.json`, change all `"onPlay"` keys to `"onPlayEffect"` for rock, paper, scissors entries.

- [ ] **Step 4: Verify types compile**

```bash
npx tsc --noEmit
```
Expected: No new type errors

- [ ] **Step 5: Commit**

```bash
git add src/library/card-parser.ts src/library/card-factory.ts data/card_data.json
git commit -m "fix: type normalizeAbility, remove Proxy, fix onPlay/onPlayEffect mismatch"
```

---

## Phase 2: Core Engine — Action Registry & Play Card Handler

### Task 4: Create ActionRegistry and ActionHandler types

**Files:**
- Create: `src/engine/action-registry.ts`

**Interfaces:**
- Consumes: `ActionType`, `EffectPayload`, `StackObject` from effect.types.ts; `GameRoom`, `PlayerId` from game.room.types.ts; `CardInstance` from card.types.ts
- Produces: `ActionData = { cardUuid: string; targets?: TargetPointer[]; [key: string]: unknown }` — flexible action payload
- Produces: `ActionResult = { success: true; stackObject?: StackObject } | { success: false; phase: 'validate' | 'propose' | 'resolve'; reason: string }`
- Produces: `ActionHandler = { validate, propose, resolve }` — 3-phase lifecycle
- Produces: `ActionRegistry: Record<ActionType, ActionHandler>` — mutable registry
- Produces: `registerAction(type, handler): void`

- [ ] **Step 1: Write the failing test**

Create `tests/engine/action-registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ActionRegistry, registerAction, type ActionHandler, type ActionResult } from '../../src/engine/action-registry';
import type { GameRoom } from '../../src/types/game.room.types';
import type { StackObject } from '../../src/types/effect.types';

describe('ActionRegistry', () => {
  const mockHandler: ActionHandler = {
    validate: () => ({ success: true }),
    propose: () => ({ success: true }),
    resolve: () => ({ success: true }),
  };

  beforeEach(() => {
    // Clear registry between tests
    Object.keys(ActionRegistry).forEach(key => delete ActionRegistry[key]);
  });

  it('should register and retrieve an action handler', () => {
    registerAction('cast_spell', mockHandler);
    expect(ActionRegistry['cast_spell']).toBe(mockHandler);
  });

  it('should allow multiple action types', () => {
    const drawHandler: ActionHandler = {
      validate: () => ({ success: true }),
      propose: () => ({ success: true }),
      resolve: () => ({ success: true }),
    };
    registerAction('cast_spell', mockHandler);
    registerAction('draw_card', drawHandler);
    expect(ActionRegistry['cast_spell']).toBe(mockHandler);
    expect(ActionRegistry['draw_card']).toBe(drawHandler);
  });

  it('should return undefined for unregistered actions', () => {
    expect(ActionRegistry['nonexistent']).toBeUndefined();
  });

  it('should allow overriding an existing handler', () => {
    const newHandler: ActionHandler = {
      validate: () => ({ success: false, phase: 'validate', reason: 'nope' }),
      propose: () => ({ success: true }),
      resolve: () => ({ success: true }),
    };
    registerAction('cast_spell', mockHandler);
    registerAction('cast_spell', newHandler);
    expect(ActionRegistry['cast_spell']).toBe(newHandler);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/engine/action-registry.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Create src/engine/action-registry.ts**

```typescript
// src/engine/action-registry.ts
import type { ActionType, StackObject, TargetPointer } from '../types/effect.types';
import type { GameRoom, PlayerId } from '../types/game.room.types';

// ============================================================================
// 1. Action Data & Results
// ============================================================================

/**
 * Flexible payload for any client action.
 * cardUuid is the primary card being acted upon.
 * targets are optional chosen targets.
 * Additional properties are passed through for handler-specific needs.
 */
export interface ActionData {
  cardUuid: string;
  targets?: TargetPointer[];
  [key: string]: unknown;
}

export type ActionResult =
  | { success: true; stackObject?: StackObject }
  | { success: false; phase: 'validate' | 'propose' | 'resolve'; reason: string };

// ============================================================================
// 2. Action Handler Interface
// ============================================================================

/**
 * 3-phase lifecycle for any game action:
 * 1. validate — permission checks + value transforms + standard validation
 * 2. propose  — pay costs, create StackObject, push to stack
 * 3. resolve  — apply effects via EffectRegistry
 */
export interface ActionHandler {
  validate(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult;
  propose(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult;
  resolve(room: GameRoom, stackObj: StackObject): ActionResult;
}

// ============================================================================
// 3. Registry
// ============================================================================

export const ActionRegistry: Record<ActionType, ActionHandler> = {};

export function registerAction(type: ActionType, handler: ActionHandler): void {
  ActionRegistry[type] = handler;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/engine/action-registry.test.ts
```
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/action-registry.ts tests/engine/action-registry.test.ts
git commit -m "feat: add ActionRegistry with ActionHandler interface and ActionResult type"
```

---

### Task 5: Create EventBus stub

**Files:**
- Create: `src/engine/event-bus.ts`

**Interfaces:**
- Produces: `GameEvent = { eventId: string; roomId: string; payload: Record<string, unknown> }`
- Produces: `EventBus` class with `emit(event): void` (logs) and `on(eventId, listener): void` (no-op stub)

- [ ] **Step 1: Write the failing test**

Create `tests/engine/event-bus.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { EventBus, type GameEvent } from '../../src/engine/event-bus';

describe('EventBus', () => {
  it('should create an EventBus instance', () => {
    const bus = new EventBus('test-room');
    expect(bus).toBeDefined();
  });

  it('should accept on() registration without error (stub)', () => {
    const bus = new EventBus('test-room');
    const listener = (_e: GameEvent) => {};
    expect(() => bus.on('SPELL_CAST', listener)).not.toThrow();
  });

  it('should emit events without error (stub)', () => {
    const bus = new EventBus('test-room');
    const event: GameEvent = {
      eventId: 'SPELL_CAST',
      roomId: 'test-room',
      payload: { cardId: 'empire-servant' },
    };
    expect(() => bus.emit(event)).not.toThrow();
  });

  it('should log emitted events to console', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const bus = new EventBus('test-room');
    const event: GameEvent = {
      eventId: 'CREATURE_ENTERS_BATTLEFIELD',
      roomId: 'test-room',
      payload: { cardId: 'empire-servant' },
    };
    bus.emit(event);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('CREATURE_ENTERS_BATTLEFIELD')
    );
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/engine/event-bus.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Create src/engine/event-bus.ts**

```typescript
// src/engine/event-bus.ts

export interface GameEvent {
  eventId: string;
  roomId: string;
  payload: Record<string, unknown>;
}

type EventListener = (event: GameEvent) => void;

/**
 * EventBus — stub implementation for future trigger/replacement effect system.
 * Currently logs all events. on() is a no-op registration placeholder.
 *
 * Future: listeners will be stored and invoked when matching events are emitted,
 * enabling TriggeredAbility evaluation and ReplacementEffect interception.
 */
export class EventBus {
  private roomId: string;

  constructor(roomId: string) {
    this.roomId = roomId;
  }

  /**
   * Emit a game event. Currently logs to console.
   * Future: invokes all registered listeners for this eventId.
   */
  emit(event: GameEvent): void {
    console.log(`[EventBus:${this.roomId}] ${event.eventId} —`, JSON.stringify(event.payload));
  }

  /**
   * Register a listener for an event. Stub — no-op for now.
   * Future: stores listener, invokes on matching emit().
   */
  on(eventId: string, listener: EventListener): void {
    // Stub: listener registration will be implemented with the trigger system
    void eventId;
    void listener;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/engine/event-bus.test.ts
```
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/event-bus.ts tests/engine/event-bus.test.ts
git commit -m "feat: add EventBus stub for future trigger system"
```

---

### Task 6: Create ModifierRegistry and ModifierPipeline stubs

**Files:**
- Create: `src/engine/modifier-registry.ts`
- Create: `src/engine/modifier-pipeline.ts`

**Interfaces:**
- Produces: `ModifierRegistry.canPlay(room, playerId, card): boolean` — always true, logs
- Produces: `ModifierRegistry.canTarget(room, playerId, card, targets): boolean` — always true, logs
- Produces: `ModifierPipeline.apply(action, room, playerId): ActionData` — identity transform, logs

- [ ] **Step 1: Create src/engine/modifier-registry.ts**

```typescript
// src/engine/modifier-registry.ts
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';
import type { TargetPointer } from '../types/effect.types';

/**
 * ModifierRegistry — stub for permission-check modifiers.
 *
 * Future: scans all permanents, emblems, and continuous effects for
 * restrictions like "can't play creatures", hexproof, shroud, etc.
 * Currently all checks pass through (no restrictions).
 */
export class ModifierRegistry {
  /**
   * Check if a card can be played. Stub — always returns true.
   * Future: checks for "can't cast spells", "can't play creatures", etc.
   */
  static canPlay(room: GameRoom, playerId: PlayerId, card: CardInstance): boolean {
    console.log(`[ModifierRegistry] canPlay: ${card.name} by ${playerId} — allowed (stub)`);
    void room;
    return true;
  }

  /**
   * Check if targets are legal. Stub — always returns true.
   * Future: checks hexproof, shroud, protection, etc.
   */
  static canTarget(
    room: GameRoom,
    playerId: PlayerId,
    card: CardInstance,
    targets: TargetPointer[]
  ): boolean {
    console.log(`[ModifierRegistry] canTarget: ${targets.length} targets for ${card.name} — allowed (stub)`);
    void room;
    void playerId;
    return true;
  }
}
```

- [ ] **Step 2: Create src/engine/modifier-pipeline.ts**

```typescript
// src/engine/modifier-pipeline.ts
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { ActionData } from './action-registry';

/**
 * ModifierPipeline — stub for value-transformation modifiers.
 *
 * Future: chains cost reducers, flash granters, target modifiers, etc.
 * Each modifier is a pure function: ActionData → ActionData.
 * Currently returns the action unchanged (identity transform).
 */
export class ModifierPipeline {
  /**
   * Apply all active value modifiers to an action.
   * Stub — returns the action unchanged.
   *
   * Future: chains modifiers like:
   *   action → reduceCost → grantFlash → modifyTargets → validatedAction
   */
  static apply(action: ActionData, room: GameRoom, playerId: PlayerId): ActionData {
    console.log(`[ModifierPipeline] apply: no modifiers active (stub)`);
    void room;
    void playerId;
    return action;
  }
}
```

- [ ] **Step 3: Verify types compile**

```bash
npx tsc --noEmit
```
Expected: No new type errors

- [ ] **Step 4: Commit**

```bash
git add src/engine/modifier-registry.ts src/engine/modifier-pipeline.ts
git commit -m "feat: add ModifierRegistry and ModifierPipeline stubs"
```

---

### Task 7: Complete ActionValidator.canPayCost mana loop

**Files:**
- Modify: `src/engine/action-validator.ts`

**Interfaces:**
- Consumes: `ActionCost` from effect.types.ts (no longer has `allowedZones`)
- Produces: `canPayCost` with completed mana validation loop

- [ ] **Step 1: Write the failing test**

Create `tests/engine/action-validator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ActionValidator } from '../../src/engine/action-validator';
import { createTestRoom } from '../helpers/test-room-factory';
import type { ActionRequirements } from '../../src/types/effect.types';

describe('ActionValidator', () => {
  describe('canPayCost', () => {
    it('should return true when no cost is provided', () => {
      const room = createTestRoom();
      const card = room.players['player1'].hand[0];
      expect(ActionValidator.canPayCost(room, 'player1', card, undefined)).toBe(true);
    });

    it('should return true when player has enough mana', () => {
      const room = createTestRoom();
      const card = room.players['player1'].hand[0];
      // player1 has 5 red mana, cost is 1 red
      expect(ActionValidator.canPayCost(room, 'player1', card, { mana: { red: 1 } })).toBe(true);
    });

    it('should return false when player lacks specific mana color', () => {
      const room = createTestRoom();
      room.players['player1'].mana.red = 0;
      const card = room.players['player1'].hand[0];
      expect(ActionValidator.canPayCost(room, 'player1', card, { mana: { red: 1 } })).toBe(false);
    });

    it('should return false when player lacks enough mana quantity', () => {
      const room = createTestRoom();
      room.players['player1'].mana.red = 1;
      const card = room.players['player1'].hand[0];
      expect(ActionValidator.canPayCost(room, 'player1', card, { mana: { red: 3 } })).toBe(false);
    });

    it('should return false when life cost exceeds player life', () => {
      const room = createTestRoom();
      const card = room.players['player1'].hand[0];
      expect(ActionValidator.canPayCost(room, 'player1', card, { life: 25 })).toBe(false);
    });

    it('should return false when card is already tapped and tap cost required', () => {
      const room = createTestRoom();
      const card = room.players['player1'].hand[0];
      card.state.isTapped = true;
      expect(ActionValidator.canPayCost(room, 'player1', card, { tap: true })).toBe(false);
    });

    it('should return false when discard cost exceeds hand size', () => {
      const room = createTestRoom();
      const card = room.players['player1'].hand[0];
      expect(ActionValidator.canPayCost(room, 'player1', card, { discard: 5 })).toBe(false);
    });

    it('should handle colorless mana requirements', () => {
      const room = createTestRoom();
      const card = room.players['player1'].hand[0];
      expect(ActionValidator.canPayCost(room, 'player1', card, { mana: { colorless: 2 } })).toBe(true);
    });
  });

  describe('canActivate', () => {
    it('should validate a playable card in hand', () => {
      const room = createTestRoom();
      const card = room.players['player1'].hand[0];
      const req: ActionRequirements = {
        allowedZones: ['hand'],
        speed: 'sorcery',
        cost: { mana: { red: 1 } },
      };
      const result = ActionValidator.canActivate(room, 'player1', card, req);
      expect(result.valid).toBe(true);
    });

    it('should reject card not in allowed zone', () => {
      const room = createTestRoom();
      const card = room.players['player1'].hand[0];
      card.state.zone = 'graveyard';
      const req: ActionRequirements = {
        allowedZones: ['hand'],
        speed: 'sorcery',
      };
      const result = ActionValidator.canActivate(room, 'player1', card, req);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('graveyard');
    });

    it('should reject sorcery-speed when stack is not empty', () => {
      const room = createTestRoom();
      room.stack.push({} as any); // non-empty stack
      const card = room.players['player1'].hand[0];
      const req: ActionRequirements = {
        allowedZones: ['hand'],
        speed: 'sorcery',
      };
      const result = ActionValidator.canActivate(room, 'player1', card, req);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('sorcery speed');
    });

    it('should reject when player does not have priority', () => {
      const room = createTestRoom();
      room.priorityPlayerId = 'player2';
      const card = room.players['player1'].hand[0];
      const req: ActionRequirements = {
        allowedZones: ['hand'],
        speed: 'instant',
      };
      const result = ActionValidator.canActivate(room, 'player1', card, req);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('priority');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/engine/action-validator.test.ts
```
Expected: Some tests FAIL — mana loop is incomplete

- [ ] **Step 3: Fix canPayCost mana loop in action-validator.ts**

In `src/engine/action-validator.ts`, replace the `canPayCost` method's mana check:

```typescript
public static canPayCost(room: GameRoom, playerId: PlayerId, card: CardInstance, cost?: ActionCost): boolean {
    if (!cost) return true;
    const player = room.players[playerId];

    // Mana cost check
    if (cost.mana) {
        for (const [color, amount] of Object.entries(cost.mana)) {
            const playerMana = player.mana[color as ManaColor] ?? 0;
            if (playerMana < amount) return false;
        }
    }

    if (cost.life && player.life < cost.life) return false;
    if (cost.tap && card.state.isTapped) return false;
    if (cost.discard && player.hand.length < cost.discard) return false;

    return true;
}
```

Also add the `ManaColor` import at the top of the file:
```typescript
import type { CardInstance, ManaColor } from '../types/card.types';
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/engine/action-validator.test.ts
```
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/action-validator.ts tests/engine/action-validator.test.ts
git commit -m "fix: complete canPayCost mana loop, add ActionValidator tests"
```

---

## Phase 3: Play Card Handler — The Vertical Slice

### Task 8: Create play-card handler

**Files:**
- Create: `src/engine/handlers/play-card-handler.ts`

**Interfaces:**
- Consumes: `ActionHandler`, `ActionData`, `ActionResult`, `ActionRegistry` from action-registry.ts
- Consumes: `ActionValidator` from action-validator.ts
- Consumes: `ModifierRegistry` from modifier-registry.ts
- Consumes: `ModifierPipeline` from modifier-pipeline.ts
- Consumes: `EffectRegistry` from effect-registry.ts
- Consumes: `EventBus` from event-bus.ts
- Consumes: `StackObject`, `StackObjectConfig` from effect.types.ts
- Produces: `playCardHandler: ActionHandler` — registered as `'cast_spell'`

- [ ] **Step 1: Write the failing test**

Create `tests/engine/play-card-handler.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createTestRoom } from '../helpers/test-room-factory';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { ActionRegistry, registerAction } from '../../src/engine/action-registry';
import type { GameRoom } from '../../src/types/game.room.types';

describe('playCardHandler', () => {
  let room: GameRoom;

  beforeEach(() => {
    room = createTestRoom();
    registerAction('cast_spell', playCardHandler);
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
      if (!result.success) {
        expect(result.phase).toBe('validate');
      }
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
    it('should pay costs and create a StackObject', () => {
      const card = room.players['player1'].hand[0];
      const initialHandSize = room.players['player1'].hand.length;
      const initialRedMana = room.players['player1'].mana.red;

      const result = playCardHandler.propose(room, 'player1', { cardUuid: card.uuid });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.stackObject).toBeDefined();
        expect(result.stackObject!.type).toBe('spell');
        expect(result.stackObject!.controllerId).toBe('player1');
        expect(result.stackObject!.payload.effectId).toBe('CAST_SPELL');
      }

      // Card removed from hand
      expect(room.players['player1'].hand.length).toBe(initialHandSize - 1);

      // Mana deducted (empire-servant costs 1 red)
      expect(room.players['player1'].mana.red).toBe(initialRedMana - 1);

      // StackObject pushed to stack
      expect(room.stack.length).toBe(1);
    });

    it('should reject when card not found in hand during propose', () => {
      const result = playCardHandler.propose(room, 'player1', { cardUuid: 'nonexistent' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.phase).toBe('propose');
      }
    });
  });

  describe('resolve', () => {
    it('should move a creature card to the battlefield', () => {
      // First propose to get a stack object
      const card = room.players['player1'].hand[0];
      const proposeResult = playCardHandler.propose(room, 'player1', { cardUuid: card.uuid });
      expect(proposeResult.success).toBe(true);

      const stackObj = (proposeResult as { success: true; stackObject: any }).stackObject;
      const initialBattlefieldSize = room.battlefield.length;

      const resolveResult = playCardHandler.resolve(room, stackObj);
      expect(resolveResult.success).toBe(true);

      // Card on battlefield
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

      // 1. Validate
      const validateResult = playCardHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(validateResult.success).toBe(true);

      // 2. Propose
      const proposeResult = playCardHandler.propose(room, 'player1', { cardUuid: card.uuid });
      expect(proposeResult.success).toBe(true);
      expect(room.stack.length).toBe(1);

      // 3. Resolve
      const stackObj = (proposeResult as { success: true; stackObject: any }).stackObject;
      const resolveResult = playCardHandler.resolve(room, stackObj);
      expect(resolveResult.success).toBe(true);

      // Card is now on battlefield
      const onBattlefield = room.battlefield.find(c => c.name === cardName);
      expect(onBattlefield).toBeDefined();
      expect(onBattlefield!.state.zone).toBe('battlefield');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/engine/play-card-handler.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Create src/engine/handlers/play-card-handler.ts**

```typescript
// src/engine/handlers/play-card-handler.ts
import { v4 as uuidv4 } from 'uuid';
import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import { ActionValidator } from '../action-validator';
import { ModifierRegistry } from '../modifier-registry';
import { ModifierPipeline } from '../modifier-pipeline';
import { EffectRegistry } from '../effect-registry';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { CardInstance } from '../../types/card.types';
import type { StackObject, StackItemType } from '../../types/effect.types';

function findCardInHand(room: GameRoom, playerId: PlayerId, cardUuid: string): CardInstance | undefined {
  return room.players[playerId].hand.find(c => c.uuid === cardUuid);
}

export const playCardHandler: ActionHandler = {
  validate(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    const card = findCardInHand(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'validate', reason: 'Card not found in hand' };
    }

    // 1. Permission checks (stubs)
    if (!ModifierRegistry.canPlay(room, playerId, card)) {
      return { success: false, phase: 'validate', reason: 'A modifier prevents playing this card' };
    }
    if (action.targets && !ModifierRegistry.canTarget(room, playerId, card, action.targets)) {
      return { success: false, phase: 'validate', reason: 'Target is not legal' };
    }

    // 2. Value transformation (stub — identity for now)
    const modifiedAction = ModifierPipeline.apply(action, room, playerId);

    // 3. Standard validation
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

    // Determine stack item type
    const stackType: StackItemType = 'spell';

    // Create StackObject
    const stackObj: StackObject = {
      uuid: uuidv4(),
      type: stackType,
      controllerId: playerId,
      source: card,
      payload: {
        effectId: 'CAST_SPELL',
        params: {},
      },
      targets: action.targets || [],
      timestamp: Date.now(),
    };

    // Push to stack
    room.stack.push(stackObj);

    return { success: true, stackObject: stackObj };
  },

  resolve(room: GameRoom, stackObj: StackObject): ActionResult {
    const handler = EffectRegistry[stackObj.payload.effectId];
    if (!handler) {
      return { success: false, phase: 'resolve', reason: `No handler for effect: ${stackObj.payload.effectId}` };
    }

    handler(room, stackObj);
    return { success: true };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/engine/play-card-handler.test.ts
```
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/handlers/play-card-handler.ts tests/engine/play-card-handler.test.ts
git commit -m "feat: add play-card handler with validate→propose→resolve lifecycle"
```

---

### Task 9: Add GRANT_STATS handler to EffectRegistry

**Files:**
- Modify: `src/engine/effect-registry.ts`

**Interfaces:**
- Consumes: `EffectId` from effect.types.ts
- Produces: `EffectRegistry` typed as `Record<EffectId, EffectHandler>`
- Produces: `GRANT_STATS` handler registered

- [ ] **Step 1: Update effect-registry.ts**

Replace `src/engine/effect-registry.ts`:

```typescript
// src/engine/effect-registry.ts
import type { GameRoom } from '../types/game.room.types';
import type { StackObject, EffectId } from '../types/effect.types';
import type { ManaColor } from '../types/card.types';

export type EffectHandler = (room: GameRoom, stackObj: StackObject) => void;

export const EffectRegistry: Record<EffectId, EffectHandler> = {

  'CAST_SPELL': (room, stackObj) => {
    const { source, controllerId } = stackObj;
    const player = room.players[controllerId];

    const isPermanent = source.cardTypes.some(type =>
      ['Creature', 'Artifact', 'Enchantment', 'Land'].includes(type)
    );

    if (isPermanent) {
      source.state.zone = 'battlefield';
      source.state.isTapped = false;

      if (source.cardTypes.includes('Creature')) {
        source.state.summoningSickness = true;
      }

      room.battlefield.push(source);
    } else {
      source.state.zone = 'graveyard';
      player.graveyard.push(source);
    }
  },

  'ADD_MANA': (room, stackObj) => {
    const player = room.players[stackObj.controllerId];
    const params = stackObj.payload.params as { color: ManaColor; amount: number } | undefined;
    if (params) {
      const { color, amount } = params;
      player.mana[color] = (player.mana[color] || 0) + amount;
    }
  },

  'DISCARD_HAND': (room, stackObj) => {
    const player = room.players[stackObj.controllerId];
    player.hand.forEach(card => {
      card.state.zone = 'graveyard';
      player.graveyard.push(card);
    });
    player.hand = [];
  },

  'DEAL_DAMAGE': (room, stackObj) => {
    const params = stackObj.payload.params as { amount: number } | undefined;
    if (!params) return;
    const { amount } = params;

    stackObj.targets.forEach(target => {
      if (target.targetType === 'player' && target.playerId) {
        const targetPlayer = room.players[target.playerId];
        if (targetPlayer) targetPlayer.life -= amount;
      } else if ((target.targetType === 'card' || target.targetType === 'permanent') && target.cardUuid) {
        const targetCard = room.battlefield.find(c => c.uuid === target.cardUuid);
        if (targetCard) {
          targetCard.state.damageTaken = (targetCard.state.damageTaken || 0) + amount;
        }
      }
    });
  },

  /**
   * Grants temporary or permanent stat modifications to a target creature.
   * Used by cards like Crimson Hellkite (firebreathing).
   */
  'GRANT_STATS': (room, stackObj) => {
    const params = stackObj.payload.params as {
      power: number;
      toughness: number;
      duration: 'EOT' | 'PERMANENT';
    } | undefined;
    if (!params) return;

    const { power, toughness, duration } = params;

    stackObj.targets.forEach(target => {
      if ((target.targetType === 'card' || target.targetType === 'permanent') && target.cardUuid) {
        const targetCard = room.battlefield.find(c => c.uuid === target.cardUuid);
        if (targetCard) {
          // Apply stat modification via counters for permanent, or note for EOT cleanup
          if (duration === 'PERMANENT') {
            targetCard.state.counters['+1/+1'] = (targetCard.state.counters['+1/+1'] || 0) + 1;
          }
          // EOT buffs will be handled by the cleanup step (future: active effects system)
          console.log(
            `[GRANT_STATS] ${targetCard.name} gains +${power}/+${toughness} (${duration})`
          );
        }
      }
    });
  },
};
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```
Expected: No new type errors

- [ ] **Step 3: Commit**

```bash
git add src/engine/effect-registry.ts
git commit -m "feat: add GRANT_STATS handler, type EffectRegistry as Record<EffectId, EffectHandler>"
```

---

## Phase 4: GameEngine Orchestrator

### Task 10: Create GameEngine orchestrator

**Files:**
- Create: `src/engine/game-engine.ts`

**Interfaces:**
- Consumes: `ActionRegistry`, `ActionData`, `ActionResult` from action-registry.ts
- Consumes: `EventBus` from event-bus.ts
- Consumes: `GameRoom`, `PlayerId` from game.room.types.ts
- Produces: `GameEngine` class with `handleAction()` and `resolveTopOfStack()`

- [ ] **Step 1: Write the failing test**

Create `tests/engine/game-engine.test.ts`:

```typescript
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
    // Clear and re-register
    Object.keys(ActionRegistry).forEach(key => delete ActionRegistry[key]);
    registerAction('cast_spell', playCardHandler);

    room = createTestRoom();
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
    it('should resolve the top stack object', () => {
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

```bash
npx vitest run tests/engine/game-engine.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Create src/engine/game-engine.ts**

```typescript
// src/engine/game-engine.ts
import { ActionRegistry, type ActionData, type ActionResult } from './action-registry';
import { EventBus } from './event-bus';
import type { GameRoom, PlayerId } from '../types/game.room.types';

/**
 * GameEngine — thin orchestrator for game actions.
 *
 * Responsibilities:
 * - Route client actions to the ActionRegistry
 * - Manage stack resolution (pop top, call handler.resolve)
 * - Emit events via EventBus
 *
 * Does NOT contain game rules — those live in ActionValidator, EffectRegistry, and handlers.
 */
export class GameEngine {
  private eventBus: EventBus;

  constructor() {
    this.eventBus = new EventBus('engine');
  }

  /**
   * Handle a client action: validate → propose.
   * Resolve is called separately via resolveTopOfStack() when priority passes resolve.
   */
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

    // Phase 1: Validate
    const validateResult = handler.validate(room, playerId, actionData);
    if (!validateResult.success) return validateResult;

    // Phase 2: Propose
    const proposeResult = handler.propose(room, playerId, actionData);
    if (!proposeResult.success) return proposeResult;

    // Emit event
    this.eventBus.emit({
      eventId: 'ACTION_PROPOSED',
      roomId: room.roomId,
      payload: { actionType, playerId, cardUuid: actionData.cardUuid },
    });

    return proposeResult;
  }

  /**
   * Resolve the top item of the stack.
   * Called by the priority system when both players pass.
   */
  resolveTopOfStack(room: GameRoom): ActionResult {
    if (room.stack.length === 0) {
      return { success: false, phase: 'resolve', reason: 'Stack is empty' };
    }

    const stackObj = room.stack.pop()!;

    // Look up handler by the action type that created this stack object
    // For now, we resolve via the effect registry directly
    // Future: stack objects will carry their originating action type
    const handler = ActionRegistry['cast_spell']; // Default for spell resolution
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

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/engine/game-engine.test.ts
```
Expected: All tests PASS

- [ ] **Step 5: Run all tests to verify nothing is broken**

```bash
npx vitest run
```
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/engine/game-engine.ts tests/engine/game-engine.test.ts
git commit -m "feat: add GameEngine orchestrator with handleAction and resolveTopOfStack"
```

---

## Verification

After all tasks are complete, run the full test suite and type check:

```bash
npx vitest run
npx tsc --noEmit
```

Expected: All tests pass, no type errors.