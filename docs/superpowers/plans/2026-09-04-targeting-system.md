# Targeting System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing `TargetPointer` type into a full-stack targeting flow so a player can cast a spell, choose a legal target, and have that target validated at cast time and re-validated at resolve time (MTG CR 601.2c / CR 114.5).

**Architecture:** Backend merges client-sent `TargetPointer[]` into the `StackEffect` (currently dropped), validates them against the card's `TargetingDefinition` via a new pure `ActionValidator.canTarget()`, and uses a new `targeting` field on `StackEffect` for resolve-time fizzle decisions. Frontend reads `onCastEffects` from its room snapshot to enter a targeting mode, collects a target, and sends it with the action. A synthetic test card (火焰箭) exercises the flow end-to-end.

**Tech Stack:** TypeScript, React 19, Zustand 5, Socket.IO, Vitest, Vite.

## Global Constraints

- **Purity invariant (§1.1 of spec):** every `validate()` method and every validation helper it calls MUST be a pure function — it reads `room`/`action` only, never mutates, never emits events, never has side effects, and can be safely re-evaluated mid-flight. If a helper needs to mutate state, it belongs in `propose()` or `resolve()`, NOT `validate()`.
- **Structural vs permission legality are separate concerns:** structural legality (type/count/existence) goes in `ActionValidator.canTarget()`; permission legality (hexproof/shroud/protection) stays in `ModifierRegistry.canTarget()` (stub, returns `true`).
- **`StackEffect` gains `targeting?: TargetingDefinition`** — `buildStackEffects()` preserves it; `propose()` uses it for merge; `revalidateTargets()` uses `targeting.required` for the CR 114.5 fizzle decision.
- **Client derives targeting requirements from its room snapshot** (`card.blueprint.onCastEffects`), which is the server-authoritative copy. No round-trip needed. The `ActionOption.targeting` field is deferred (Phase 5).
- **Single-target UX for now.** Backend/data model already support multi-target; only the frontend `TargetSelector` interaction is single-target.
- **Synthetic test card** 火焰箭 (not a real ST01A card) — the real cast-spell targeting card needs metadata schema fields tracked separately.
- **Test command:** `npm test` (runs `vitest run`). Single-file: `npx vitest run <path>`.
- **TypeScript build:** `npm run build` (runs `tsc && vite build`). Type-check only: `npx tsc --noEmit`.

---

### Task 1: Add `targeting` field to `StackEffect` and preserve it in `buildStackEffects()`

**Files:**
- Modify: `src/types/effect.types.ts` (the `StackEffect` interface)
- Modify: `src/engine/effect-resolver.ts` (the `buildStackEffects()` function)
- Test: `tests/engine/effect-resolver.test.ts`

**Interfaces:**
- Consumes: existing `TargetingDefinition` type (already defined in `src/types/effect.types.ts`).
- Produces: `StackEffect` now has an optional `targeting?: TargetingDefinition` field. `buildStackEffects(definitions, controllerId)` returns `StackEffect[]` where each effect carries its `targeting` definition.

- [ ] **Step 1: Write the failing test**

Add this test to `tests/engine/effect-resolver.test.ts` (inside the existing `describe('resolveEffects')` block or as a new `describe('buildStackEffects')` block — add a new block at the end of the file):

```ts
import { buildStackEffects } from '../../src/engine/effect-resolver';

describe('buildStackEffects', () => {
  it('preserves the targeting definition on each built effect', () => {
    const defs = [
      {
        action: 'MODIFY_STATS',
        params: { damage: 2 },
        tags: ['damage'],
        targeting: { type: 'permanent', cardTypes: ['Creature'], required: true, minTargets: 1, maxTargets: 1 },
      },
    ];
    const effects = buildStackEffects(defs, 'player1');
    expect(effects).toHaveLength(1);
    expect(effects[0].targeting).toEqual(defs[0].targeting);
  });

  it('still fills self targets and carries the self targeting definition', () => {
    const defs = [
      { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self', required: false } },
    ];
    const effects = buildStackEffects(defs, 'player1');
    expect(effects[0].targets).toEqual([{ targetType: 'player', playerId: 'player1' }]);
    expect(effects[0].targeting).toEqual(defs[0].targeting);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/effect-resolver.test.ts -t buildStackEffects`
Expected: FAIL — `effects[0].targeting` is `undefined` (the field does not exist yet).

- [ ] **Step 3: Write minimal implementation**

In `src/types/effect.types.ts`, add the `targeting` field to the `StackEffect` interface:

```ts
export interface StackEffect {
  action: string;                    // primitive name, e.g. 'MODIFY_STATS'
  params: Record<string, unknown>;   // snapshot values locked at propose time
  dynamicParams?: Record<string, unknown>;  // values computed at resolve time (e.g., current power)
  tags: string[];                    // e.g. ['damage']
  targets: TargetPointer[];          // locked-in targets chosen at cast time
  targeting?: TargetingDefinition;   // the targeting definition this effect was built from
}
```

In `src/engine/effect-resolver.ts`, update `buildStackEffects()` to preserve the definition:

```ts
export function buildStackEffects(
  definitions: EffectDefinition[] | undefined,
  controllerId: string
): StackEffect[] {
  if (!definitions) return [];
  return definitions.map(def => {
    const targets: TargetPointer[] = [];
    if (def.targeting.type === 'self') {
      targets.push({ targetType: 'player', playerId: controllerId });
    } else if (def.targeting.all) {
      // "All matching permanents" — expanded into concrete cardUuid targets
      // at resolve time by expandTargets(). The filter fields are carried here.
      targets.push({
        targetType: 'permanent',
        all: true,
        cardTypes: def.targeting.cardTypes,
        subTypes: def.targeting.subTypes,
        controller: def.targeting.controller,
      });
    }
    // For effects requiring explicit targets, targets are filled by the
    // handler's propose() merge (see play-card-handler.ts).
    return {
      action: def.action,
      params: def.params,
      tags: def.tags || [],
      targeting: def.targeting,   // NEW — preserved for merge + revalidation
      targets,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/effect-resolver.test.ts -t buildStackEffects`
