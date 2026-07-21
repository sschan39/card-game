# End-to-End Playable MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the card game playable end-to-end: two players connect, play RPS, draw cards, play lands, tap for mana, cast creatures, attack, and someone wins at 0 life.

**Architecture:** Two layers. Layer 1 fixes 3 critical type-system debts (CardInstance composition, open EffectPayload, open CardType). Layer 2 adds 6 playability features (mana pool integration, direct attack combat, life total tracking, untap step, onPlay fix, card-parser types). Zero new socket events — everything flows through existing `executeCardAction`/`playCard`/`stateDelta`.

**Note:** Spec item 2.4 (Typed Trigger Events) is already implemented — `TriggerEvent` union and `TriggeredAbility.triggerCondition: TriggerEvent` already exist in `card.types.ts`. No task needed.

**Tech Stack:** TypeScript 6.0.3, Vitest 4.1.10, Express 4.21.2, Socket.IO 4.8.1

## Global Constraints

- All 120 existing tests must continue to pass after each task
- No new socket events — use existing `executeCardAction`, `playCard`, `stateDelta`
- No new engine classes — mana pool is data on `PlayerState`, combat is an action handler
- No trigger evaluation — `TriggerEvent` types are defined but engine doesn't scan for matching triggers
- No GRANT_STATS handler — Crimson Hellkite's firebreathing won't work in this milestone
- Canonical card data is `src/library/card_data.json`; `data/card_data.json` is legacy
- Follow existing patterns: TDD (test first), Vitest `describe`/`it`/`expect`, TypeScript strict mode

---

### Task 1: Fix onPlay/onPlayEffect JSON Mismatch (Review #18)

**Files:**
- Modify: `src/library/card-parser.ts:65-70`
- Test: `tests/engine/play-card-handler.test.ts` (existing tests verify this indirectly)

**Interfaces:**
- Consumes: `normalizeCard(raw: Record<string, unknown>): CardBlueprint`
- Produces: No signature changes — `onCastEffects` now correctly populated from `raw.onPlay || raw.onCastEffects`

- [ ] **Step 1: Update card-parser.ts to read `onPlay` as fallback**

In `src/library/card-parser.ts`, in the `normalizeCard` function, change the `onCastEffects` line from:
```typescript
onCastEffects: ((raw.onCastEffects as Record<string, unknown>[]) || []).map(normalizeEffect),
```
To:
```typescript
onCastEffects: (((raw.onCastEffects || raw.onPlay) as Record<string, unknown>[]) || []).map(normalizeEffect),
```

- [ ] **Step 2: Run existing tests to verify no regression**

Run: `npx vitest run tests/engine/play-card-handler.test.ts`
Expected: All tests pass. The RPS cards' `onPlay` effects are now correctly parsed as `onCastEffects`.

- [ ] **Step 3: Commit**

```bash
git add src/library/card-parser.ts
git commit -m "fix: read onPlay as fallback for onCastEffects in card-parser"
```

---

### Task 2: Fix card-parser.ts normalizeAbility Return Type (Review #9)

**Files:**
- Modify: `src/library/card-parser.ts:28`
- Test: `tests/engine/play-card-handler.test.ts` (existing tests verify card parsing)

**Interfaces:**
- Consumes: `CardAbility = ActivatedAbility | TriggeredAbility` from `types/card.types.ts`
- Produces: `normalizeAbility(ability: Record<string, unknown>): CardAbility | null` (was `any`)

- [ ] **Step 1: Add return type to normalizeAbility**

In `src/library/card-parser.ts`, change the function signature from:
```typescript
export function normalizeAbility(ability: Record<string, unknown>): CardAbility | null {
```
The function already returns `CardAbility | null` at runtime — this just fixes the type annotation. No logic change needed.

- [ ] **Step 2: Run tests**

