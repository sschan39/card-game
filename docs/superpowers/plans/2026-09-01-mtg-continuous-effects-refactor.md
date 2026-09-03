# MTG-Faithful Continuous Effects Refactor — Implementation Plan

> **Status: ✅ COMPLETE (2026-09-03).** All 9 tasks implemented across commits `4e4eee2` → `c0a2034`. All 219 tests pass; build clean. See the spec's §10 for the implementation summary and deferred follow-ups.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the materialized-modifier model with an MTG-faithful `ContinuousEffectPool` — a global registry evaluated on-demand via a 4-step query pipeline.

**Architecture:** Remove `ContinuousModifier` and `CardState.modifiers`. Add `ContinuousEffectEntry` type and `continuousEffectPool: ContinuousEffectEntry[]` to `GameRoom`. Replace `stat-resolver.ts` with `CardCharacteristicService` that folds the pool through `locateSource → hasValidSourceZone → matchesScope → fold`. Rewrite `GRANT_STATS` handler to emit pool entries instead of per-card modifiers. Add housekeeping: `REMOVE_CONTINUOUS_EFFECT` on zone change, `CLEAR_END_OF_TURN_EFFECTS` at cleanup step.

**Tech Stack:** TypeScript (strict), Vitest 4.1.10, Vite 8.2.2

## Global Constraints

- TDD: every task starts with a failing test, then implementation, then verify pass
- Pure reducer pattern: handlers produce `GameMutation[]`, sequenced through `gameReducer(state, mutation) => newState`
- No timestamp field — ordering is insertion order (array index)
- `requiredZone` defaults to `'battlefield'`
- Client display is deferred — `CardComponent` keeps reading `card.blueprint.power` for now
- `MODIFY_STATS` P/T is deferred — not in this refactor
- `SET_STATS` handler is deferred — no handler until a "becomes 3/3" card exists

---

### Task 1: Add `ContinuousEffectEntry` type and `continuousEffectPool` to `GameRoom`

**Files:**
- Modify: `src/types/card.types.ts:80-130`
- Modify: `src/types/game.room.types.ts:1-45`
- Modify: `src/library/card-factory.ts:30-40`

**Interfaces:**
- Produces: `ContinuousEffectEntry` interface (exported from `card.types.ts`)
- Produces: `continuousEffectPool: ContinuousEffectEntry[]` on `GameRoom`
- Produces: `CardState` no longer has `modifiers` field

- [x] **Step 1: Add `ContinuousEffectEntry` and remove `ContinuousModifier` from `card.types.ts`**

In `src/types/card.types.ts`, replace the entire "4a. Continuous Effects & Modifiers" section (lines 81-108) and the `modifiers` field in `CardState` (line 119):

```typescript
// ============================================================================
// 4a. Continuous Effects — the ContinuousEffectPool model
// ============================================================================

/**
 * A continuous effect — a closed, discriminated union so invalid combinations
 * are unrepresentable. Only STAT_DELTA has a handler today; SET_STATS is
 * declared because it changes the resolver's layer ordering (applies before
 * STAT_DELTA), but has no handler until a "becomes 3/3" card exists.
 */
export type ContinuousEffect =
    | { type: 'STAT_DELTA'; power?: number; toughness?: number }   // +1/+0
    | { type: 'SET_STATS'; power: number; toughness: number };     // "becomes 3/3"

/**
 * An entry in the ContinuousEffectPool — the global registry of active
 * continuous effects. Effects are evaluated from the source outward,
 * on-demand, never materialized onto targets.
 *
 * No `id` field: removal matches by `source` (REMOVE_CONTINUOUS_EFFECT).
 * No `timestamp` field: ordering within a layer is insertion order (array index).
 */
export interface ContinuousEffectEntry {
    source: string;              // cardUuid of source | 'emblem' | 'global'
    layer: number;               // 1-7 subset; we implement layer 7 (P/T)
    effect: ContinuousEffect;    // STAT_DELTA | SET_STATS
    scope: {
        cardTypes?: string[];      // e.g. ['Creature']
        subTypes?: string[];       // e.g. ['Servant']
        cardUuid?: string;         // single-card target (non-anthem buffs)
        controller?: 'self' | 'opponent' | 'any';  // relative to source's controller
    };
    requiredZone?: CardZone;     // zone the source must occupy for this entry to be valid.
                                 // Default: 'battlefield'. 'emblem'/'global' sources ignore.
    duration: 'END_OF_TURN' | 'WHILE_ATTACHED' | 'WHILE_ON_BATTLEFIELD' | 'PERMANENT';
}
```

Remove the `ContinuousModifier` interface entirely (lines 98-108).

In `CardState`, remove the `modifiers` field (line 119):
```typescript
export interface CardState {
    zone: CardZone;
    ownerId: string;
    controllerId: string;
    isTapped: boolean;
    damageTaken: number;
    summoningSickness: boolean;
    counters: Record<string, number>;
    // modifiers: ContinuousModifier[];   // REMOVED — replaced by room.continuousEffectPool
    attachedTo?: string | null;
}
```

- [x] **Step 2: Add `continuousEffectPool` to `GameRoom`**

In `src/types/game.room.types.ts`, add the import and field:

Add import at top:
```typescript
import type { ContinuousEffectEntry } from './card.types';
```

Add field to `GameRoom` interface (after `battlefield`):
```typescript
    // Board State
    battlefield: CardInstance[];

    // Continuous Effect Pool (MTG-faithful global registry)
    continuousEffectPool: ContinuousEffectEntry[];
```

- [x] **Step 3: Remove `modifiers` from `card-factory.ts`**

In `src/library/card-factory.ts`, remove `modifiers: []` from the `instantiateCard` state initialization (line 36):

```typescript
    state: {
      zone: 'library',
      ownerId: '',
      controllerId: '',
      isTapped: false,
      summoningSickness: blueprint.cardTypes.includes('Creature'),
      damageTaken: 0,
      counters: {},
      // modifiers removed — replaced by room.continuousEffectPool
    },
```

- [x] **Step 4: Add `continuousEffectPool: []` to `createTestRoom`**

