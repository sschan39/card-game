# Resolve-Time Revalidation & Cost/Effect Zone Separation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three architectural gaps in the stack resolution pipeline: (1) re-validate targets at resolve time so the game doesn't resolve effects against illegal targets, (2) separate cost-driven zone changes (hand→stack) from effect-driven zone changes (stack→battlefield/graveyard) so the two are never conflated, and (3) distinguish snapshot values (locked at propose time) from dynamic values (calculated at resolve time) in StackEffect params.

**Architecture:** The orchestrator (`ActionService`/`GameEngine`) already owns structural zone changes via `applyStructuralZoneChange()`. This plan adds a `revalidateTargets()` step inside `resolveEffects()` that runs before each effect dispatches to `EffectRegistry`. Cost zone changes stay in `propose()` (hand→stack). Effect zone changes stay in `applyStructuralZoneChange()` (stack→battlefield/graveyard) and `EffectRegistry.MOVE_ZONE`. StackEffect gains an optional `dynamicParams` field for values computed at resolve time.

**Tech Stack:** TypeScript, vitest, uuid

## Global Constraints

- All new code in `src/` (TypeScript), no modifications to legacy JS files
- Test framework: vitest
- Test files in `tests/` directory mirroring `src/` structure
- TDD: write failing test first, then implementation
- Commit after each task
- ModifierPipeline and ModifierRegistry remain stubs (signatures updated only)
- All legacy JS files untouched
- Do NOT change the ActionRegistry 3-phase lifecycle (validate → propose → resolve)
- Do NOT change the EffectRegistry handler signature `(room, stackObj, effect) => void`

---

## File Structure

| File | Role |
|---|---|
| `src/types/effect.types.ts` | Add `dynamicParams` to `StackEffect`, add `TargetValidator` type |
| `src/engine/effect-resolver.ts` | Add `revalidateTargets()`, integrate into `resolveEffects()`, add `buildDynamicParams()` |
| `src/engine/handlers/play-card-handler.ts` | Clarify cost zone change (hand→stack) vs structural zone change (stack→battlefield) |
| `src/engine/effect-registry.ts` | No changes needed — primitives already receive locked targets |
| `src/engine/game-engine.ts` | No changes needed — already delegates to `resolveStackObject()` |
| `src/engine/action-service.ts` | No changes needed — already delegates to `resolveStackObject()` |
| `tests/engine/effect-resolver.test.ts` | Add revalidation tests, dynamic params tests |
| `tests/engine/play-card-handler.test.ts` | Add cost zone change assertion tests |

---

### Task 1: Add `dynamicParams` to StackEffect and `TargetValidator` type

**Files:**
- Modify: `src/types/effect.types.ts`

**Interfaces:**
- Produces: `StackEffect.dynamicParams?: Record<string, unknown>` — values computed at resolve time (e.g., `{ power: currentPower }`)
- Produces: `TargetValidator` type — `(room: GameRoom, target: TargetPointer, effect: StackEffect) => boolean`

- [ ] **Step 1: Write the type-level test (compile-time only — no runtime test needed for types)**

Types are verified by the TypeScript compiler. We'll confirm compilation in Step 3.

- [ ] **Step 2: Update `src/types/effect.types.ts` — add `dynamicParams` to `StackEffect` and add `TargetValidator`**

```ts
// In src/types/effect.types.ts, find the StackEffect interface and add dynamicParams:

export interface StackEffect {
  action: string;                    // primitive name, e.g. 'MODIFY_STATS'
  params: Record<string, unknown>;   // snapshot values locked at propose time
  dynamicParams?: Record<string, unknown>;  // values computed at resolve time (e.g., current power)
  tags: string[];                    // e.g. ['damage']
  targets: TargetPointer[];          // locked-in targets chosen at cast time
}

// Add after the StackEffect interface:

/**
 * Validates whether a target is still legal at resolve time.
 * Returns true if the target is still valid for the given effect.
 */
export type TargetValidator = (room: GameRoom, target: TargetPointer, effect: StackEffect) => boolean;
```

Note: `GameRoom` is imported from `../types/game.room.types` — add the import at the top of the file if not already present.

- [ ] **Step 3: Run TypeScript compiler to verify types**

Run: `npx tsc --noEmit`
Expected: No type errors related to `StackEffect` or `TargetValidator`.