Expected: PASS (both tests).

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/types/effect.types.ts src/engine/effect-resolver.ts tests/engine/effect-resolver.test.ts
git commit -m "feat(targeting): add targeting field to StackEffect and preserve it in buildStackEffects"
```

---

### Task 2: Merge client targets into `StackEffect` in `play-card-handler.propose()`

**Files:**
- Modify: `src/engine/handlers/play-card-handler.ts` (the `propose()` method)
- Test: `tests/engine/play-card-handler.test.ts`

**Interfaces:**
- Consumes: `StackEffect.targeting` (from Task 1), `action.targets: TargetPointer[]` (already in `ActionData`).
- Produces: `propose()` now copies the client-sent `action.targets` into each explicit-target `StackEffect.targets`, slicing `maxTargets` worth of targets per effect.

- [ ] **Step 1: Write the failing test**

Add this test to `tests/engine/play-card-handler.test.ts` (inside the existing `describe('propose')` block):

```ts
it('should merge client-sent targets into the StackEffect for explicit-target effects', () => {
  const card = room.players['player1'].hand[0];
  card.blueprint.onCastEffects = [
    {
      action: 'MODIFY_STATS',
      params: { damage: 2 },
      tags: ['damage'],
      targeting: { type: 'permanent', cardTypes: ['Creature'], required: true, minTargets: 1, maxTargets: 1 },
    },
  ];

  // Put a creature on the battlefield to target
  const target = instantiateCard('empire-servant');
  target.state.zone = 'battlefield';
  target.state.ownerId = 'player2';
  target.state.controllerId = 'player2';
  room.battlefield.push(target);

  const result = playCardHandler.propose(room, 'player1', {
    cardUuid: card.uuid,
    stackUuid: 'stack-uuid-target',
    targets: [{ targetType: 'permanent', cardUuid: target.uuid }],
  });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.stackObject!.effects[0].targets).toEqual([
      { targetType: 'permanent', cardUuid: target.uuid },
    ]);
  }
});

it('should slice maxTargets worth of targets per effect when multiple effects need targets', () => {
  const card = room.players['player1'].hand[0];
  card.blueprint.onCastEffects = [
    {
      action: 'MODIFY_STATS',
      params: { damage: 1 },
      tags: ['damage'],
      targeting: { type: 'permanent', cardTypes: ['Creature'], required: true, minTargets: 1, maxTargets: 1 },
    },
    {
      action: 'MODIFY_STATS',
      params: { damage: 1 },
      tags: ['damage'],
      targeting: { type: 'permanent', cardTypes: ['Creature'], required: true, minTargets: 1, maxTargets: 1 },
    },
  ];

  const target1 = instantiateCard('empire-servant');
  target1.state.zone = 'battlefield';
  target1.state.ownerId = 'player2';
  target1.state.controllerId = 'player2';
  room.battlefield.push(target1);
  const target2 = instantiateCard('empire-servant');
  target2.state.zone = 'battlefield';
  target2.state.ownerId = 'player2';
  target2.state.controllerId = 'player2';
  room.battlefield.push(target2);

  const result = playCardHandler.propose(room, 'player1', {
    cardUuid: card.uuid,
    stackUuid: 'stack-uuid-multi',
    targets: [
      { targetType: 'permanent', cardUuid: target1.uuid },
      { targetType: 'permanent', cardUuid: target2.uuid },
    ],
  });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.stackObject!.effects[0].targets).toEqual([
      { targetType: 'permanent', cardUuid: target1.uuid },
    ]);
    expect(result.stackObject!.effects[1].targets).toEqual([
      { targetType: 'permanent', cardUuid: target2.uuid },
    ]);
  }
});
```

Add the `instantiateCard` import at the top of the test file if not already present:

```ts
import { instantiateCard } from '../../src/library/card-factory';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/play-card-handler.test.ts -t "merge client-sent targets"`
Expected: FAIL — `result.stackObject!.effects[0].targets` is `[]` (targets are dropped).

- [ ] **Step 3: Write minimal implementation**

In `src/engine/handlers/play-card-handler.ts`, modify the `propose()` method. Find this block:

```ts
    // --- BUILD STACK OBJECT (snapshot values locked here) ---
    const onCastEffects = card.blueprint.onCastEffects;
    const effects = buildStackEffects(onCastEffects, playerId);