Run: `npx vitest run`
Expected: All 120 tests pass. No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/library/card-parser.ts
git commit -m "fix: add proper return type to normalizeAbility"
```

---

### Task 3: Extract RPS Card ID Constants (Review #8)

**Files:**
- Modify: `src/engine/room-factory.ts:1-5, 48-52`

**Interfaces:**
- Consumes: `instantiateCard(cardId: string): CardInstance` from `library/card-factory.ts`
- Produces: `RPS_CARD_IDS` constant (readonly tuple)

- [ ] **Step 1: Add constant and use it in setupRPS**

In `src/engine/room-factory.ts`, add after imports:
```typescript
const RPS_CARD_IDS = ['rock', 'paper', 'scissors'] as const;
```

Then in `setupRPS`, replace the three `instantiateCard` calls:
```typescript
// Before:
p1.hand.push(instantiateCard('rock'), instantiateCard('paper'), instantiateCard('scissors'));
p2.hand.push(instantiateCard('rock'), instantiateCard('paper'), instantiateCard('scissors'));

// After:
for (const id of RPS_CARD_IDS) {
  p1.hand.push(instantiateCard(id));
  p2.hand.push(instantiateCard(id));
}
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run`
Expected: All 120 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/engine/room-factory.ts
git commit -m "refactor: extract RPS card IDs to constant"
```

---

### Task 4: Open CardType to String (Review #2)

**Files:**
- Modify: `src/types/card.types.ts:13-15`

**Interfaces:**
- Consumes: None (type definition only)
- Produces: `CardType = string` (was `typeof CARD_TYPES[number]`), `CARD_TYPES` const array kept for runtime validation

- [ ] **Step 1: Widen CardType to string**

In `src/types/card.types.ts`, change:
```typescript
export const CARD_TYPES = ['Creature', 'Spell', 'Land', 'Artifact', 'Enchantment'] as const;
export type CardType = typeof CARD_TYPES[number];
```
To:
```typescript
export const CARD_TYPES = ['Creature', 'Spell', 'Land', 'Artifact', 'Enchantment'] as const;
/** Open string for extensibility — known types listed in CARD_TYPES const */
export type CardType = string;
```

- [ ] **Step 2: Run tests to verify no type errors**

Run: `npx vitest run`
Expected: All 120 tests pass. No new TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/card.types.ts
git commit -m "refactor: widen CardType to string for extensibility"
```

---

### Task 5: Open EffectPayload to Flexible Interface (Review #1)

**Files:**
- Modify: `src/types/effect.types.ts` (EffectPayload section)
- Modify: `src/engine/effect-registry.ts` (any handler that narrows EffectPayload)

**Interfaces:**
- Consumes: `EffectPayload` used by `ActivatedAbility.effect`, `TriggeredAbility.effect` in `card.types.ts`
- Produces: `EffectPayload = { effectId: string; params?: Record<string, unknown> }` (was closed union)

First, let me check the current EffectPayload definition:

- [ ] **Step 1: Read current EffectPayload definition**

Read `src/types/effect.types.ts` lines around the EffectPayload definition to see the current closed union.

- [ ] **Step 2: Replace closed union with open interface**

Replace the current `EffectPayload` type (the closed discriminated union) with:
```typescript
/**
 * Open effect payload for activated/triggered abilities.
 * effectId is an open string — new effects are added by registering
 * a handler in EffectRegistry + adding card data. No type changes needed.
 */
export interface EffectPayload {
  effectId: string;
  params?: Record<string, unknown>;
}
```

- [ ] **Step 3: Update effect-registry.ts handlers that narrow EffectPayload**

In `src/engine/effect-registry.ts`, check each handler for type narrowing on `EffectPayload`. The handlers already use `effect.params as { ... }` patterns, so they should work with the open interface. If any handler references the old union members directly, update to use the open pattern.

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: All 120 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/types/effect.types.ts src/engine/effect-registry.ts
git commit -m "refactor: open EffectPayload to flexible interface"
```

---

### Task 6: CardInstance Composition — Replace Inheritance (Review #4)

**Files:**
- Modify: `src/types/card.types.ts:87-91` (CardInstance interface)
- Modify: `src/library/card-factory.ts:1-70` (instantiateCard function)
- Modify: All consumers of `CardInstance` properties that accessed blueprint fields directly

**Interfaces:**
- Consumes: `CardBlueprint` (unchanged), `CardState` (unchanged)
- Produces: `CardInstance = { uuid: string; blueprint: CardBlueprint; state: CardState }` (was `extends CardBlueprint`)