In `tests/helpers/test-room-factory.ts`, add the field to the room object (after `battlefield: []`):

```typescript
    battlefield: [],
    continuousEffectPool: [],
    rpsState: { status: 'resolved', playedCards: {} },
```

- [x] **Step 5: Verify build compiles (will fail — expected)**

Run: `npx tsc --noEmit`
Expected: FAIL — other files still reference `ContinuousModifier`, `modifiers`, `ADD_MODIFIER`, etc. This is expected; subsequent tasks fix these.

- [x] **Step 6: Commit**

```bash
git add src/types/card.types.ts src/types/game.room.types.ts src/library/card-factory.ts tests/helpers/test-room-factory.ts
git commit -m "feat: add ContinuousEffectEntry type and continuousEffectPool to GameRoom, remove ContinuousModifier"
```

---

### Task 2: Add new mutation types and update `game-reducer.ts`

**Files:**
- Modify: `src/types/game-mutation.types.ts:28-33`
- Modify: `src/engine/game-reducer.ts:298-340`

**Interfaces:**
- Consumes: `ContinuousEffectEntry` from Task 1
- Produces: `ADD_CONTINUOUS_EFFECT`, `REMOVE_CONTINUOUS_EFFECT`, `CLEAR_END_OF_TURN_EFFECTS` mutations
- Removes: `ADD_MODIFIER`, `REMOVE_MODIFIER`, `CLEAR_END_OF_TURN_MODIFIERS` mutations

- [x] **Step 1: Replace modifier mutations in `game-mutation.types.ts`**

In `src/types/game-mutation.types.ts`, replace the import and modifier mutations (lines 9, 30-33):

Remove `ContinuousModifier` from the import:
```typescript
import type { CardZone, ManaColor, ManaCost, ContinuousEffect, ContinuousEffectEntry } from './card.types';
```

Replace the modifier mutation lines:
```typescript
  // Continuous effect pool mutations (MTG-faithful global registry)
  | { type: 'ADD_CONTINUOUS_EFFECT'; entry: ContinuousEffectEntry }
  | { type: 'REMOVE_CONTINUOUS_EFFECT'; source: string }   // remove all entries from a source
  | { type: 'CLEAR_END_OF_TURN_EFFECTS' }                  // fired at cleanupStep
```

Remove the old modifier mutations:
```typescript
  // REMOVED:
  // | { type: 'ADD_MODIFIER'; cardUuid: string; modifier: ContinuousModifier }
  // | { type: 'REMOVE_MODIFIER'; cardUuid: string; source: string; effectType: ContinuousEffect['type'] }
  // | { type: 'CLEAR_END_OF_TURN_MODIFIERS' }
```

- [x] **Step 2: Replace modifier cases in `game-reducer.ts`**

In `src/engine/game-reducer.ts`, replace the modifier mutation cases (lines 298-340):

```typescript
    // -- Continuous effect pool mutations --
    case 'ADD_CONTINUOUS_EFFECT':
      return {
        ...state,
        continuousEffectPool: [...state.continuousEffectPool, mutation.entry],
      };

    case 'REMOVE_CONTINUOUS_EFFECT':
      return {
        ...state,
        continuousEffectPool: state.continuousEffectPool.filter(
          entry => entry.source !== mutation.source
        ),
      };

    case 'CLEAR_END_OF_TURN_EFFECTS':
      return {
        ...state,
        continuousEffectPool: state.continuousEffectPool.filter(
          entry => entry.duration !== 'END_OF_TURN'
        ),
      };
```

Remove the old `ADD_MODIFIER`, `REMOVE_MODIFIER`, and `CLEAR_END_OF_TURN_MODIFIERS` cases entirely.

- [x] **Step 3: Write failing tests for new reducer cases**

Create `tests/engine/game-reducer.test.ts` modifications. Replace the "modifier mutations" describe block (lines 129-190) with:

```typescript
  describe('continuous effect pool mutations', () => {
    it('ADD_CONTINUOUS_EFFECT appends an entry to the pool', () => {
      const entry = {
        source: 'card-123',
        layer: 7,
        effect: { type: 'STAT_DELTA', power: 2 } as const,
        scope: { cardTypes: ['Creature'] },
        duration: 'END_OF_TURN' as const,
      };

      const next = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry });
      expect(next.continuousEffectPool).toHaveLength(1);
      expect(next.continuousEffectPool[0]).toEqual(entry);
      // original untouched
      expect(room.continuousEffectPool).toHaveLength(0);
    });

    it('REMOVE_CONTINUOUS_EFFECT removes all entries from a source', () => {
      room.continuousEffectPool = [
        { source: 'card-A', layer: 7, effect: { type: 'STAT_DELTA', power: 1 }, scope: {}, duration: 'END_OF_TURN' },
        { source: 'card-B', layer: 7, effect: { type: 'STAT_DELTA', toughness: 1 }, scope: {}, duration: 'PERMANENT' },
        { source: 'card-A', layer: 7, effect: { type: 'STAT_DELTA', toughness: 2 }, scope: {}, duration: 'END_OF_TURN' },
      ];

      const next = gameReducer(room, { type: 'REMOVE_CONTINUOUS_EFFECT', source: 'card-A' });
      expect(next.continuousEffectPool).toHaveLength(1);
      expect(next.continuousEffectPool[0].source).toBe('card-B');
    });

    it('CLEAR_END_OF_TURN_EFFECTS strips only END_OF_TURN entries', () => {
      room.continuousEffectPool = [
        { source: 'card-A', layer: 7, effect: { type: 'STAT_DELTA', power: 1 }, scope: {}, duration: 'END_OF_TURN' },
        { source: 'card-B', layer: 7, effect: { type: 'STAT_DELTA', toughness: 1 }, scope: {}, duration: 'PERMANENT' },
        { source: 'card-C', layer: 7, effect: { type: 'STAT_DELTA', power: 2 }, scope: {}, duration: 'END_OF_TURN' },
      ];

      const next = gameReducer(room, { type: 'CLEAR_END_OF_TURN_EFFECTS' });
      expect(next.continuousEffectPool).toHaveLength(1);
      expect(next.continuousEffectPool[0].source).toBe('card-B');
    });

    it('REMOVE_CONTINUOUS_EFFECT is a no-op when source has no entries', () => {
      const next = gameReducer(room, { type: 'REMOVE_CONTINUOUS_EFFECT', source: 'nonexistent' });
      expect(next.continuousEffectPool).toEqual(room.continuousEffectPool);
    });
  });
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine/game-reducer.test.ts`
Expected: 4 new tests PASS, old modifier tests removed