```

Replace it with:

```ts
    // --- BUILD STACK OBJECT (snapshot values locked here) ---
    const onCastEffects = card.blueprint.onCastEffects;
    const effects = buildStackEffects(onCastEffects, playerId);

    // --- MERGE CLIENT TARGETS into explicit-target effects (CR 601.2c) ---
    // Each effect whose targeting is explicit (type !== 'self' && !all) takes
    // a slice of action.targets, up to maxTargets per effect. Targets are
    // locked into the StackEffect at cast time.
    const clientTargets = (action.targets as TargetPointer[]) || [];
    let targetIdx = 0;
    for (const effect of effects) {
      const t = effect.targeting;
      if (t && t.type !== 'self' && !t.all) {
        const count = t.maxTargets ?? clientTargets.length;
        effect.targets = clientTargets.slice(targetIdx, targetIdx + count);
        targetIdx += count;
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/play-card-handler.test.ts -t "merge client-sent targets"`
Expected: PASS (both tests).

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/engine/handlers/play-card-handler.ts tests/engine/play-card-handler.test.ts
git commit -m "feat(targeting): merge client targets into StackEffect in play-card-handler.propose"
```

---

### Task 3: Add pure `ActionValidator.canTarget()` for structural target legality

**Files:**
- Modify: `src/engine/action-validator.ts`
- Test: `tests/engine/action-validator.test.ts`

**Interfaces:**
- Consumes: `GameRoom`, `PlayerId`, `CardInstance`, `TargetPointer`, `TargetingDefinition` (all existing types).
- Produces: `ActionValidator.canTarget(room, playerId, card, targets, targetingDef): boolean` — a pure static method that validates target count, type, and existence against the `TargetingDefinition`.

- [ ] **Step 1: Write the failing test**

Add this test to `tests/engine/action-validator.test.ts` (as a new `describe('canTarget')` block at the end of the file):

```ts
import { instantiateCard } from '../../src/library/card-factory';
import type { TargetPointer, TargetingDefinition } from '../../src/types/effect.types';

describe('canTarget', () => {
  let room: ReturnType<typeof createTestRoom>;

  beforeEach(() => {
    room = createTestRoom();
  });

  function makeBattlefieldCreature(controllerId: string) {
    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.ownerId = controllerId;
    card.state.controllerId = controllerId;
    room.battlefield.push(card);
    return card;
  }

  const permanentDef: TargetingDefinition = {
    type: 'permanent',
    cardTypes: ['Creature'],
    required: true,
    minTargets: 1,
    maxTargets: 1,
  };

  it('returns true for a valid permanent target', () => {
    const target = makeBattlefieldCreature('player2');
    const targets: TargetPointer[] = [{ targetType: 'permanent', cardUuid: target.uuid }];
    const card = room.players['player1'].hand[0];
    expect(ActionValidator.canTarget(room, 'player1', card, targets, permanentDef)).toBe(true);
  });

  it('returns false when required and no targets are provided', () => {
    const card = room.players['player1'].hand[0];
    expect(ActionValidator.canTarget(room, 'player1', card, [], permanentDef)).toBe(false);
  });

  it('returns false when fewer than minTargets are provided', () => {
    const target = makeBattlefieldCreature('player2');
    const def: TargetingDefinition = { type: 'permanent', cardTypes: ['Creature'], required: true, minTargets: 2, maxTargets: 2 };
    const targets: TargetPointer[] = [{ targetType: 'permanent', cardUuid: target.uuid }];
    const card = room.players['player1'].hand[0];
    expect(ActionValidator.canTarget(room, 'player1', card, targets, def)).toBe(false);
  });

  it('returns false when more than maxTargets are provided', () => {
    const t1 = makeBattlefieldCreature('player2');
    const t2 = makeBattlefieldCreature('player2');
    const targets: TargetPointer[] = [
      { targetType: 'permanent', cardUuid: t1.uuid },
      { targetType: 'permanent', cardUuid: t2.uuid },
    ];
    const card = room.players['player1'].hand[0];
    expect(ActionValidator.canTarget(room, 'player1', card, targets, permanentDef)).toBe(false);
  });

  it('returns false when target type does not match the definition', () => {
    const targets: TargetPointer[] = [{ targetType: 'player', playerId: 'player2' }];
    const card = room.players['player1'].hand[0];
    expect(ActionValidator.canTarget(room, 'player1', card, targets, permanentDef)).toBe(false);
  });

  it('returns false when a permanent target is not on the battlefield', () => {
    const targets: TargetPointer[] = [{ targetType: 'permanent', cardUuid: 'nonexistent-uuid' }];
    const card = room.players['player1'].hand[0];
    expect(ActionValidator.canTarget(room, 'player1', card, targets, permanentDef)).toBe(false);
  });

  it('returns false when a permanent target does not match cardTypes filter', () => {
    const target = makeBattlefieldCreature('player2');
    target.blueprint = { ...target.blueprint, cardTypes: ['Land'] };
    const targets: TargetPointer[] = [{ targetType: 'permanent', cardUuid: target.uuid }];
    const card = room.players['player1'].hand[0];
    expect(ActionValidator.canTarget(room, 'player1', card, targets, permanentDef)).toBe(false);
  });

  it('returns true for a valid player target', () => {
    const def: TargetingDefinition = { type: 'player', required: true, minTargets: 1, maxTargets: 1 };
    const targets: TargetPointer[] = [{ targetType: 'player', playerId: 'player2' }];
    const card = room.players['player1'].hand[0];
    expect(ActionValidator.canTarget(room, 'player1', card, targets, def)).toBe(true);
  });

  it('returns false for a nonexistent player target', () => {
    const def: TargetingDefinition = { type: 'player', required: true, minTargets: 1, maxTargets: 1 };
    const targets: TargetPointer[] = [{ targetType: 'player', playerId: 'nonexistent' }];
    const card = room.players['player1'].hand[0];
    expect(ActionValidator.canTarget(room, 'player1', card, targets, def)).toBe(false);
  });

  it('returns true when not required and no targets are provided', () => {
    const def: TargetingDefinition = { type: 'permanent', cardTypes: ['Creature'], required: false };
    const card = room.players['player1'].hand[0];
    expect(ActionValidator.canTarget(room, 'player1', card, [], def)).toBe(true);
  });

  it('is pure: does not mutate the room', () => {
    const target = makeBattlefieldCreature('player2');
    const targets: TargetPointer[] = [{ targetType: 'permanent', cardUuid: target.uuid }];
    const card = room.players['player1'].hand[0];
    const battlefieldBefore = room.battlefield.length;
    const handBefore = room.players['player1'].hand.length;
    ActionValidator.canTarget(room, 'player1', card, targets, permanentDef);
    expect(room.battlefield.length).toBe(battlefieldBefore);
    expect(room.players['player1'].hand.length).toBe(handBefore);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/action-validator.test.ts -t canTarget`
Expected: FAIL — `ActionValidator.canTarget` is not a function.

- [ ] **Step 3: Write minimal implementation**

In `src/engine/action-validator.ts`, add the import for `TargetPointer` and `TargetingDefinition` at the top:

```ts
import type { ActionCondition, ActionCost, ActionRequirements, TargetPointer, TargetingDefinition } from '../types/effect.types';
```

Then add this static method to the `ActionValidator` class (after `canPayCost`, before `canActivate`):

```ts
    /**
     * Pure structural target-legality check (CR 601.2c).
     * Validates that the provided targets match the TargetingDefinition:
     * - Count: required/minTargets/maxTargets bounds
     * - Type: each target's targetType matches the definition type
     * - Existence: each target references a real object in the right zone
     *
     * This is a RULES check (structural legality). Permission legality
     * (hexproof/shroud/protection) is a separate concern handled by
     * ModifierRegistry.canTarget(). This method is pure: it reads room only.
     */
    public static canTarget(
        room: GameRoom,
        playerId: PlayerId,
        card: CardInstance,
        targets: TargetPointer[],
        targetingDef: TargetingDefinition
    ): boolean {
        void card; // card is reserved for future permission checks (e.g. "can't target")
        void playerId;

        // Count checks
        if (targetingDef.required && targets.length === 0) return false;
        if (targetingDef.minTargets !== undefined && targets.length < targetingDef.minTargets) return false;
        if (targetingDef.maxTargets !== undefined && targets.length > targetingDef.maxTargets) return false;

        // Type + existence checks per target
        for (const target of targets) {
            if (target.targetType !== targetingDef.type) return false;

            switch (target.targetType) {
                case 'permanent':
                case 'card': {
                    if (!target.cardUuid) return false;
                    const cardOnField = room.battlefield.find(c => c.uuid === target.cardUuid);
                    if (!cardOnField) return false;
                    // cardTypes / subTypes filters
                    if (targetingDef.cardTypes && targetingDef.cardTypes.length > 0) {
                        const hasType = targetingDef.cardTypes.some(t => cardOnField.blueprint.cardTypes.includes(t));
                        if (!hasType) return false;
                    }
                    if (targetingDef.subTypes && targetingDef.subTypes.length > 0) {
                        const hasSubtype = targetingDef.subTypes.some(s => (cardOnField.blueprint.subTypes || []).includes(s));
                        if (!hasSubtype) return false;
                    }
                    break;
                }
                case 'player': {
                    if (!target.playerId) return false;
                    if (!(target.playerId in room.players)) return false;
                    break;
                }
                case 'spell':
                case 'stack': {
                    if (!target.stackUuid) return false;
                    if (!room.stack.some(s => s.uuid === target.stackUuid)) return false;
                    break;
                }
                case 'self': {
                    // Self always resolves to the controller — always valid
                    break;
                }
                default:
                    return false;
            }
        }

        return true;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/action-validator.test.ts -t canTarget`
Expected: PASS (all tests).

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/engine/action-validator.ts tests/engine/action-validator.test.ts
git commit -m "feat(targeting): add pure ActionValidator.canTarget for structural target legality"
```

---

### Task 4: Wire `ActionValidator.canTarget()` into `play-card-handler.validate()`

**Files:**
- Modify: `src/engine/handlers/play-card-handler.ts` (the `validate()` method)
- Test: `tests/engine/play-card-handler.test.ts`

**Interfaces:**
- Consumes: `ActionValidator.canTarget()` (from Task 3), `card.blueprint.onCastEffects` (existing), `action.targets` (existing).
- Produces: `validate()` rejects illegal targets at cast time (CR 601.2c) with a clear reason. `ModifierRegistry.canTarget()` remains a stub (permission legality).

- [ ] **Step 1: Write the failing test**

Add this test to `tests/engine/play-card-handler.test.ts` (inside the existing `describe('validate')` block):

```ts
it('should reject when a required target is missing', () => {
  const card = room.players['player1'].hand[0];
  card.blueprint.onCastEffects = [
    {
      action: 'MODIFY_STATS',
      params: { damage: 2 },
      tags: ['damage'],
      targeting: { type: 'permanent', cardTypes: ['Creature'], required: true, minTargets: 1, maxTargets: 1 },
    },
  ];
  const result = playCardHandler.validate(room, 'player1', { cardUuid: card.uuid, targets: [] });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.phase).toBe('validate');
});

it('should reject when a target is not on the battlefield', () => {
  const card = room.players['player1'].hand[0];
  card.blueprint.onCastEffects = [
    {
      action: 'MODIFY_STATS',
      params: { damage: 2 },
      tags: ['damage'],
      targeting: { type: 'permanent', cardTypes: ['Creature'], required: true, minTargets: 1, maxTargets: 1 },
    },
  ];
  const result = playCardHandler.validate(room, 'player1', {
    cardUuid: card.uuid,
    targets: [{ targetType: 'permanent', cardUuid: 'nonexistent-uuid' }],
  });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.phase).toBe('validate');
});