This is the riskiest change — it touches every file that accesses card properties like `card.power`, `card.name`, `card.cardTypes`, etc. All must change to `card.blueprint.power`, `card.blueprint.name`, etc.

- [ ] **Step 1: Update CardInstance type definition**

In `src/types/card.types.ts`, replace:
```typescript
export interface CardInstance extends CardBlueprint {
    readonly uuid: string;
    state: CardState;
}
```
With:
```typescript
export interface CardInstance {
    readonly uuid: string;
    readonly blueprint: CardBlueprint;
    state: CardState;
}
```

- [ ] **Step 2: Rewrite instantiateCard in card-factory.ts**

Replace the entire `instantiateCard` function with:
```typescript
export function instantiateCard(cardId: string): CardInstance {
  const blueprint = getBlueprint(cardId);

  return {
    uuid: uuidv4(),
    blueprint,
    state: {
      zone: 'library',
      ownerId: '',
      controllerId: '',
      isTapped: false,
      summoningSickness: blueprint.cardTypes.includes('Creature'),
      damageTaken: 0,
      counters: {},
    },
  };
}
```

No more deep cloning — the blueprint is shared and immutable. All mutation happens on `card.state`.

- [ ] **Step 3: Update all consumers — find and fix property accesses**

Run TypeScript compiler to find all errors:
```bash
npx tsc --noEmit
```

For each error where a `CardInstance` property is accessed directly (e.g., `card.power`, `card.name`, `card.cardTypes`, `card.castRequirements`, `card.abilities`, `card.onCastEffects`, `card.onEnterEffects`, `card.id`, `card.rulesText`, `card.subTypes`), change to `card.blueprint.<property>`.

Key files that will need updates:
- `src/engine/action-validator.ts` — `card.cardTypes` → `card.blueprint.cardTypes`, `card.id` → `card.blueprint.id`
- `src/engine/action-service.ts` — any card property access
- `src/engine/effect-registry.ts` — `card.cardTypes` in `isPermanent` check (via `effect-resolver.ts`)
- `src/engine/effect-resolver.ts` — `card.cardTypes` in `isPermanent()`, `card.power` in `buildDynamicParams`
- `src/engine/handlers/play-card-handler.ts` — `card.castRequirements`, `card.onCastEffects`
- `src/engine/option-service.ts` — `card.cardTypes`, `card.abilities`, `card.castRequirements`
- `src/engine/state-machine.ts` — any card property access
- `src/engine/trigger-manager.ts` — any card property access
- `src/server.ts` — any card property access in socket handlers
- `tests/helpers/test-room-factory.ts` — test card setup
- `tests/engine/*.test.ts` — all test files accessing card properties

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass after fixing property accesses.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: CardInstance uses composition instead of inheritance"
```

---

### Task 7: Add Mana Pool Integration to ADD_MANA Handler

**Files:**
- Modify: `src/engine/effect-registry.ts` (ADD_MANA handler)

**Interfaces:**
- Consumes: `PlayerState.mana: ManaPool` (already exists on `GamePlayer`)
- Produces: ADD_MANA handler now writes to `player.mana[color]` instead of being a no-op

The `ADD_MANA` handler already exists in `effect-registry.ts` but currently doesn't write to the mana pool. The `PlayerState` already has a `mana: ManaPool` field. We need to connect them.

- [ ] **Step 1: Check current ADD_MANA handler**

Read the ADD_MANA handler in `src/engine/effect-registry.ts` to see its current implementation.

- [ ] **Step 2: Update ADD_MANA to write to player.mana**

Ensure the ADD_MANA handler writes to the player's mana pool:
```typescript
'ADD_MANA': (room, stackObj, effect) => {
  const params = effect.params as { color: string; amount: number };
  const player = room.players[stackObj.controllerId];
  if (player && params.color) {
    const color = params.color as ManaColor;
    player.mana[color] = (player.mana[color] || 0) + params.amount;
  }
},
```

- [ ] **Step 3: Write test for ADD_MANA handler**

Create or update a test that verifies tapping a land adds mana to the player's pool.

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/effect-registry.ts tests/
git commit -m "feat: ADD_MANA handler writes to player mana pool"
```