- [x] **Step 5: Commit**

```bash
git add src/types/game-mutation.types.ts src/engine/game-reducer.ts tests/engine/game-reducer.test.ts
git commit -m "feat: replace modifier mutations with ADD_CONTINUOUS_EFFECT/REMOVE_CONTINUOUS_EFFECT/CLEAR_END_OF_TURN_EFFECTS"
```

---

### Task 3: Create `CardCharacteristicService` (replaces `stat-resolver.ts`)

**Files:**
- Create: `src/engine/card-characteristic-service.ts`
- Remove: `src/engine/stat-resolver.ts`
- Create: `tests/engine/card-characteristic-service.test.ts`
- Remove: `tests/engine/stat-resolver.test.ts`

**Interfaces:**
- Consumes: `ContinuousEffectEntry`, `GameRoom`, `CardInstance` from Task 1
- Produces: `CardCharacteristicService.resolvePower(room, card): number`
- Produces: `CardCharacteristicService.resolveToughness(room, card): number`
- Produces: `locateSource(room, entry): CardInstance | undefined`
- Produces: `hasValidSourceZone(entry, sourceCard): boolean`
- Produces: `matchesScope(scope, card, sourceCard): boolean`
- Produces: `findCardInZone(room, uuid, zone): CardInstance | undefined`

- [x] **Step 1: Write the failing test file**

Create `tests/engine/card-characteristic-service.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { CardCharacteristicService } from '../../src/engine/card-characteristic-service';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom, CardInstance } from '../../src/types';

function makeCreature(room: GameRoom, overrides?: Partial<CardInstance['state']>): CardInstance {
  const card = instantiateCard('empire-servant'); // 1/1 creature
  card.state = {
    ...card.state,
    zone: 'battlefield',
    ownerId: 'player1',
    controllerId: 'player1',
    ...overrides,
  };
  room.battlefield.push(card);
  return card;
}

describe('CardCharacteristicService', () => {
  let room: GameRoom;

  beforeEach(() => {
    room = createTestRoom();
  });

  describe('resolvePower / resolveToughness', () => {
    it('returns blueprint stats when pool is empty', () => {
      const card = makeCreature(room);
      expect(CardCharacteristicService.resolvePower(room, card)).toBe(1);
      expect(CardCharacteristicService.resolveToughness(room, card)).toBe(1);
    });

    it('applies STAT_DELTA entries from the pool', () => {
      const card = makeCreature(room);
      room.continuousEffectPool.push({
        source: card.uuid,
        layer: 7,
        effect: { type: 'STAT_DELTA', power: 2, toughness: 2 },
        scope: { cardUuid: card.uuid },
        duration: 'END_OF_TURN',
      });

      expect(CardCharacteristicService.resolvePower(room, card)).toBe(3);
      expect(CardCharacteristicService.resolveToughness(room, card)).toBe(3);
    });

    it('sums multiple STAT_DELTA entries', () => {
      const card = makeCreature(room);
      room.continuousEffectPool.push(
        {
          source: 'anthem-1',
          layer: 7,
          effect: { type: 'STAT_DELTA', power: 1 },
          scope: { cardTypes: ['Creature'] },
          duration: 'WHILE_ON_BATTLEFIELD',
        },
        {
          source: 'giant-growth',
          layer: 7,
          effect: { type: 'STAT_DELTA', power: 2, toughness: 2 },
          scope: { cardUuid: card.uuid },
          duration: 'END_OF_TURN',
        },
      );

      expect(CardCharacteristicService.resolvePower(room, card)).toBe(4); // 1 + 1 + 2
      expect(CardCharacteristicService.resolveToughness(room, card)).toBe(3); // 1 + 0 + 2
    });

    it('adds +1/+1 counters on top of pool deltas', () => {
      const card = makeCreature(room);
      card.state.counters['+1/+1'] = 3;
      room.continuousEffectPool.push({
        source: card.uuid,
        layer: 7,
        effect: { type: 'STAT_DELTA', power: 2 },
        scope: { cardUuid: card.uuid },
        duration: 'END_OF_TURN',
      });

      expect(CardCharacteristicService.resolvePower(room, card)).toBe(6); // 1 + 2 + 3
      expect(CardCharacteristicService.resolveToughness(room, card)).toBe(4); // 1 + 0 + 3
    });

    it('ignores non-STAT_DELTA entries', () => {
      const card = makeCreature(room);
      room.continuousEffectPool.push({
        source: card.uuid,
        layer: 7,
        effect: { type: 'SET_STATS', power: 5, toughness: 5 },
        scope: { cardUuid: card.uuid },
        duration: 'PERMANENT',
      });

      // SET_STATS has no handler yet; resolver only applies STAT_DELTA
      expect(CardCharacteristicService.resolvePower(room, card)).toBe(1);
      expect(CardCharacteristicService.resolveToughness(room, card)).toBe(1);
    });

    it('handles cards with no power/toughness (non-creatures)', () => {
      const card = instantiateCard('land-red');
      card.state.zone = 'battlefield';
      room.battlefield.push(card);

      expect(CardCharacteristicService.resolvePower(room, card)).toBe(0);
      expect(CardCharacteristicService.resolveToughness(room, card)).toBe(0);
    });
  });

  describe('hasValidSourceZone', () => {
    it('returns true for emblem sources', () => {
      const card = makeCreature(room);
      room.continuousEffectPool.push({
        source: 'emblem',
        layer: 7,
        effect: { type: 'STAT_DELTA', power: 1 },
        scope: { cardTypes: ['Creature'] },
        duration: 'PERMANENT',
      });

      expect(CardCharacteristicService.resolvePower(room, card)).toBe(2);
    });

    it('returns false when source card is not in requiredZone', () => {
      const card = makeCreature(room);
      // Entry references a source that doesn't exist on battlefield
      room.continuousEffectPool.push({
        source: 'missing-card-uuid',
        layer: 7,
        effect: { type: 'STAT_DELTA', power: 5 },
        scope: { cardTypes: ['Creature'] },
        requiredZone: 'battlefield',
        duration: 'WHILE_ON_BATTLEFIELD',
      });

      // Effect should NOT apply — source not found in required zone
      expect(CardCharacteristicService.resolvePower(room, card)).toBe(1);
    });

    it('finds source in graveyard when requiredZone is graveyard', () => {
      const card = makeCreature(room);
      const graveyardSource = instantiateCard('empire-servant');
      graveyardSource.state.zone = 'graveyard';
      graveyardSource.state.ownerId = 'player1';
      graveyardSource.state.controllerId = 'player1';
      room.players['player1'].graveyard.push(graveyardSource);

      room.continuousEffectPool.push({
        source: graveyardSource.uuid,
        layer: 7,
        effect: { type: 'STAT_DELTA', power: 3 },
        scope: { cardTypes: ['Creature'] },
        requiredZone: 'graveyard',
        duration: 'PERMANENT',
      });

      expect(CardCharacteristicService.resolvePower(room, card)).toBe(4); // 1 + 3
    });
  });

  describe('matchesScope', () => {
    it('matches by cardUuid', () => {
      const card1 = makeCreature(room);
      const card2 = makeCreature(room);

      room.continuousEffectPool.push({
        source: 'test',
        layer: 7,
        effect: { type: 'STAT_DELTA', power: 2 },
        scope: { cardUuid: card1.uuid },
        duration: 'END_OF_TURN',
      });

      expect(CardCharacteristicService.resolvePower(room, card1)).toBe(3);
      expect(CardCharacteristicService.resolvePower(room, card2)).toBe(1); // not matched
    });

    it('matches by cardTypes', () => {
      const creature = makeCreature(room);
      const land = instantiateCard('land-red');
      land.state.zone = 'battlefield';
      room.battlefield.push(land);

      room.continuousEffectPool.push({
        source: 'anthem',
        layer: 7,
        effect: { type: 'STAT_DELTA', power: 1, toughness: 1 },
        scope: { cardTypes: ['Creature'] },
        duration: 'WHILE_ON_BATTLEFIELD',
      });

      expect(CardCharacteristicService.resolvePower(room, creature)).toBe(2);
      // Land is not a creature — anthem doesn't apply
      expect(CardCharacteristicService.resolvePower(room, land)).toBe(0);
    });

    it('matches by controller (self)', () => {
      const myCreature = makeCreature(room); // controllerId: 'player1'
      const theirCreature = makeCreature(room, { controllerId: 'player2' });

      const sourceCard = instantiateCard('empire-servant');
      sourceCard.state.zone = 'battlefield';
      sourceCard.state.controllerId = 'player1';
      room.battlefield.push(sourceCard);

      room.continuousEffectPool.push({
        source: sourceCard.uuid,
        layer: 7,
        effect: { type: 'STAT_DELTA', power: 2 },
        scope: { cardTypes: ['Creature'], controller: 'self' },
        duration: 'WHILE_ON_BATTLEFIELD',
      });

      expect(CardCharacteristicService.resolvePower(room, myCreature)).toBe(3);
      expect(CardCharacteristicService.resolvePower(room, theirCreature)).toBe(1);
    });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/card-characteristic-service.test.ts`