- [ ] **Step 4: Commit**

```bash
git add src/types/effect.types.ts
git commit -m "feat: add dynamicParams to StackEffect and TargetValidator type"
```

---

### Task 2: Add `revalidateTargets()` function to effect-resolver

**Files:**
- Modify: `src/engine/effect-resolver.ts`
- Modify: `tests/engine/effect-resolver.test.ts`

**Interfaces:**
- Consumes: `StackEffect.dynamicParams`, `TargetValidator` from Task 1
- Produces: `revalidateTargets(room: GameRoom, effect: StackEffect): StackEffect` — filters out illegal targets, returns effect with only valid targets
- Produces: `buildDynamicParams(room: GameRoom, stackObj: StackObject, effect: StackEffect): Record<string, unknown>` — computes dynamic values at resolve time

- [ ] **Step 1: Write the failing test for `revalidateTargets`**

In `tests/engine/effect-resolver.test.ts`, add after the existing imports:

```typescript
import { revalidateTargets, buildDynamicParams } from '../../src/engine/effect-resolver';
```

Add these test blocks before the closing `});` of the `describe('resolveEffects', ...)` block (or as a new `describe` block at the end of the file):

```typescript
describe('revalidateTargets', () => {
  it('should keep valid targets that are still on the battlefield', () => {
    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.controllerId = 'player2';
    room.battlefield.push(card);

    const effect: StackEffect = {
      action: 'MODIFY_STATS',
      params: { damage: 3 },
      tags: ['damage'],
      targets: [{ targetType: 'permanent', cardUuid: card.uuid }],
    };

    const result = revalidateTargets(room, effect);
    expect(result.targets.length).toBe(1);
    expect(result.targets[0].cardUuid).toBe(card.uuid);
  });

  it('should remove targets that have left the battlefield', () => {
    const effect: StackEffect = {
      action: 'MODIFY_STATS',
      params: { damage: 3 },
      tags: ['damage'],
      targets: [{ targetType: 'permanent', cardUuid: 'nonexistent-uuid' }],
    };

    const result = revalidateTargets(room, effect);
    expect(result.targets.length).toBe(0);
  });

  it('should keep player targets that still exist', () => {
    const effect: StackEffect = {
      action: 'MODIFY_LIFE',
      params: { amount: -3 },
      tags: ['damage'],
      targets: [{ targetType: 'player', playerId: 'player2' }],
    };

    const result = revalidateTargets(room, effect);
    expect(result.targets.length).toBe(1);
  });

  it('should remove player targets for nonexistent players', () => {
    const effect: StackEffect = {
      action: 'MODIFY_LIFE',
      params: { amount: -3 },
      tags: ['damage'],
      targets: [{ targetType: 'player', playerId: 'nonexistent' }],
    };

    const result = revalidateTargets(room, effect);
    expect(result.targets.length).toBe(0);
  });

  it('should keep stack targets that are still on the stack', () => {
    const stackObj = {
      uuid: 'stack-uuid-1',
      type: 'spell' as const,
      controllerId: 'player2',
      source: {} as any,
      effects: [],
      countered: false,
    };
    room.stack.push(stackObj);

    const effect: StackEffect = {
      action: 'MOVE_ZONE',
      params: { origin: 'stack', destination: 'graveyard' },
      tags: ['counter'],
      targets: [{ targetType: 'stack', stackUuid: 'stack-uuid-1' }],
    };

    const result = revalidateTargets(room, effect);
    expect(result.targets.length).toBe(1);
  });

  it('should remove stack targets that have already resolved', () => {
    const effect: StackEffect = {
      action: 'MOVE_ZONE',
      params: { origin: 'stack', destination: 'graveyard' },
      tags: ['counter'],
      targets: [{ targetType: 'stack', stackUuid: 'already-resolved-uuid' }],
    };

    const result = revalidateTargets(room, effect);
    expect(result.targets.length).toBe(0);
  });
});

describe('buildDynamicParams', () => {
  it('should compute current power for a creature on the battlefield', () => {
    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.controllerId = 'player1';
    card.power = 1;
    room.battlefield.push(card);

    const effect: StackEffect = {
      action: 'MODIFY_STATS',
      params: { power: 'DYNAMIC:source.power' },
      tags: [],
      targets: [{ targetType: 'permanent', cardUuid: card.uuid }],
    };

    const stackObj = {
      uuid: 'test-uuid',
      type: 'spell' as const,
      controllerId: 'player1',
      source: card,
      effects: [effect],
      countered: false,
    };

    const dynamic = buildDynamicParams(room, stackObj, effect);
    expect(dynamic.power).toBe(1);
  });

  it('should return empty object when no dynamic markers present', () => {
    const effect: StackEffect = {
      action: 'DRAW',
      params: { amount: 1 },
      tags: [],
      targets: [],
    };

    const stackObj = {
      uuid: 'test-uuid',
      type: 'spell' as const,
      controllerId: 'player1',
      source: {} as any,
      effects: [effect],
      countered: false,
    };

    const dynamic = buildDynamicParams(room, stackObj, effect);
    expect(dynamic).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/effect-resolver.test.ts`