---

### Task 8: Add Untap Step to Turn Start

**Files:**
- Modify: `src/engine/state-machine.ts` (transition method, stateTurnStart handling)

**Interfaces:**
- Consumes: `GameRoom.battlefield`, `CardState.isTapped`, `CardState.summoningSickness`
- Produces: Untap logic runs during `stateTurnStart` transition

- [ ] **Step 1: Add untap logic to state-machine transition**

In `src/engine/state-machine.ts`, in the `transition` method, add untap logic when transitioning to `stateTurnStart`:

```typescript
transition(to: GameStateName): void {
  if (!this.canTransition(to)) {
    console.error(`Invalid transition from ${this.room.currentPhase} to ${to}`);
    return;
  }

  if (to === 'Stack') {
    this.previousPhase = this.room.currentPhase;
  }

  // Untap step: when entering stateTurnStart, untap all of active player's permanents
  if (to === 'stateTurnStart') {
    const playerId = this.room.activeTurnPlayerId;
    for (const card of this.room.battlefield) {
      if (card.state.controllerId === playerId) {
        card.state.isTapped = false;
        // Clear summoning sickness for creatures that entered before this turn
        // (creatures that entered THIS turn keep sickness until next untap)
        card.state.summoningSickness = false;
      }
    }
    // Reset mana pool for the active player
    const player = this.room.players[playerId];
    if (player) {
      player.mana = { red: 0, blue: 0, green: 0, black: 0, white: 0, colorless: 0 };
    }
  }

  this.room.currentPhase = to;
  this.eventBus.emit({
    eventId: 'PHASE_CHANGED',
    roomId: this.roomId,
    payload: { phase: this.room.currentPhase, currentPlayer: this.room.activeTurnPlayerId },
  });
}
```

- [ ] **Step 2: Write test for untap step**

Create a test that:
1. Creates a room with a tapped creature on the active player's battlefield
2. Transitions to `stateTurnStart`
3. Verifies the creature is now untapped and summoning sickness is cleared
4. Verifies mana pool is reset

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: All tests pass including new untap test.

- [ ] **Step 4: Commit**

```bash
git add src/engine/state-machine.ts tests/
git commit -m "feat: add untap step to stateTurnStart transition"
```

---

### Task 9: Add Direct Attack Action Handler

**Files:**
- Create: `src/engine/handlers/attack-handler.ts`
- Modify: `src/engine/action-registry.ts` (register attack action)
- Modify: `src/engine/option-service.ts` (add attack option for creatures)

**Interfaces:**
- Consumes: `ActionHandler` interface from `action-registry.ts`, `ActionValidator` from `action-validator.ts`
- Produces: `attackHandler: ActionHandler` registered as `'attack'` in `ActionRegistry`

- [ ] **Step 1: Write failing test for attack handler**

Create `tests/engine/attack-handler.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { attackHandler } from '../../src/engine/handlers/attack-handler';
import { registerAction } from '../../src/engine/action-registry';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';

describe('attackHandler', () => {
  let room: GameRoom;

  beforeEach(() => {
    room = createTestRoom();
    registerAction('attack', attackHandler);
    // Put a creature on the battlefield for player1
    const creature = instantiateCard('empire-servant');
    creature.state.zone = 'battlefield';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    creature.state.summoningSickness = false;
    room.battlefield.push(creature);
  });

  describe('validate', () => {
    it('should validate an untapped, non-sick creature', () => {
      const card = room.battlefield[0];
      const result = attackHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(result.success).toBe(true);
    });

    it('should reject a tapped creature', () => {
      const card = room.battlefield[0];
      card.state.isTapped = true;
      const result = attackHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(result.success).toBe(false);
    });

    it('should reject a summoning sick creature', () => {
      const card = room.battlefield[0];
      card.state.summoningSickness = true;
      const result = attackHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(result.success).toBe(false);
    });

    it('should reject when creature not on battlefield', () => {
      const result = attackHandler.validate(room, 'player1', { cardUuid: 'nonexistent' });
      expect(result.success).toBe(false);
    });

    it('should reject when not your turn', () => {
      room.activeTurnPlayerId = 'player2';
      const card = room.battlefield[0];
      const result = attackHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(result.success).toBe(false);
    });
  });

  describe('propose', () => {
    it('should tap creature and deal damage to opponent', () => {
      const card = room.battlefield[0];
      const initialLife = room.players['player2'].life;

      const result = attackHandler.propose(room, 'player1', { cardUuid: card.uuid });

      expect(result.success).toBe(true);
      expect(card.state.isTapped).toBe(true);
      expect(room.players['player2'].life).toBe(initialLife - (card.blueprint.power ?? 0));
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/attack-handler.test.ts`
Expected: FAIL — attackHandler not found