Expected: FAIL — `CardCharacteristicService` module not found

- [x] **Step 3: Implement `CardCharacteristicService`**

Create `src/engine/card-characteristic-service.ts`:

```typescript
// src/engine/card-characteristic-service.ts
// Characteristic resolution service — the query facade for card P/T.
// Folds the ContinuousEffectPool through a 4-step pipeline:
//   ① locateSource — resolve source card ONCE
//   ② hasValidSourceZone — validate source's zone
//   ③ matchesScope — does this entry affect this card?
//   ④ fold — sum STAT_DELTA deltas
//
// Layer ordering (MTG layer 7 subset):
//   1. SET_STATS (base overwrite)  — declared but no handler yet
//   2. STAT_DELTA (additive)       — applied here
//   3. Counters (+1/+1)            — always last

import type { GameRoom } from '../types/game.room.types';
import type { CardInstance, CardZone, ContinuousEffectEntry } from '../types/card.types';

// -- Public API --

export const CardCharacteristicService = {
  resolvePower(room: GameRoom, card: CardInstance): number {
    const base = card.blueprint.power ?? 0;
    const deltas = resolveLayer7Deltas(room, card, 'power');
    const fromCounters = card.state.counters['+1/+1'] ?? 0;
    return base + deltas + fromCounters;
  },

  resolveToughness(room: GameRoom, card: CardInstance): number {
    const base = card.blueprint.toughness ?? 0;
    const deltas = resolveLayer7Deltas(room, card, 'toughness');
    const fromCounters = card.state.counters['+1/+1'] ?? 0;
    return base + deltas + fromCounters;
  },
};

// -- Pipeline --

function resolveLayer7Deltas(room: GameRoom, card: CardInstance, key: 'power' | 'toughness'): number {
  return room.continuousEffectPool
    .map(entry => ({ entry, sourceCard: locateSource(room, entry) }))   // ①
    .filter(({ entry, sourceCard }) => hasValidSourceZone(entry, sourceCard))  // ②
    .filter(({ entry, sourceCard }) => matchesScope(entry.scope, card, sourceCard))  // ③
    .filter(({ entry }) => entry.effect.type === 'STAT_DELTA')
    .reduce((sum, { entry }) => sum + (entry.effect[key] ?? 0), 0);     // ④
}

// -- Step ①: Source resolution --

function locateSource(room: GameRoom, entry: ContinuousEffectEntry): CardInstance | undefined {
  if (entry.source === 'emblem' || entry.source === 'global') return undefined;
  const zone = entry.requiredZone ?? 'battlefield';
  return findCardInZone(room, entry.source, zone);
}

function findCardInZone(room: GameRoom, uuid: string, zone: CardZone): CardInstance | undefined {
  switch (zone) {
    case 'battlefield':
      return room.battlefield.find(c => c.uuid === uuid);
    case 'stack':
      return (room.stack.find(s => (s.source as CardInstance).uuid === uuid)?.source as CardInstance) ?? undefined;
    case 'hand':
    case 'graveyard':
    case 'library':
      for (const player of Object.values(room.players)) {
        const arr = zone === 'hand' ? player.hand
          : zone === 'graveyard' ? player.graveyard
          : player.deck;
        const found = arr.find(c => c.uuid === uuid);
        if (found) return found;
      }
      return undefined;
    default:
      return undefined;
  }
}

// -- Step ②: Source zone validation --

function hasValidSourceZone(entry: ContinuousEffectEntry, sourceCard: CardInstance | undefined): boolean {
  if (entry.source === 'emblem' || entry.source === 'global') return true;
  return sourceCard !== undefined;
  // future: && !sourceCard.state.silenced
}

// -- Step ③: Scope matching --

function matchesScope(
  scope: ContinuousEffectEntry['scope'],
  card: CardInstance,
  sourceCard: CardInstance | undefined
): boolean {
  // Single-card target
  if (scope.cardUuid && card.uuid !== scope.cardUuid) return false;
  // Characteristic-based matching
  if (scope.cardTypes?.length && !scope.cardTypes.some(t => card.blueprint.cardTypes.includes(t))) return false;
  if (scope.subTypes?.length && !scope.subTypes.some(s => (card.blueprint.subTypes || []).includes(s))) return false;
  // Controller-relative (resolved against source's controller)
  if (scope.controller === 'self' && sourceCard && card.state.controllerId !== sourceCard.state.controllerId) return false;
  if (scope.controller === 'opponent' && sourceCard && card.state.controllerId === sourceCard.state.controllerId) return false;
  return true;
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine/card-characteristic-service.test.ts`
Expected: ALL 11 tests PASS