Expected: FAIL — `revalidateTargets is not a function` / `buildDynamicParams is not a function`

- [ ] **Step 3: Implement `revalidateTargets` and `buildDynamicParams` in `src/engine/effect-resolver.ts`**

Add these functions after the existing `buildStackEffects` function and before `isPermanent`:

```typescript
/**
 * Re-validate targets at resolve time. Filters out targets that are no longer
 * legal (e.g., a creature that was bounced back to hand after the spell was cast).
 *
 * Validation rules:
 * - 'permanent' / 'card' targets: must exist on the battlefield (by cardUuid)
 * - 'player' targets: must exist in room.players
 * - 'stack' targets: must still be on the stack (by stackUuid)
 * - 'self' targets: always valid (controller always exists)
 *
 * Returns a new StackEffect with only the valid targets. If all targets are
 * removed and the effect required targets, the effect is marked with an empty
 * targets array — the EffectRegistry handler will simply do nothing.
 */
export function revalidateTargets(room: GameRoom, effect: StackEffect): StackEffect {
  const validTargets = effect.targets.filter(target => {
    switch (target.targetType) {
      case 'permanent':
      case 'card': {
        if (!target.cardUuid) return false;
        return room.battlefield.some(c => c.uuid === target.cardUuid);
      }
      case 'player': {
        if (!target.playerId) return false;
        return target.playerId in room.players;
      }
      case 'stack': {
        if (!target.stackUuid) return false;
        return room.stack.some(s => s.uuid === target.stackUuid);
      }
      case 'self': {
        // Self always resolves to the controller — always valid
        return true;
      }
      default:
        return false;
    }
  });

  return {
    ...effect,
    targets: validTargets,
  };
}

/**
 * Compute dynamic parameter values at resolve time.
 *
 * Dynamic markers in params are strings prefixed with 'DYNAMIC:':
 * - 'DYNAMIC:source.power' → stackObj.source.power (current power at resolve time)
 * - 'DYNAMIC:source.toughness' → stackObj.source.toughness
 * - 'DYNAMIC:target.power' → first target's current power
 *
 * Non-dynamic params are left as-is. The result is merged into effect.dynamicParams
 * so EffectRegistry handlers can use `effect.dynamicParams?.power ?? effect.params.power`.
 */
export function buildDynamicParams(
  room: GameRoom,
  stackObj: StackObject,
  effect: StackEffect
): Record<string, unknown> {
  const dynamic: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(effect.params)) {
    if (typeof value !== 'string' || !value.startsWith('DYNAMIC:')) continue;

    const path = value.slice('DYNAMIC:'.length);

    if (path === 'source.power') {
      dynamic[key] = (stackObj.source as any)?.power;
    } else if (path === 'source.toughness') {
      dynamic[key] = (stackObj.source as any)?.toughness;
    } else if (path === 'target.power') {
      const firstTarget = effect.targets[0];
      if (firstTarget?.cardUuid) {
        const card = room.battlefield.find(c => c.uuid === firstTarget.cardUuid);
        dynamic[key] = card?.power;
      }
    } else if (path === 'target.toughness') {
      const firstTarget = effect.targets[0];
      if (firstTarget?.cardUuid) {
        const card = room.battlefield.find(c => c.uuid === firstTarget.cardUuid);
        dynamic[key] = card?.toughness;
      }
    }
  }

  return dynamic;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/effect-resolver.test.ts`