- [ ] **Step 3: Create attack-handler.ts**

Create `src/engine/handlers/attack-handler.ts`:
```typescript
import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { CardInstance } from '../../types/card.types';

function findCardOnBattlefield(room: GameRoom, playerId: PlayerId, cardUuid: string): CardInstance | undefined {
  return room.battlefield.find(c => c.uuid === cardUuid && c.state.controllerId === playerId);
}

export const attackHandler: ActionHandler = {
  validate(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    // Must be your turn
    if (room.activeTurnPlayerId !== playerId) {
      return { success: false, phase: 'validate', reason: 'Not your turn' };
    }

    const card = findCardOnBattlefield(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'validate', reason: 'Creature not found on your battlefield' };
    }

    // Must be a creature
    if (!card.blueprint.cardTypes.includes('Creature')) {
      return { success: false, phase: 'validate', reason: 'Only creatures can attack' };
    }

    // Must be untapped
    if (card.state.isTapped) {
      return { success: false, phase: 'validate', reason: 'Creature is already tapped' };
    }

    // Must not have summoning sickness
    if (card.state.summoningSickness) {
      return { success: false, phase: 'validate', reason: 'Creature has summoning sickness' };
    }

    return { success: true };
  },

  propose(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    const card = findCardOnBattlefield(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'propose', reason: 'Creature disappeared from battlefield' };
    }

    // Tap the creature
    card.state.isTapped = true;

    // Deal damage to opponent
    const opponentId = room.player1Id === playerId ? room.player2Id! : room.player1Id;
    const opponent = room.players[opponentId];
    const power = card.blueprint.power ?? 0;
    opponent.life -= power;

    return { success: true };
  },

  resolve(_room: GameRoom, _stackObj: any): ActionResult {
    return { success: true };
  },
};
```

- [ ] **Step 4: Register attack handler**

In `src/engine/action-registry.ts` or in a setup file, ensure the attack handler is registered. The simplest approach: add registration in the handler file itself or in a central registration. Since `playCardHandler` is registered in tests via `registerAction('cast_spell', playCardHandler)`, follow the same pattern.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/engine/attack-handler.test.ts`
Expected: All attack handler tests pass.

- [ ] **Step 6: Add attack option to OptionService**

In `src/engine/option-service.ts`, in `getBattlefieldOptions`, add an attack option for creatures:
```typescript
// Attack option (creatures only)
if (card.blueprint.cardTypes.includes('Creature')) {
  const canAttack = !card.state.isTapped && !card.state.summoningSickness
    && room.activeTurnPlayerId === playerId;
  options.push({
    actionId: 'attack',
    label: 'Attack',
    disabled: !canAttack,
    disabledReason: card.state.isTapped ? 'Already tapped'
      : card.state.summoningSickness ? 'Summoning sickness'
      : room.activeTurnPlayerId !== playerId ? 'Not your turn'
      : undefined,
  });
}
```

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/engine/handlers/attack-handler.ts src/engine/option-service.ts tests/engine/attack-handler.test.ts
git commit -m "feat: add direct attack action handler"
```

---

### Task 10: Wire Attack Handler in Server and GameEngine

**Files:**
- Modify: `src/server.ts` (register attack handler, handle executeCardAction for attack)
- Modify: `src/engine/game-engine.ts` (ensure handleAction routes to attack handler)