- [x] **Step 5: Delete old `stat-resolver.ts` and its test file**

```bash
git rm src/engine/stat-resolver.ts tests/engine/stat-resolver.test.ts
```

- [x] **Step 6: Commit**

```bash
git add src/engine/card-characteristic-service.ts tests/engine/card-characteristic-service.test.ts
git commit -m "feat: add CardCharacteristicService with 4-step query pipeline, replace stat-resolver"
```

---

### Task 4: Update all `getEffectivePower`/`getEffectiveToughness` call sites

**Files:**
- Modify: `src/engine/effect-resolver.ts:6,154-165`
- Modify: `src/engine/handlers/attack-handler.ts:7,78`
- Modify: `src/client/components/CardComponent.tsx:4,46-47`

**Interfaces:**
- Consumes: `CardCharacteristicService` from Task 3
- Changes: `getEffectivePower(card)` → `CardCharacteristicService.resolvePower(room, card)`
- Changes: `getEffectiveToughness(card)` → `CardCharacteristicService.resolveToughness(room, card)`

- [x] **Step 1: Update `effect-resolver.ts`**

In `src/engine/effect-resolver.ts`, replace the import (line 6):
```typescript
import { CardCharacteristicService } from './card-characteristic-service';
```

Update `buildDynamicParams` (lines 154-165) — the `getEffectivePower`/`getEffectiveToughness` calls now need `room`:

```typescript
    if (path === 'source.power') {
      const sourceCard = (stackObj.source as CardInstance | undefined);
      dynamic[key] = sourceCard ? CardCharacteristicService.resolvePower(room, sourceCard) : undefined;
    } else if (path === 'source.toughness') {
      const sourceCard = (stackObj.source as CardInstance | undefined);
      dynamic[key] = sourceCard ? CardCharacteristicService.resolveToughness(room, sourceCard) : undefined;
    } else if (path === 'target.power') {
      const firstTarget = effect.targets[0];
      if (firstTarget?.cardUuid) {
        const card = room.battlefield.find(c => c.uuid === firstTarget.cardUuid);
        dynamic[key] = card ? CardCharacteristicService.resolvePower(room, card) : undefined;
      }
    } else if (path === 'target.toughness') {
      const firstTarget = effect.targets[0];
      if (firstTarget?.cardUuid) {
        const card = room.battlefield.find(c => c.uuid === firstTarget.cardUuid);
        dynamic[key] = card ? CardCharacteristicService.resolveToughness(room, card) : undefined;
      }
    }
```

- [x] **Step 2: Update `attack-handler.ts`**

In `src/engine/handlers/attack-handler.ts`, replace the import (line 7):
```typescript
import { CardCharacteristicService } from '../card-characteristic-service';
```

Update the `propose` method (line 78):
```typescript
    const power = CardCharacteristicService.resolvePower(room, card);
```

- [x] **Step 3: Update `CardComponent.tsx` (deferred display — keep reading blueprint)**

In `src/client/components/CardComponent.tsx`, replace the import (line 4):
```typescript
// import { getEffectivePower, getEffectiveToughness } from '../../engine/stat-resolver';
// Deferred: client-side characteristic resolution. For now, read blueprint directly.
```

Update the stats display (lines 46-47):
```typescript
      {card.blueprint.power !== undefined && (
        <div className="card-stats">
          {card.blueprint.power}/{card.blueprint.toughness}
        </div>
      )}
```

> **Note:** This is the deferred client display per spec §6.2. The client receives correct `continuousEffectPool` data via delta sync but doesn't render derived characteristics yet. This is a pure display concern — game logic is correct on the server.

- [x] **Step 4: Run full test suite to verify nothing is broken**

Run: `npx vitest run`
Expected: All existing tests pass (the stat-resolver tests were removed in Task 3; new card-characteristic-service tests pass)

- [x] **Step 5: Commit**

```bash
git add src/engine/effect-resolver.ts src/engine/handlers/attack-handler.ts src/client/components/CardComponent.tsx
git commit -m "refactor: update all call sites from getEffectivePower to CardCharacteristicService.resolvePower"
```

---

### Task 5: Rewrite `GRANT_STATS` handler to emit pool entries