Expected: All tests PASS (existing + new revalidateTargets and buildDynamicParams tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine/effect-resolver.ts tests/engine/effect-resolver.test.ts
git commit -m "feat: add revalidateTargets and buildDynamicParams to effect-resolver"
```

---

### Task 3: Integrate revalidation into `resolveEffects()`

**Files:**
- Modify: `src/engine/effect-resolver.ts`
- Modify: `tests/engine/effect-resolver.test.ts`

**Interfaces:**
- Consumes: `revalidateTargets()`, `buildDynamicParams()` from Task 2
- Modifies: `resolveEffects()` — calls `revalidateTargets()` and `buildDynamicParams()` before dispatching each effect

- [ ] **Step 1: Write the failing test for revalidation during resolution**

In `tests/engine/effect-resolver.test.ts`, add this test inside the existing `describe('resolveEffects', ...)` block:

```typescript
  it('should skip effects whose targets are no longer valid at resolve time', () => {
    // Set up: a creature on battlefield that we'll target
    const targetCard = instantiateCard('empire-servant');
    targetCard.state.zone = 'battlefield';
    targetCard.state.controllerId = 'player2';
    targetCard.state.damageTaken = 0;
    room.battlefield.push(targetCard);

    const effect: StackEffect = {
      action: 'MODIFY_STATS',
      params: { damage: 3 },
      tags: ['damage'],
      targets: [{ targetType: 'permanent', cardUuid: targetCard.uuid }],
    };

    const stackObj = makeStackObj(room, [effect]);

    // Remove the target from battlefield BEFORE resolution (simulating bounce/removal)
    room.battlefield = [];

    // Should not throw — revalidation removes the illegal target
    resolveEffects(room, stackObj, eventBus);

    // Target was removed, so damage should NOT have been applied
    expect(targetCard.state.damageTaken).toBe(0);
  });

  it('should apply dynamicParams at resolve time', () => {
    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.controllerId = 'player1';
    card.power = 1;
    room.battlefield.push(card);

    // Effect that deals damage equal to source's current power
    const effect: StackEffect = {
      action: 'MODIFY_STATS',
      params: { damage: 'DYNAMIC:source.power' },
      tags: ['damage'],
      targets: [{ targetType: 'permanent', cardUuid: card.uuid }],
    };

    const stackObj = makeStackObj(room, [effect]);
    // Override source to be the card itself
    (stackObj as any).source = card;

    // Before: no damage
    expect(card.state.damageTaken).toBe(0);

    resolveEffects(room, stackObj, eventBus);

    // After: damage = source.power = 1
    expect(card.state.damageTaken).toBe(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/effect-resolver.test.ts -- -t "should skip effects whose targets are no longer valid"`
Expected: FAIL — damage is still applied because revalidation isn't called yet

- [ ] **Step 3: Update `resolveEffects()` in `src/engine/effect-resolver.ts`**

Replace the existing `resolveEffects` function:

```typescript
/**
 * Resolve all effects on a StackObject by dispatching each to the EffectRegistry.
 * Before each effect resolves:
 * 1. Targets are re-validated (illegal targets removed)
 * 2. Dynamic params are computed (values that change between propose and resolve)
 *
 * Skips resolution entirely if the stack object is countered.
 * Emits STACK_ITEM_RESOLVED after each effect.
 */
export function resolveEffects(room: GameRoom, stackObj: StackObject, eventBus: EventBus): void {
  if (stackObj.countered) return;

  for (const effect of stackObj.effects) {
    // 1. Re-validate targets at resolve time
    const validatedEffect = revalidateTargets(room, effect);

    // 2. Compute dynamic params (values that may have changed since propose)
    const dynamicParams = buildDynamicParams(room, stackObj, validatedEffect);
    if (Object.keys(dynamicParams).length > 0) {
      validatedEffect.dynamicParams = dynamicParams;
    }

    // 3. Run through modifier pipeline
    ModifierPipeline.apply(validatedEffect, room, stackObj);

    // 4. Dispatch to EffectRegistry (handler does nothing if targets is empty)
    const handler = EffectRegistry[validatedEffect.action];
    if (handler) {
      handler(room, stackObj, validatedEffect);
    }

    eventBus.emit({
      eventId: 'STACK_ITEM_RESOLVED',
      roomId: room.roomId,
      payload: { effectId: validatedEffect.action, stackObj },
    });
  }
}
```

- [ ] **Step 4: Run all effect-resolver tests to verify they pass**

Run: `npx vitest run tests/engine/effect-resolver.test.ts`
Expected: ALL tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/effect-resolver.ts tests/engine/effect-resolver.test.ts
git commit -m "feat: integrate target revalidation and dynamic params into resolveEffects"
```

---

### Task 4: Clarify cost zone change vs structural zone change in play-card-handler

**Files:**
- Modify: `src/engine/handlers/play-card-handler.ts`
- Modify: `tests/engine/play-card-handler.test.ts`

**Interfaces:**
- Consumes: `resolveStackObject()` from `effect-resolver` (already imported)
- Produces: Clear documentation of which zone change happens where

- [ ] **Step 1: Write the test asserting cost zone change (hand→stack) is in propose, NOT in resolve**

In `tests/engine/play-card-handler.test.ts`, add this test inside the `describe('propose', ...)` block:

```typescript
    it('should move card from hand to stack (cost zone change) during propose', () => {
      const card = room.players['player1'].hand[0];
      expect(card.state.zone).toBe('hand');

      const result = playCardHandler.propose(room, 'player1', { cardUuid: card.uuid });
      expect(result.success).toBe(true);

      // Cost zone change: hand → stack (done by propose)
      expect(card.state.zone).toBe('stack');
      // Card is NOT on battlefield yet — that's the structural zone change (done by orchestrator)
      expect(room.battlefield.find(c => c.uuid === card.uuid)).toBeUndefined();
    });
```

- [ ] **Step 2: Run test to verify it passes (this is documenting existing behavior)**

Run: `npx vitest run tests/engine/play-card-handler.test.ts -- -t "should move card from hand to stack"`
Expected: PASS (this is already the current behavior — we're just adding an explicit test for it)

- [ ] **Step 3: Add documentation comments to `play-card-handler.ts`**

In `src/engine/handlers/play-card-handler.ts`, update the `propose` method's JSDoc comment and add inline comments clarifying zone change responsibility:

Replace the `propose` method signature area:

```typescript
  /**
   * Propose playing a card: pay costs and push to stack.
   *
   * Zone changes performed here (COST zone changes):
   * - Card moves from hand → stack (this is a cost, not an effect)
   *
   * Zone changes NOT performed here (EFFECT/STRUCTURAL zone changes):
   * - stack → battlefield (permanents) — done by applyStructuralZoneChange() in the orchestrator
   * - stack → graveyard (non-permanents) — done by applyStructuralZoneChange() in the orchestrator
   * - Any MOVE_ZONE effects — done by EffectRegistry during resolveEffects()
   *
   * This separation ensures cost zone changes cannot be countered or modified,
   * while effect zone changes go through the full pipeline (modifiers, revalidation).
   */
  propose(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    const card = findCardInHand(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'propose', reason: 'Card not found in hand' };
    }

    const player = room.players[playerId];

    // --- COST PAYMENT (happens now, cannot be responded to) ---
    const cost = card.castRequirements.cost;
    if (cost?.mana) {
      for (const [color, amount] of Object.entries(cost.mana)) {
        player.mana[color as keyof typeof player.mana] -= amount;
      }
    }
    if (cost?.life) {
      player.life -= cost.life;
    }

    // --- COST ZONE CHANGE: hand → stack ---
    // This is a cost, not an effect. It happens immediately and cannot be
    // countered or modified. The card is now "on the stack" waiting to resolve.
    const handIndex = player.hand.findIndex(c => c.uuid === card.uuid);
    if (handIndex === -1) {
      return { success: false, phase: 'propose', reason: 'Card disappeared from hand' };
    }
    player.hand.splice(handIndex, 1);
    card.state.zone = 'stack';

    // --- BUILD STACK OBJECT (snapshot values locked here) ---
    const onCastEffects = card.onCastEffects;
    const effects = buildStackEffects(onCastEffects, playerId);

    const stackType: StackItemType = 'spell';

    const stackObj: StackObject = {
      uuid: uuidv4(),
      type: stackType,
      controllerId: playerId,
      source: card,              // Card lives inside the StackObject while on stack
      effects,                   // Effects with targets locked at propose time
      timestamp: Date.now(),
      countered: false,
    };

    room.stack.push(stackObj);

    return { success: true, stackObject: stackObj };
  },
```

- [ ] **Step 4: Run all play-card-handler tests**

Run: `npx vitest run tests/engine/play-card-handler.test.ts`
Expected: ALL tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/handlers/play-card-handler.ts tests/engine/play-card-handler.test.ts
git commit -m "docs: clarify cost zone change vs structural zone change in play-card-handler"
```

---

### Task 5: End-to-end integration test — full propose→resolve with revalidation

**Files:**
- Modify: `tests/engine/game-engine.test.ts`

**Interfaces:**
- Consumes: All previous tasks
- Produces: Integration test proving the full pipeline works end-to-end

- [ ] **Step 1: Write the integration test**

In `tests/engine/game-engine.test.ts`, add this test inside the `describe('resolveTopOfStack', ...)` block:

```typescript
    it('should revalidate targets at resolve time (target removed before resolution)', () => {
      // First, put a creature on opponent's battlefield as a target
      const { instantiateCard } = require('../../src/library/card-factory');
      const targetCard = instantiateCard('empire-servant');
      targetCard.state.zone = 'battlefield';
      targetCard.state.controllerId = 'player2';
      targetCard.state.ownerId = 'player2';
      targetCard.state.damageTaken = 0;
      room.battlefield.push(targetCard);

      // Give player1 a card with a damage effect targeting that creature
      const card = room.players['player1'].hand[0];
      card.onCastEffects = [
        {
          action: 'MODIFY_STATS',
          params: { damage: 3 },
          tags: ['damage'],
          targeting: { type: 'permanent', required: true, minTargets: 1, maxTargets: 1 },
        },
      ];

      // Propose with the target
      const proposeResult = engine.handleAction(room, 'player1', 'cast_spell', {
        cardUuid: card.uuid,
        targets: [{ targetType: 'permanent', cardUuid: targetCard.uuid }],
      });
      expect(proposeResult.success).toBe(true);

      // BEFORE resolution: remove the target from battlefield (simulate opponent's bounce spell)
      room.battlefield = [];

      // Resolve — should NOT crash and should NOT deal damage to the missing target
      const resolveResult = engine.resolveTopOfStack(room);
      expect(resolveResult.success).toBe(true);

      // Target was removed before resolution, so no damage should be applied
      expect(targetCard.state.damageTaken).toBe(0);
    });
```

- [ ] **Step 2: Run the integration test**

Run: `npx vitest run tests/engine/game-engine.test.ts -- -t "should revalidate targets"`
Expected: PASS — the engine handles missing targets gracefully

- [ ] **Step 3: Run ALL tests to confirm no regressions**

Run: `npx vitest run`
Expected: ALL tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/engine/game-engine.test.ts
git commit -m "test: add integration test for resolve-time target revalidation"
```

---

## Self-Review

### 1. Spec Coverage

| Requirement | Task |
|---|---|
| Re-validate targets at resolve time (Double Validation Trap) | Task 2 (revalidateTargets), Task 3 (integration into resolveEffects) |
| Distinguish cost zone changes vs effect zone changes | Task 4 (documentation + test in play-card-handler) |
| State snapshots vs dynamic calculations | Task 1 (dynamicParams type), Task 2 (buildDynamicParams), Task 3 (integration) |
| ActionRegistry handlers: validate inputs, pay costs, construct/push StackObject | Already implemented; Task 4 clarifies the boundary |
| EffectRegistry: perform concrete state mutations | Already implemented; no changes needed |
| Orchestrator: owns structural rules, calls resolver, emits events | Already implemented; no changes needed |
| ModifierPipeline: transforms StackEffect before dispatch | Already called in resolveEffects; Task 3 preserves this |

### 2. Placeholder Scan

No TBDs, TODOs, "implement later", or "add appropriate error handling" patterns found. All steps have concrete code.

### 3. Type Consistency

- `StackEffect.dynamicParams` defined in Task 1, used in Task 2 (`buildDynamicParams`), Task 3 (`resolveEffects`)
- `revalidateTargets(room, effect) => StackEffect` defined in Task 2, called in Task 3
- `buildDynamicParams(room, stackObj, effect) => Record<string, unknown>` defined in Task 2, called in Task 3
- `TargetValidator` type defined in Task 1, available for future use
- All function signatures consistent across tasks

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-14-resolve-revalidation-and-cost-zone-separation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**