**Interfaces:**
- Consumes: `attackHandler` from `handlers/attack-handler.ts`, `ActionRegistry` from `action-registry.ts`
- Produces: Attack action fully wired — client can `executeCardAction` with `actionId: 'attack'`

- [ ] **Step 1: Register attack handler at server startup**

In `src/server.ts`, add import and registration:
```typescript
import { attackHandler } from './engine/handlers/attack-handler';
import { registerAction } from './engine/action-registry';

// Near other registrations
registerAction('attack', attackHandler);
```

- [ ] **Step 2: Ensure executeCardAction routes to engine.handleAction**

Check that the `executeCardAction` socket handler in `server.ts` calls `engine.handleAction()`. The `handleAction` method in `ActionService` already looks up `ActionRegistry[actionType]` — so if `attack` is registered, it will be found.

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat: wire attack handler in server"
```

---

### Task 11: Add stateDelta Handler to Client (game.js)

**Files:**
- Modify: `public/game.js` (add stateDelta listener)

**Interfaces:**
- Consumes: `stateDelta` socket event from `SyncService`
- Produces: Client updates life totals, card states from delta changes

- [ ] **Step 1: Add stateDelta handler to game.js**

Add to `public/game.js`:
```javascript
// Handle state delta updates from server
socket.on('stateDelta', (delta) => {
    console.log('State delta received:', delta);
    
    if (!delta.changes) return;
    
    for (const change of delta.changes) {
        // Update life totals
        if (change.path.includes('players.player1.life') || change.path.includes('players.player2.life')) {
            updateLifeDisplay(change);
        }
        
        // Update card tapped state
        if (change.path.includes('battlefield') && change.path.includes('isTapped')) {
            updateCardTappedVisual(change);
        }
        
        // Check for game over
        if (change.path.includes('winner')) {
            handleGameOver(change.value);
        }
    }
});

function updateLifeDisplay(change) {
    // Determine which player's life changed
    const isPlayer1 = change.path.includes('player1');
    const lifeValue = change.value ?? change.oldValue;
    
    if (isPlayer1) {
        document.getElementById('player-health').textContent = lifeValue;
    } else {
        document.getElementById('opponent-health').textContent = lifeValue;
    }
}

function updateCardTappedVisual(change) {
    // Extract UUID from path and update visual
    // Path format: battlefield.0.state.isTapped or similar
    const match = change.path.match(/battlefield\.\d+/);
    if (match) {
        // Find card element by index or UUID and add/remove tapped class
        console.log('Card tapped state changed:', change);
    }
}