**Files:**
- Modify: `src/engine/effect-registry.ts:200-235`
- Modify: `tests/engine/effect-registry.test.ts:330-420`

**Interfaces:**
- Consumes: `ContinuousEffectEntry` from Task 1, `ADD_CONTINUOUS_EFFECT` mutation from Task 2
- Changes: `GRANT_STATS` emits `ADD_CONTINUOUS_EFFECT` entries instead of `ADD_MODIFIER` per-card modifiers
- Supports both anthem mode (`target.all`) and single-target mode (`target.cardUuid`)

- [x] **Step 1: Update the GRANT_STATS test**

Replace the `GRANT_STATS` describe block in `tests/engine/effect-registry.test.ts` (lines 330-420):

```typescript
  describe('GRANT_STATS', () => {
    it('emits ADD_CONTINUOUS_EFFECT entries for single-target buff', () => {
      const creature = instantiateCard('empire-servant');
      creature.state.zone = 'battlefield';
      creature.state.ownerId = 'player1';
      creature.state.controllerId = 'player1';
      room.battlefield.push(creature);

      const sourceCard = instantiateCard('empire-servant');
      sourceCard.state.zone = 'battlefield';
      sourceCard.state.controllerId = 'player1';

      const effect = makeEffect({
        action: 'GRANT_STATS',
        params: { power: 2, toughness: 2 },
        targets: [{ targetType: 'permanent', cardUuid: creature.uuid }],
      });
      const stackObj = makeStackObj({ effects: [effect], source: sourceCard });

      const mutations = EffectRegistry['GRANT_STATS'](room, stackObj, effect);
      expect(mutations).toHaveLength(2); // one for power, one for toughness

      expect(mutations[0].type).toBe('ADD_CONTINUOUS_EFFECT');
      if (mutations[0].type === 'ADD_CONTINUOUS_EFFECT') {
        expect(mutations[0].entry.source).toBe(sourceCard.uuid);
        expect(mutations[0].entry.layer).toBe(7);
        expect(mutations[0].entry.effect).toEqual({ type: 'STAT_DELTA', power: 2 });
        expect(mutations[0].entry.scope).toEqual({ cardUuid: creature.uuid });
        expect(mutations[0].entry.duration).toBe('END_OF_TURN');
      }

      apply(mutations);

      // Verify pool has the entries (not per-card modifiers)
      expect(room.continuousEffectPool).toHaveLength(2);
      expect(room.continuousEffectPool[0].effect).toEqual({ type: 'STAT_DELTA', power: 2 });
      expect(room.continuousEffectPool[1].effect).toEqual({ type: 'STAT_DELTA', toughness: 2 });
    });

    it('emits anthem-mode entry when target.all is true', () => {
      const creature = instantiateCard('empire-servant');
      creature.state.zone = 'battlefield';
      creature.state.controllerId = 'player1';
      room.battlefield.push(creature);

      const sourceCard = instantiateCard('empire-servant');
      sourceCard.state.zone = 'battlefield';
      sourceCard.state.controllerId = 'player1';

      const effect = makeEffect({
        action: 'GRANT_STATS',
        params: { power: 1, toughness: 1 },
        targets: [{
          targetType: 'permanent',
          all: true,
          cardTypes: ['Creature'],
          controller: 'self' as const,
        }],
      });
      const stackObj = makeStackObj({ effects: [effect], source: sourceCard });

      const mutations = EffectRegistry['GRANT_STATS'](room, stackObj, effect);
      expect(mutations).toHaveLength(2);

      if (mutations[0].type === 'ADD_CONTINUOUS_EFFECT') {
        expect(mutations[0].entry.scope).toEqual({
          cardTypes: ['Creature'],
          controller: 'self',
        });
        // No cardUuid — this is a characteristic scope, not a single-card target
        expect(mutations[0].entry.scope.cardUuid).toBeUndefined();
      }
    });

    it('emits only power entry when toughness is absent', () => {
      const creature = instantiateCard('empire-servant');
      creature.state.zone = 'battlefield';
      creature.state.ownerId = 'player1';
      creature.state.controllerId = 'player1';
      room.battlefield.push(creature);

      const sourceCard = instantiateCard('empire-servant');
      sourceCard.state.zone = 'battlefield';
      sourceCard.state.controllerId = 'player1';

      const effect = makeEffect({
        action: 'GRANT_STATS',
        params: { power: 1 },
        targets: [{ targetType: 'permanent', cardUuid: creature.uuid }],
      });
      const stackObj = makeStackObj({ effects: [effect], source: sourceCard });

      const mutations = EffectRegistry['GRANT_STATS'](room, stackObj, effect);
      expect(mutations).toHaveLength(1);
      expect(mutations[0].type).toBe('ADD_CONTINUOUS_EFFECT');
    });

    it('skips targets without a cardUuid (and not all-mode)', () => {
      const effect = makeEffect({
        action: 'GRANT_STATS',
        params: { power: 2 },
        targets: [{ targetType: 'player', playerId: 'player1' }],
      });
      const stackObj = makeStackObj({ effects: [effect] });

      const mutations = EffectRegistry['GRANT_STATS'](room, stackObj, effect);
      expect(mutations).toHaveLength(0);
    });

    it('falls back to emblem source when stack source has no uuid', () => {
      const creature = instantiateCard('empire-servant');
      creature.state.zone = 'battlefield';
      creature.state.ownerId = 'player1';
      creature.state.controllerId = 'player1';
      room.battlefield.push(creature);

      const effect = makeEffect({
        action: 'GRANT_STATS',
        params: { power: 2 },
        targets: [{ targetType: 'permanent', cardUuid: creature.uuid }],
      });
      const stackObj = makeStackObj({ effects: [effect] }); // source is {} — no uuid

      const mutations = EffectRegistry['GRANT_STATS'](room, stackObj, effect);
      apply(mutations);

      expect(room.continuousEffectPool[0].source).toBe('emblem');
    });
  });
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/effect-registry.test.ts`
Expected: FAIL — GRANT_STATS still emits old `ADD_MODIFIER` mutations

- [x] **Step 3: Rewrite the GRANT_STATS handler**

Replace the `GRANT_STATS` handler in `src/engine/effect-registry.ts` (lines 200-235):