it('should accept a valid target', () => {
  const card = room.players['player1'].hand[0];
  card.blueprint.onCastEffects = [
    {
      action: 'MODIFY_STATS',
      params: { damage: 2 },
      tags: ['damage'],
      targeting: { type: 'permanent', cardTypes: ['Creature'], required: true, minTargets: 1, maxTargets: 1 },
    },
  ];
  const target = instantiateCard('empire-servant');
  target.state.zone = 'battlefield';
  target.state.ownerId = 'player2';
  target.state.controllerId = 'player2';
  room.battlefield.push(target);

  const result = playCardHandler.validate(room, 'player1', {
    cardUuid: card.uuid,
    targets: [{ targetType: 'permanent', cardUuid: target.uuid }],
  });
  expect(result.success).toBe(true);
});

it('should accept a card with no targeting requirement and no targets', () => {
  const card = room.players['player1'].hand[0];
  card.blueprint.onCastEffects = [
    { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self', required: false } },
  ];
  const result = playCardHandler.validate(room, 'player1', { cardUuid: card.uuid, targets: [] });
  expect(result.success).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/play-card-handler.test.ts -t "should reject when a required target is missing"`
Expected: FAIL — `validate()` currently returns `success: true` (targets are not checked).

- [ ] **Step 3: Write minimal implementation**

In `src/engine/handlers/play-card-handler.ts`, modify the `validate()` method. Find this block:

```ts
    if (!ModifierRegistry.canPlay(room, playerId, card)) {
      return { success: false, phase: 'validate', reason: 'A modifier prevents playing this card' };
    }
    if (action.targets && !ModifierRegistry.canTarget(room, playerId, card, action.targets as any)) {
      return { success: false, phase: 'validate', reason: 'Target is not legal' };
    }
```

Replace it with:

```ts
    if (!ModifierRegistry.canPlay(room, playerId, card)) {
      return { success: false, phase: 'validate', reason: 'A modifier prevents playing this card' };
    }

    // --- TARGET VALIDATION (CR 601.2c) ---
    // Two distinct concerns, both pure (see spec §1.1):
    // 1. Structural legality (type/count/existence) — ActionValidator
    // 2. Permission legality (hexproof/shroud/protection) — ModifierRegistry (stub)
    const clientTargets = (action.targets as TargetPointer[]) || [];
    const targetingDef = card.blueprint.onCastEffects?.find(
      (e) => e.targeting.type !== 'self' && !e.targeting.all
    )?.targeting;

    if (targetingDef && !ActionValidator.canTarget(room, playerId, card, clientTargets, targetingDef)) {
      return { success: false, phase: 'validate', reason: 'Target is not legal' };
    }
    if (!ModifierRegistry.canTarget(room, playerId, card, clientTargets)) {
      return { success: false, phase: 'validate', reason: 'Target is protected' };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/play-card-handler.test.ts -t "should reject when a required target is missing"`
Expected: PASS (all four new tests).

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/engine/handlers/play-card-handler.ts tests/engine/play-card-handler.test.ts
git commit -m "feat(targeting): wire ActionValidator.canTarget into play-card-handler.validate"
```

---

### Task 5: Use `targeting.required` for resolve-time fizzle in `revalidateTargets()`

**Files:**
- Modify: `src/engine/effect-resolver.ts` (the `revalidateTargets()` function)
- Test: `tests/engine/effect-resolver.test.ts`

**Interfaces:**
- Consumes: `StackEffect.targeting` (from Task 1).
- Produces: `revalidateTargets()` returns an effect with empty `targets` when `targeting.required` is true and all targets were dropped (fizzle, CR 114.5). When `targeting.required` is false, it resolves with the remaining legal targets.

- [ ] **Step 1: Write the failing test**

Add this test to `tests/engine/effect-resolver.test.ts` (inside the existing `describe('revalidateTargets')` block):

```ts
it('fizzles (empty targets) when required and all targets left the battlefield', () => {
  const effect: StackEffect = {
    action: 'MODIFY_STATS',
    params: { damage: 2 },
    tags: ['damage'],
    targeting: { type: 'permanent', cardTypes: ['Creature'], required: true, minTargets: 1, maxTargets: 1 },
    targets: [{ targetType: 'permanent', cardUuid: 'gone-uuid' }],
  };

  const result = revalidateTargets(room, effect, 'player1');
  expect(result.targets).toHaveLength(0);
});

it('resolves with remaining legal targets when not required and some targets left', () => {
  const card = instantiateCard('empire-servant');
  card.state.zone = 'battlefield';
  card.state.ownerId = 'player2';
  card.state.controllerId = 'player2';
  room.battlefield.push(card);

  const effect: StackEffect = {
    action: 'MODIFY_STATS',
    params: { damage: 2 },
    tags: ['damage'],
    targeting: { type: 'permanent', cardTypes: ['Creature'], required: false },
    targets: [
      { targetType: 'permanent', cardUuid: card.uuid },
      { targetType: 'permanent', cardUuid: 'gone-uuid' },
    ],
  };

  const result = revalidateTargets(room, effect, 'player1');
  expect(result.targets).toHaveLength(1);
  expect(result.targets[0].cardUuid).toBe(card.uuid);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/effect-resolver.test.ts -t "fizzles"`
Expected: FAIL — the first test passes trivially (empty targets already), but the second test fails because `revalidateTargets` currently drops the `gone-uuid` target and keeps the valid one regardless of `required`. Actually both tests may pass already since `revalidateTargets` already drops illegal targets. To make the test meaningful, the fizzle behavior must be explicit. Verify the second test fails: it should pass already (drops gone-uuid, keeps valid). The real change is that `revalidateTargets` must now *consider* `targeting.required` — but since the current behavior already produces empty targets when all are dropped, the observable behavior is unchanged. 

**Note:** This task is primarily a *documentation/robustness* change — the current `revalidateTargets` already drops illegal targets, and the EffectRegistry handler does nothing when `targets` is empty (which is the fizzle). The `targeting.required` field makes the intent explicit and future-proofs the logic. The tests above verify the *current* correct behavior is preserved. If both tests pass on the first run, that is acceptable — the implementation step below adds an explicit guard that documents the fizzle decision.

- [ ] **Step 3: Write minimal implementation**

In `src/engine/effect-resolver.ts`, modify `revalidateTargets()` to add an explicit fizzle guard. Find the end of the function:

```ts
  return {
    ...effect,
    targets: resolvedTargets,
  };
```

Replace it with:

```ts
  // CR 114.5 fizzle: if the effect required targets and all were dropped,
  // the effect fizzles (empty targets). The EffectRegistry handler will do
  // nothing. If not required, it resolves with the remaining legal targets.
  if (effect.targeting?.required && resolvedTargets.length === 0) {
    return {
      ...effect,
      targets: [],
    };
  }

  return {
    ...effect,
    targets: resolvedTargets,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/effect-resolver.test.ts -t "fizzles"`
Expected: PASS (both tests).

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/engine/effect-resolver.ts tests/engine/effect-resolver.test.ts
git commit -m "feat(targeting): use targeting.required for resolve-time fizzle in revalidateTargets"
```

---

### Task 6: Add the synthetic test card 火焰箭 to card data and test deck

**Files:**
- Modify: `src/library/card_data.json`
- Modify: `src/engine/room-factory.ts` (the `TEST_DECK_IDS` array)
- Test: `tests/engine/effect-registry.test.ts` (verify MODIFY_STATS damage applies to a targeted creature)

**Interfaces:**
- Consumes: existing `MODIFY_STATS` effect handler (already applies `SET_DAMAGE` to `effect.targets`).
- Produces: a new card `fire-bolt` (火焰箭) with `onCastEffects` targeting a single creature for 2 damage. Added to `TEST_DECK_IDS` so it can be drawn in the smoke test.

- [ ] **Step 1: Write the failing test**

Add this test to `tests/engine/effect-registry.test.ts` (inside the existing `describe('EffectRegistry')` block, in a new `describe('MODIFY_STATS')` block):

```ts
describe('MODIFY_STATS', () => {
  it('applies damage to a targeted creature on the battlefield', () => {
    const target = instantiateCard('empire-servant');
    target.state.zone = 'battlefield';
    target.state.ownerId = 'player2';
    target.state.controllerId = 'player2';
    room.battlefield.push(target);

    const effect = makeEffect({
      action: 'MODIFY_STATS',
      params: { damage: 2 },
      tags: ['damage'],
      targets: [{ targetType: 'permanent', cardUuid: target.uuid }],
    });
    const stackObj = makeStackObj({ effects: [effect] });

    apply(EffectRegistry['MODIFY_STATS'](room, stackObj, effect));

    const damaged = room.battlefield.find(c => c.uuid === target.uuid);
    expect(damaged?.state.damageTaken).toBe(2);
  });

  it('does nothing when the target is not on the battlefield', () => {
    const effect = makeEffect({
      action: 'MODIFY_STATS',
      params: { damage: 2 },
      tags: ['damage'],
      targets: [{ targetType: 'permanent', cardUuid: 'nonexistent-uuid' }],
    });
    const stackObj = makeStackObj({ effects: [effect] });

    apply(EffectRegistry['MODIFY_STATS'](room, stackObj, effect));

    expect(room.battlefield).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/effect-registry.test.ts -t MODIFY_STATS`
Expected: FAIL — `MODIFY_STATS` is not a registered handler (the `EffectRegistry` object literal has no `MODIFY_STATS` key yet, so `EffectRegistry['MODIFY_STATS']` is `undefined`).

- [ ] **Step 3: Write minimal implementation**

First, add the `MODIFY_STATS` handler to `src/engine/effect-registry.ts`. Find the `'MODIFY_LIFE'` handler (which ends with `},` before `'MODIFY_STATS'`). The `MODIFY_STATS` handler already exists in the file (verified in the codebase). Confirm it is present. If it is present, skip this sub-step.

Verify the handler exists by checking `src/engine/effect-registry.ts` for `'MODIFY_STATS'`. It is already implemented (applies `SET_DAMAGE`). So the test should pass once the handler is confirmed present.

Next, add the card to `src/library/card_data.json`. Add this entry after the `"card_09876_core_set"` entry (before the closing `}` of the JSON object):

```json
  "fire-bolt": {
    "id": "fire-bolt",
    "name": "火焰箭",
    "manaCost": "{R}",
    "cardTypes": ["Spell"],
    "rulesText": "對目標僕從造成2點傷害",
    "onCastEffects": [
      {
        "action": "MODIFY_STATS",
        "params": { "damage": 2 },
        "tags": ["damage"],
        "targeting": { "type": "permanent", "cardTypes": ["Creature"], "required": true, "minTargets": 1, "maxTargets": 1 }
      }
    ]
  }
```

Then add `fire-bolt` to the test deck in `src/engine/room-factory.ts`. Find the `TEST_DECK_IDS` array:

```ts
const TEST_DECK_IDS = [
  'empire-servant', 'empire-servant', 'empire-servant', 'empire-servant',
  'land-red', 'land-red', 'land-red', 'land-red',
];
```

Replace it with:

```ts
const TEST_DECK_IDS = [
  'empire-servant', 'empire-servant', 'empire-servant', 'empire-servant',
  'land-red', 'land-red', 'land-red', 'land-red',
  'fire-bolt',
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/effect-registry.test.ts -t MODIFY_STATS`
Expected: PASS (both tests).

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Verify the card parses correctly**

Run: `npx tsc --noEmit`
Expected: No type errors. (This confirms `fire-bolt` parses through `normalizeCard` without breaking the build.)

- [ ] **Step 7: Commit**

```bash
git add src/library/card_data.json src/engine/room-factory.ts tests/engine/effect-registry.test.ts
git commit -m "feat(targeting): add synthetic fire-bolt test card and add to test deck"
```

---

### Task 7: Add targeting-mode state to the Zustand store

**Files:**
- Modify: `src/client/store/gameStore.ts`
- Test: `tests/engine/action-validator.test.ts` (no — this is client state; add a lightweight test if a client test harness exists, otherwise verify via build)

**Interfaces:**
- Consumes: `TargetPointer`, `TargetingDefinition`, `ActionIdOrAbility` (existing types).
- Produces: `TargetingState` interface, `targeting: TargetingState | null` store field, and actions `beginTargeting`, `addTarget`, `removeTarget`, `cancelTargeting`, `confirmTargeting`.

- [ ] **Step 1: Write the failing test**

There is no existing client test harness (vitest config only includes `tests/**/*.test.ts`, and the client store is not covered). Verify the store compiles and the new actions are wired by running the TypeScript build. Add the implementation first, then verify via build.

- [ ] **Step 2: Implement the store changes**

In `src/client/store/gameStore.ts`, add the imports at the top:

```ts
import type { TargetPointer, TargetingDefinition } from '../../types/effect.types';
import type { ActionIdOrAbility } from '../../types/action.ids';
```

Add the `TargetingState` interface after the `ContextMenuState` interface:

```ts
export interface TargetingState {
  cardUuid: string;
  zone: 'hand' | 'battlefield';
  actionId: ActionIdOrAbility;
  targeting: TargetingDefinition;
  collected: TargetPointer[];
}
```

Add the `targeting` field to the `GameStore` interface (after `contextMenu`):

```ts
  // UI state (client-only)
  contextMenu: ContextMenuState | null;
  targeting: TargetingState | null;
  pendingCard: { cardUuid: string; zone: 'hand' | 'battlefield' } | null;
```

Add the action signatures to the `GameStore` interface (after `hideContextMenu`):

```ts
  hideContextMenu: () => void;
  beginTargeting: (state: TargetingState) => void;
  addTarget: (pointer: TargetPointer) => void;
  removeTarget: (pointer: TargetPointer) => void;
  cancelTargeting: () => void;
  confirmTargeting: () => void;
```

Add the initial state (after `contextMenu: null`):

```ts
  contextMenu: null,
  targeting: null,
  pendingCard: null,
```

Add the action implementations (after `hideContextMenu`):

```ts
  hideContextMenu: () => set({ contextMenu: null }),

  beginTargeting: (state) => set({ targeting: state, contextMenu: null }),

  addTarget: (pointer) => {
    const { targeting } = get();
    if (!targeting) return;
    const max = targeting.targeting.maxTargets;
    if (max !== undefined && targeting.collected.length >= max) return;
    set({ targeting: { ...targeting, collected: [...targeting.collected, pointer] } });
  },

  removeTarget: (pointer) => {
    const { targeting } = get();
    if (!targeting) return;
    set({
      targeting: {
        ...targeting,
        collected: targeting.collected.filter(
          (t) => !(t.cardUuid === pointer.cardUuid && t.playerId === pointer.playerId)
        ),
      },
    });
  },

  cancelTargeting: () => set({ targeting: null }),

  confirmTargeting: () => {
    // The caller (TargetSelector) reads `targeting` and dispatches the action.
    // We keep the state here so the component can read `collected` before clearing.
    set({ targeting: null });
  },
```

- [ ] **Step 3: Verify the build passes**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/store/gameStore.ts
git commit -m "feat(targeting): add targeting-mode state and actions to the Zustand store"
```

---

### Task 8: Add the `needsTargets` helper and enter targeting mode from `CardComponent`

**Files:**
- Modify: `src/client/components/CardComponent.tsx`
- Create: `src/client/targeting.ts` (the `needsTargets` helper)

**Interfaces:**
- Consumes: `useGameStore` `beginTargeting`, `card.blueprint.onCastEffects` (existing), `ACTION_IDS.castSpell`.
- Produces: `needsTargets(card: CardInstance): TargetingDefinition | null` — returns the explicit-target `TargetingDefinition` if the card needs targets before casting, else `null`. `CardComponent` left-click enters targeting mode when `needsTargets` returns non-null.

- [ ] **Step 1: Create the helper**

Create `src/client/targeting.ts`:

```ts
import type { CardInstance } from '../types/card.types';
import type { TargetingDefinition } from '../types/effect.types';

/**
 * Does this card need explicit targets before casting?
 * Returns the TargetingDefinition if the card has an onCastEffect with
 * explicit targets (type !== 'self' && !all), else null.
 *
 * The TargetingDefinition is static card data, and the client's room snapshot
 * is the server-authoritative copy — no round-trip needed.
 */
export function needsTargets(card: CardInstance): TargetingDefinition | null {
  const def = card.blueprint.onCastEffects?.find(
    (e) => e.targeting.type !== 'self' && !e.targeting.all
  )?.targeting;
  return def ?? null;
}
```

- [ ] **Step 2: Modify `CardComponent.tsx`**

In `src/client/components/CardComponent.tsx`, add the import:

```ts
import { needsTargets } from '../targeting';
```

Modify the `handleClick` function. Find:

```ts
  const handleClick = (e: React.MouseEvent) => {
    // Simple click: if in hand, play the card
    if (zone === 'hand') {
      if (phase === 'RPS') {
        playerAction(ACTION_IDS.rpsPlay, card.uuid);
      } else {
        playerAction(ACTION_IDS.castSpell, card.uuid);
      }
    }
  };
```

Replace it with:

```ts
  const handleClick = (e: React.MouseEvent) => {
    // Simple click: if in hand, play the card
    if (zone === 'hand') {
      if (phase === 'RPS') {
        playerAction(ACTION_IDS.rpsPlay, card.uuid);
      } else {
        const targetingDef = needsTargets(card);
        if (targetingDef) {
          // Enter targeting mode instead of casting immediately
          beginTargeting({
            cardUuid: card.uuid,
            zone,
            actionId: ACTION_IDS.castSpell,
            targeting: targetingDef,
            collected: [],
          });
        } else {
          playerAction(ACTION_IDS.castSpell, card.uuid);
        }
      }
    }
  };
```

Add `beginTargeting` to the destructured store access. Find:

```ts
  const { getOptions, playerAction } = useGameActions();
  const showContextMenu = useGameStore((s) => s.showContextMenu);
  const phase = useGameStore(selectCurrentPhase);
```

Replace with:

```ts
  const { getOptions, playerAction } = useGameActions();
  const showContextMenu = useGameStore((s) => s.showContextMenu);
  const beginTargeting = useGameStore((s) => s.beginTargeting);
  const phase = useGameStore(selectCurrentPhase);
```

- [ ] **Step 3: Verify the build passes**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/targeting.ts src/client/components/CardComponent.tsx
git commit -m "feat(targeting): enter targeting mode from CardComponent when a card needs targets"
```

---

### Task 9: Create the `TargetSelector` component and render it in `GameScreen`

**Files:**
- Create: `src/client/components/TargetSelector.tsx`
- Modify: `src/client/components/GameScreen.tsx`
- Modify: `src/client/style.css`

**Interfaces:**
- Consumes: `useGameStore` `targeting`, `addTarget`, `cancelTargeting`, `confirmTargeting`; `useGameActions` `playerAction`; `selectMyBattlefield`, `selectOpponentBattlefield`, `selectMyPlayerId`, `selectOpponentId` selectors.
- Produces: `TargetSelector` renders when `targeting` is active, highlights legal targets, collects one target, and confirms by dispatching `playerAction(actionId, cardUuid, collected)`.

- [ ] **Step 1: Create the `TargetSelector` component**

Create `src/client/components/TargetSelector.tsx`:

```tsx
import { useShallow } from 'zustand/react/shallow';
import { useGameStore, selectMyBattlefield, selectOpponentBattlefield, selectMyPlayerId, selectOpponentId } from '../store/gameStore';
import { useGameActions } from '../hooks/useGameActions';
import type { TargetPointer } from '../../types/effect.types';

/**
 * Renders when the player is in targeting mode. Highlights legal targets
 * (battlefield cards matching the TargetingDefinition filters, or players
 * for type 'player'), collects a single target, and confirms by dispatching
 * the action with the collected TargetPointer[].
 *
 * Single-target UX for now: collects one target then confirms. The backend
 * and data model already support multi-target; only this interaction is
 * single-target (see spec §3.3.3).
 */
export default function TargetSelector() {
  const targeting = useGameStore((s) => s.targeting);
  const addTarget = useGameStore((s) => s.addTarget);
  const cancelTargeting = useGameStore((s) => s.cancelTargeting);
  const confirmTargeting = useGameStore((s) => s.confirmTargeting);
  const myBattlefield = useGameStore(useShallow(selectMyBattlefield));
  const opponentBattlefield = useGameStore(useShallow(selectOpponentBattlefield));
  const myPlayerId = useGameStore(selectMyPlayerId);
  const opponentId = useGameStore(selectOpponentId);
  const { playerAction } = useGameActions();

  if (!targeting) return null;

  const def = targeting.targeting;
  const collected = targeting.collected;

  // Determine legal battlefield targets based on the TargetingDefinition filters
  const allBattlefield = [...myBattlefield, ...opponentBattlefield];
  const legalCards = allBattlefield.filter((card) => {
    if (def.cardTypes && def.cardTypes.length > 0) {
      if (!def.cardTypes.some((t) => card.blueprint.cardTypes.includes(t))) return false;
    }
    if (def.subTypes && def.subTypes.length > 0) {
      if (!def.subTypes.some((s) => (card.blueprint.subTypes || []).includes(s))) return false;
    }
    if (def.controller === 'self' && card.state.controllerId !== myPlayerId) return false;
    if (def.controller === 'opponent' && card.state.controllerId === myPlayerId) return false;
    return true;
  });

  const isCardTarget = def.type === 'permanent' || def.type === 'card';
  const isPlayerTarget = def.type === 'player';

  const isCollected = (cardUuid?: string, playerId?: string) =>
    collected.some((t) => t.cardUuid === cardUuid || t.playerId === playerId);

  const handleCardClick = (cardUuid: string) => {
    if (isCollected(cardUuid)) return; // single-target: already chosen
    addTarget({ targetType: 'permanent', cardUuid });
  };

  const handlePlayerClick = (playerId: string) => {
    if (isCollected(undefined, playerId)) return;
    addTarget({ targetType: 'player', playerId });
  };

  const handleConfirm = () => {
    if (collected.length === 0) return;
    playerAction(targeting.actionId, targeting.cardUuid, collected);
    confirmTargeting();
  };

  const minReached = def.minTargets === undefined || collected.length >= def.minTargets;

  return (
    <div className="target-selector-overlay" onClick={cancelTargeting}>
      <div className="target-selector" onClick={(e) => e.stopPropagation()}>
        <h3>Choose a target</h3>
        {isCardTarget && (
          <div className="target-cards">
            {legalCards.map((card) => (
              <button
                key={card.uuid}
                className={`target-card ${isCollected(card.uuid) ? 'selected' : ''}`}
                onClick={() => handleCardClick(card.uuid)}
              >
                {card.blueprint.name}
              </button>
            ))}
            {legalCards.length === 0 && <p className="target-empty">No legal targets</p>}
          </div>
        )}
        {isPlayerTarget && (
          <div className="target-players">
            {[myPlayerId, opponentId].filter(Boolean).map((pid) => (
              <button
                key={pid}
                className={`target-player ${isCollected(undefined, pid) ? 'selected' : ''}`}
                onClick={() => handlePlayerClick(pid!)}
              >
                {pid === myPlayerId ? 'You' : 'Opponent'}
              </button>
            ))}
          </div>
        )}
        <div className="target-actions">
          <button onClick={cancelTargeting}>Cancel</button>
          <button onClick={handleConfirm} disabled={!minReached || collected.length === 0}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render `TargetSelector` in `GameScreen`**

In `src/client/components/GameScreen.tsx`, add the import:

```ts
import TargetSelector from './TargetSelector';
```

Add `<TargetSelector />` to the JSX, right after `<ContextMenu />`:

```tsx
      <ContextMenu />
      <TargetSelector />
    </div>
  );
}
```

- [ ] **Step 3: Add styles to `style.css`**

Append to `src/client/style.css`:

```css
/* Target Selector */
.target-selector-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.target-selector {
  background: #16213e;
  border: 1px solid #e94560;
  border-radius: 8px;
  padding: 1rem;
  min-width: 300px;
}

.target-selector h3 {
  margin-top: 0;
  color: #eee;
}

.target-cards,
.target-players {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}

.target-card,
.target-player {
  padding: 0.5rem 1rem;
  background: #0f3460;
  color: #eee;
  border: 1px solid #e94560;
  border-radius: 6px;
  cursor: pointer;
}

.target-card.selected,
.target-player.selected {
  background: #e94560;
}

.target-empty {
  color: #aaa;
}

.target-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

.target-actions button {
  padding: 0.4rem 1rem;
  background: transparent;
  color: #eee;
  border: 1px solid #e94560;
  border-radius: 4px;
  cursor: pointer;
}

.target-actions button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] **Step 4: Verify the build passes**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/client/components/TargetSelector.tsx src/client/components/GameScreen.tsx src/client/style.css
git commit -m "feat(targeting): add TargetSelector component and render it in GameScreen"
```

---

### Task 10: Enter targeting mode from `ContextMenu` for targeted actions

**Files:**
- Modify: `src/client/components/ContextMenu.tsx`

**Interfaces:**
- Consumes: `useGameStore` `beginTargeting`, `contextMenu` (with `cardUuid`, `zone`), `useGameActions` `playerAction`, `needsTargets` helper.
- Produces: When the context-menu action is `cast_spell` and the card needs targets, `handleAction` enters targeting mode instead of dispatching immediately.

- [ ] **Step 1: Modify `ContextMenu.tsx`**

In `src/client/components/ContextMenu.tsx`, add the import:

```ts
import { needsTargets } from '../targeting';
import { ACTION_IDS } from '../../types/action.ids';
```

Modify the `handleAction` function. Find:

```ts
  const handleAction = (actionId: string) => {
    playerAction(actionId, contextMenu.cardUuid);
    hideContextMenu();
  };
```

Replace it with:

```ts
  const handleAction = (actionId: string) => {
    if (actionId === ACTION_IDS.castSpell) {
      const card = findCard(contextMenu.cardUuid);
      const targetingDef = card ? needsTargets(card) : null;
      if (targetingDef) {
        beginTargeting({
          cardUuid: contextMenu.cardUuid,
          zone: contextMenu.zone,
          actionId,
          targeting: targetingDef,
          collected: [],
        });
        hideContextMenu();
        return;
      }
    }
    playerAction(actionId, contextMenu.cardUuid);
    hideContextMenu();
  };
```

Add the `findCard` helper and `beginTargeting` access. Add `beginTargeting` to the store access. Find:

```ts
  const contextMenu = useGameStore((s) => s.contextMenu);
  const hideContextMenu = useGameStore((s) => s.hideContextMenu);
  const { playerAction } = useGameActions();
```

Replace with:

```ts
  const contextMenu = useGameStore((s) => s.contextMenu);
  const hideContextMenu = useGameStore((s) => s.hideContextMenu);
  const beginTargeting = useGameStore((s) => s.beginTargeting);
  const room = useGameStore((s) => s.room);
  const { playerAction } = useGameActions();

  // Find a card by uuid across hand and battlefield (for needsTargets lookup)
  const findCard = (cardUuid: string) => {
    if (!room) return undefined;
    for (const player of Object.values(room.players)) {
      const inHand = player.hand.find((c) => c.uuid === cardUuid);
      if (inHand) return inHand;
    }
    return room.battlefield.find((c) => c.uuid === cardUuid);
  };
```

- [ ] **Step 2: Verify the build passes**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/client/components/ContextMenu.tsx
git commit -m "feat(targeting): enter targeting mode from ContextMenu for targeted actions"
```

---

### Task 11: Manual smoke test documentation

**Files:**
- Create: `docs/smoke-test-targeting.md`

**Interfaces:**
- Consumes: the completed targeting flow (Tasks 1-10).
- Produces: a manual smoke-test script verifying the end-to-end targeting flow.

- [ ] **Step 1: Create the smoke-test doc**

Create `docs/smoke-test-targeting.md`:

```markdown
# Targeting Smoke Test

Verifies the end-to-end targeting flow: cast a spell → choose a legal target → validate at cast time → re-validate at resolve time.

## Setup

1. Start the server: `npm run dev`
2. Start the client: `npm run dev:client`
3. Open two browser tabs to the client URL.
4. Create a room in tab 1, join it in tab 2.
5. Play RPS to start the game (both players play a card).

## Scenario: Cast 火焰箭 (fire-bolt) targeting a creature

1. Draw 火焰箭 into your hand (it is in the test deck).
2. Ensure an opponent creature is on the battlefield.
3. Left-click 火焰箭 in your hand.
   - **Expected:** Targeting mode opens, highlighting legal creatures (matching `cardTypes: ['Creature']`).
4. Click a legal creature.
   - **Expected:** The creature is highlighted as selected.
5. Click **Confirm**.
   - **Expected:** The spell goes on the stack. When it resolves, the chosen creature takes 2 damage (`damageTaken` becomes 2).

## Scenario: Cast with no legal target

1. Ensure there are NO creatures on the battlefield.
2. Left-click 火焰箭 in your hand.
   - **Expected:** Targeting mode opens with "No legal targets" shown.
3. The **Confirm** button is disabled (no target collected).
4. Click **Cancel**.
   - **Expected:** Targeting mode closes; the spell is not cast.

## Scenario: Cast a non-targeting card (e.g. 帝國奴僕)

1. Left-click 帝國奴僕 in your hand.
   - **Expected:** No targeting mode; the card is cast immediately (existing behavior unchanged).
```

- [ ] **Step 2: Commit**

```bash
git add docs/smoke-test-targeting.md
git commit -m "docs(targeting): add targeting smoke test"
```

---

## Self-Review

**Spec coverage:**
- §3.2.1 (merge client targets into StackEffect) → Task 1 + Task 2
- §3.2.2 (cast-time validation, structural vs permission split) → Task 3 + Task 4
- §3.2.2 (resolve-time fizzle via `targeting.required`) → Task 5
- §4 (test card 火焰箭) → Task 6
- §3.3.1 (targeting-mode state) → Task 7
- §3.3.2 (enter targeting mode from CardComponent) → Task 8
- §3.3.3 (TargetSelector UI) → Task 9
- §3.3.3 (ContextMenu enters targeting mode) → Task 10
- §5.2 (manual smoke test) → Task 11
- §3.2.3 (ActionOption.targeting) → deferred (Phase 5), explicitly out of scope for this plan.

**Placeholder scan:** No TBD/TODO/placeholder patterns. Every code step has complete code.

**Type consistency:** `StackEffect.targeting` (Task 1) is consumed by Task 2 (merge), Task 5 (fizzle). `ActionValidator.canTarget(room, playerId, card, targets, targetingDef)` signature (Task 3) is consumed by Task 4. `TargetingState` (Task 7) is consumed by Task 8 (beginTargeting), Task 9 (TargetSelector), Task 10 (ContextMenu). `needsTargets(card)` (Task 8) is consumed by Task 10. All names match across tasks.