function handleGameOver(winnerId) {
    if (winnerId) {
        const myId = socket.id;
        const message = winnerId === myId ? 'You Win!' : 'You Lose!';
        alert(message);
    }
}
```

- [ ] **Step 2: Verify client loads without errors**

Start the server and check browser console for errors.

- [ ] **Step 3: Commit**

```bash
git add public/game.js
git commit -m "feat: add stateDelta handler to client for life/card state updates"
```

---

### Task 12: Integration Test — Full Turn Play Loop

**Files:**
- Modify: `tests/engine/game-engine.test.ts` (add integration scenarios)

**Interfaces:**
- Consumes: `GameEngine`, `createTestRoom`, all registered action handlers
- Produces: Integration test covering mana → cast → attack → life loss

- [ ] **Step 1: Write integration test**

Add to `tests/engine/game-engine.test.ts`:
```typescript
describe('full turn play loop', () => {
  it('should play a land, tap for mana, cast a creature, and attack', () => {
    const room = createTestRoom();
    const engine = new GameEngine(room);
    engine.initRoom();

    // Register handlers
    registerAction('cast_spell', playCardHandler);
    registerAction('attack', attackHandler);

    // Setup: give player1 a land and a creature in hand
    const land = instantiateCard('land-red');
    land.state.zone = 'hand';
    land.state.ownerId = 'player1';
    land.state.controllerId = 'player1';
    room.players['player1'].hand.push(land);

    const creature = instantiateCard('empire-servant');
    creature.state.zone = 'hand';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    room.players['player1'].hand.push(creature);

    // 1. Play land (costs 0 mana)
    const landResult = engine.proposeAndStack('player1', 'cast_spell', { cardUuid: land.uuid });
    expect(landResult.success).toBe(true);
    engine.resolveTopOfStack();
    expect(room.battlefield.length).toBe(1);
    expect(room.battlefield[0].blueprint.id).toBe('land-red');

    // 2. Tap land for mana (via executeCardAction)
    // Land is on battlefield, untapped
    const landOnBoard = room.battlefield[0];
    landOnBoard.state.summoningSickness = false; // lands don't have sickness
    
    // Simulate tapping for mana via ADD_MANA effect
    const player = room.players['player1'];
    player.mana.red += 1;
    landOnBoard.state.isTapped = true;
    
    expect(player.mana.red).toBe(1);

    // 3. Cast creature (costs 1 red mana)
    const castResult = engine.proposeAndStack('player1', 'cast_spell', { cardUuid: creature.uuid });
    expect(castResult.success).toBe(true);
    expect(player.mana.red).toBe(0); // mana deducted
    
    engine.resolveTopOfStack();
    expect(room.battlefield.length).toBe(2);
    
    // Creature has summoning sickness
    const creatureOnBoard = room.battlefield.find(c => c.blueprint.id === 'empire-servant');
    expect(creatureOnBoard).toBeDefined();
    expect(creatureOnBoard!.state.summoningSickness).toBe(true);

    // 4. Cannot attack with summoning sickness
    const attackResult = engine.handleAction('player1', 'attack', { cardUuid: creatureOnBoard!.uuid });
    expect(attackResult.success).toBe(false);

    // 5. Next turn: untap, clear sickness
    engine.transition('stateTurnStart');
    expect(landOnBoard.state.isTapped).toBe(false);
    expect(creatureOnBoard!.state.summoningSickness).toBe(false);

    // 6. Now can attack
    const attackResult2 = engine.handleAction('player1', 'attack', { cardUuid: creatureOnBoard!.uuid });
    expect(attackResult2.success).toBe(true);
    expect(creatureOnBoard!.state.isTapped).toBe(true);
    expect(room.players['player2'].life).toBe(19); // 20 - 1 power
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `npx vitest run tests/engine/game-engine.test.ts`
Expected: Integration test passes.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/engine/game-engine.test.ts
git commit -m "test: add full turn play loop integration test"
```

---

### Task 13: Remove Legacy data/card_data.json

**Files:**
- Delete: `data/card_data.json`
- Modify: `src/library/card-factory.ts:2` (import path)

**Interfaces:**
- Consumes: `src/library/card_data.json` (canonical)
- Produces: Single source of truth for card data

- [ ] **Step 1: Verify card-factory imports from correct location**

Check `src/library/card-factory.ts` line 2:
```typescript
import rawCardData from '../../data/card_data.json';
```
Change to:
```typescript
import rawCardData from './card_data.json';
```

- [ ] **Step 2: Delete legacy file**

Delete `data/card_data.json`.

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: All tests pass with new import path.

- [ ] **Step 4: Commit**

```bash
git add src/library/card-factory.ts
git rm data/card_data.json
git commit -m "chore: remove legacy card_data.json, use src/library/ copy"
```

---

### Task 14: Final Verification — Full Test Suite + Manual Smoke Test

**Files:**
- No file changes — verification only

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```
Expected: All tests pass (120+ tests, 13+ test files).

- [ ] **Step 2: Check for TypeScript errors**

```bash
npx tsc --noEmit
```
Expected: No new TypeScript errors. (Pre-existing error in `effect-resolver.ts:63` about `TargetType` is known and not introduced by this work.)

- [ ] **Step 3: Manual smoke test**

Start the server:
```bash
npx tsx src/server.ts
```

Open two browser tabs to `http://localhost:3000`:
1. Tab 1: Create Room → copy room ID
2. Tab 2: Join Room with that ID
3. Both players should see RPS phase, choose cards
4. Winner goes first, draws cards
5. Play a land, tap for mana, cast a creature
6. Next turn, attack with creature
7. Verify life totals update

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final verification fixes"
```