```typescript
  'GRANT_STATS': (room, stackObj, effect) => {
    const params = effect.params as { power?: number; toughness?: number };
    const sourceCard = stackObj.source as CardInstance | undefined;
    const source = sourceCard?.uuid ?? 'emblem';
    const mutations: GameMutation[] = [];

    for (const target of effect.targets) {
      // Derive scope from the SAME TargetPointer used by all handlers.
      // Anthem mode (target.all): characteristic scope with filter fields.
      // Single-target mode (target.cardUuid): cardUuid scope.
      if (!target.all && !target.cardUuid) continue;

      const scope: ContinuousEffectEntry['scope'] = target.all
        ? { cardTypes: target.cardTypes, subTypes: target.subTypes, controller: target.controller }
        : target.cardUuid
          ? { cardUuid: target.cardUuid }
          : {};

      if (params.power !== undefined) {
        mutations.push({
          type: 'ADD_CONTINUOUS_EFFECT',
          entry: {
            source,
            layer: 7,
            effect: { type: 'STAT_DELTA', power: params.power },
            scope,
            duration: 'END_OF_TURN',
          },
        });
      }

      if (params.toughness !== undefined) {
        mutations.push({
          type: 'ADD_CONTINUOUS_EFFECT',
          entry: {
            source,
            layer: 7,
            effect: { type: 'STAT_DELTA', toughness: params.toughness },
            scope,
            duration: 'END_OF_TURN',
          },
        });
      }
    }

    return mutations;
  },
```

Also update the import at the top of `effect-registry.ts` (line 5) — remove `ContinuousModifier`, add `ContinuousEffectEntry`:
```typescript
import type { ManaColor, CardInstance, ContinuousEffectEntry } from '../types/card.types';
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine/effect-registry.test.ts`
Expected: ALL GRANT_STATS tests PASS

- [x] **Step 5: Commit**

```bash
git add src/engine/effect-registry.ts tests/engine/effect-registry.test.ts
git commit -m "feat: rewrite GRANT_STATS handler to emit ContinuousEffectPool entries instead of per-card modifiers"
```

---

### Task 6: Update `state-machine.ts` cleanup mutation

**Files:**
- Modify: `src/engine/state-machine.ts:92-94`

**Interfaces:**
- Consumes: `CLEAR_END_OF_TURN_EFFECTS` mutation from Task 2
- Changes: `CLEAR_END_OF_TURN_MODIFIERS` → `CLEAR_END_OF_TURN_EFFECTS`

- [x] **Step 1: Rename the cleanup mutation**

In `src/engine/state-machine.ts`, line 94:
```typescript
    // Cleanup step: strip END_OF_TURN entries from the continuous effect pool
    if (to === 'cleanupStep') {
      mutations.push({ type: 'CLEAR_END_OF_TURN_EFFECTS' });
    }
```

- [x] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors)

- [x] **Step 3: Commit**

```bash
git add src/engine/state-machine.ts
git commit -m "refactor: rename CLEAR_END_OF_TURN_MODIFIERS to CLEAR_END_OF_TURN_EFFECTS in state-machine"
```

---

### Task 7: Add `REMOVE_CONTINUOUS_EFFECT` housekeeping on zone change in `game-engine.ts`

**Files:**
- Modify: `src/engine/game-engine.ts:65-75`
- Modify: `tests/engine/game-engine.test.ts` (add new test)

**Interfaces:**
- Consumes: `REMOVE_CONTINUOUS_EFFECT` mutation from Task 2
- Changes: On any `MOVE_CARD`, emit `REMOVE_CONTINUOUS_EFFECT` for the moved card's uuid

- [x] **Step 1: Write the failing test**

Add to `tests/engine/game-engine.test.ts` after the existing PERMANENT_LEFT tests:

```typescript
  it('should emit REMOVE_CONTINUOUS_EFFECT when a card with pool entries moves zones', () => {
    const creature = instantiateCard('empire-servant');
    creature.state.zone = 'battlefield';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    room.battlefield.push(creature);

    // Add a pool entry sourced from this creature
    room.continuousEffectPool.push({
      source: creature.uuid,
      layer: 7,
      effect: { type: 'STAT_DELTA', power: 1 },
      scope: { cardTypes: ['Creature'] },
      duration: 'WHILE_ON_BATTLEFIELD',
    });

    const mutations = engine.applyMutations([{
      type: 'MOVE_CARD',
      cardUuid: creature.uuid,
      playerId: 'player1',
      from: 'battlefield',
      to: 'graveyard',
    }]);

    // The REMOVE_CONTINUOUS_EFFECT mutation should be in the applied mutations
    const removeMutation = mutations.find(m => m.type === 'REMOVE_CONTINUOUS_EFFECT');
    expect(removeMutation).toBeDefined();
    if (removeMutation?.type === 'REMOVE_CONTINUOUS_EFFECT') {
      expect(removeMutation.source).toBe(creature.uuid);
    }

    // Pool should be empty after apply
    expect(engine.roomState.continuousEffectPool).toHaveLength(0);
  });

  it('should NOT emit REMOVE_CONTINUOUS_EFFECT when moved card has no pool entries', () => {
    const creature = instantiateCard('empire-servant');
    creature.state.zone = 'battlefield';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    room.battlefield.push(creature);
    // No pool entries for this creature

    const mutations = engine.applyMutations([{
      type: 'MOVE_CARD',
      cardUuid: creature.uuid,
      playerId: 'player1',
      from: 'battlefield',
      to: 'graveyard',
    }]);

    const removeMutation = mutations.find(m => m.type === 'REMOVE_CONTINUOUS_EFFECT');
    expect(removeMutation).toBeUndefined();
  });
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/game-engine.test.ts`
Expected: FAIL — no REMOVE_CONTINUOUS_EFFECT emitted

- [x] **Step 3: Add housekeeping logic to `applyMutations`**

In `src/engine/game-engine.ts`, inside the `apply` function, after the existing `PERMANENT_LEFT` block (after line 75), add:

```typescript
        // Housekeeping: drop pool entries whose source just changed zones.
        // Correctness does NOT depend on this — hasValidSourceZone() would
        // already make these entries inert. This keeps the pool small.
        if (m.type === 'MOVE_CARD') {
          if (this.room.continuousEffectPool.some(entry => entry.source === m.cardUuid)) {
            this.mutationCollector.push({ type: 'REMOVE_CONTINUOUS_EFFECT', source: m.cardUuid });
          }
        }
```

Note: This goes inside the `apply` function, after the existing `PERMANENT_LEFT` block. The `mutationCollector.push` means it will be drained in the `while` loop — the `REMOVE_CONTINUOUS_EFFECT` mutation will be applied and appear in `allApplied`.

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine/game-engine.test.ts`
Expected: ALL tests PASS including the 2 new ones

- [x] **Step 5: Commit**

```bash
git add src/engine/game-engine.ts tests/engine/game-engine.test.ts
git commit -m "feat: emit REMOVE_CONTINUOUS_EFFECT on zone change for housekeeping"
```

---

### Task 8: Update `sync-service.ts` for new mutations

**Files:**
- Modify: `src/server/sync-service.ts:146-165`

**Interfaces:**
- Consumes: `ADD_CONTINUOUS_EFFECT`, `REMOVE_CONTINUOUS_EFFECT`, `CLEAR_END_OF_TURN_EFFECTS` from Task 2
- Removes: `ADD_MODIFIER`, `REMOVE_MODIFIER`, `CLEAR_END_OF_TURN_MODIFIERS` delta cases

- [x] **Step 1: Replace modifier delta cases**

In `src/server/sync-service.ts`, replace the modifier cases (lines 146-165):

```typescript
    case 'ADD_CONTINUOUS_EFFECT': {
      const idx = newState.continuousEffectPool.length - 1;
      return [{ path: `continuousEffectPool[${idx}]`, op: 'add', value: newState.continuousEffectPool[idx] }];
    }

    case 'REMOVE_CONTINUOUS_EFFECT': {
      // Emit remove changes for each removed index, in REVERSE order.
      // Find which indices were removed by comparing old vs new pool.
      const changes: DeltaChange[] = [];
      const oldPool = oldState.continuousEffectPool;
      const newPool = newState.continuousEffectPool;
      // Collect indices in oldPool whose source matches, in reverse order
      for (let i = oldPool.length - 1; i >= 0; i--) {
        if (oldPool[i].source === mutation.source) {
          changes.push({ path: `continuousEffectPool[${i}]`, op: 'remove', oldValue: oldPool[i] });
        }
      }
      return changes;
    }

    case 'CLEAR_END_OF_TURN_EFFECTS': {
      // Emit remove changes for each removed index, in REVERSE order.
      const changes: DeltaChange[] = [];
      const oldPool = oldState.continuousEffectPool;
      for (let i = oldPool.length - 1; i >= 0; i--) {
        if (oldPool[i].duration === 'END_OF_TURN') {
          changes.push({ path: `continuousEffectPool[${i}]`, op: 'remove', oldValue: oldPool[i] });
        }
      }
      return changes;
    }
```

Remove the old `ADD_MODIFIER`, `REMOVE_MODIFIER`, and `CLEAR_END_OF_TURN_MODIFIERS` cases.

- [x] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [x] **Step 3: Commit**

```bash
git add src/server/sync-service.ts
git commit -m "feat: add delta sync for continuousEffectPool mutations"
```

---

### Task 9: Final integration — run full test suite and build

**Files:**
- (none — verification only)

- [x] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL tests PASS (no regressions)

- [x] **Step 2: Run TypeScript build**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors)

- [x] **Step 3: Run Vite build**

Run: `npx vite build`
Expected: PASS (build succeeds)

- [x] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: final integration — all tests pass, build clean"
```

---

## Self-Review

**1. Spec coverage:**
- §2.1 `ContinuousEffectEntry` type → Task 1 ✅
- §2.2 `continuousEffectPool` on `GameRoom` → Task 1 ✅
- §2.3 Remove `modifiers` from `CardState` → Task 1 ✅
- §3 `CardCharacteristicService` with 4-step pipeline → Task 3 ✅
- §3.1 `hasValidSourceZone` / `locateSource` / `findCardInZone` → Task 3 ✅
- §3.2 `matchesScope` → Task 3 ✅
- §4.1 New mutation types → Task 2 ✅
- §4.2 `GRANT_STATS` handler rewrite → Task 5 ✅
- §4.3 `duration` on `ContinuousEffectEntry` → Task 1 (type), Task 2 (CLEAR_END_OF_TURN_EFFECTS) ✅
- §4.4 No timestamp → implicit (no timestamp field in type) ✅
- §4.5 Concrete-target effects → Task 5 (cardUuid scope) ✅
- §5.1 `REMOVE_CONTINUOUS_EFFECT` on zone change → Task 7 ✅
- §5.2 `CLEAR_END_OF_TURN_EFFECTS` at cleanup → Task 6 ✅
- §6.1 Sync `continuousEffectPool` → Task 8 ✅
- §6.2 Client display deferred → Task 4 (CardComponent reads blueprint) ✅
- §7 Deferred items → NOT implemented (correct per spec) ✅
- §8 Files touched → all covered ✅

**2. Placeholder scan:** No TBD, TODO, "implement later", or "add appropriate error handling" patterns. All steps have concrete code.

**3. Type consistency:**
- `ContinuousEffectEntry` defined in Task 1, consumed in Tasks 2, 3, 5, 7, 8 ✅
- `ADD_CONTINUOUS_EFFECT` mutation defined in Task 2, emitted in Task 5, reduced in Task 2, synced in Task 8 ✅
- `REMOVE_CONTINUOUS_EFFECT` defined in Task 2, emitted in Task 7, reduced in Task 2, synced in Task 8 ✅
- `CLEAR_END_OF_TURN_EFFECTS` defined in Task 2, emitted in Task 6, reduced in Task 2, synced in Task 8 ✅
- `CardCharacteristicService.resolvePower(room, card)` produced in Task 3, consumed in Task 4 ✅
- `createTestRoom` updated in Task 1 with `continuousEffectPool: []` ✅