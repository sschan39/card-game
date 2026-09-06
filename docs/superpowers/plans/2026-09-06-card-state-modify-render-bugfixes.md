# Card State Modify/Render Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bugs in the card state modify/render system: (1) `MODIFY_STATS` silently drops power/toughness changes, and (2) the client renders base blueprint stats instead of resolved stats (buffs/counters invisible).

**Architecture:** Both fixes reuse the existing `ContinuousEffectPool` + `CardCharacteristicService` model. Bug 1 makes `MODIFY_STATS` emit `ADD_CONTINUOUS_EFFECT` (STAT_DELTA) entries like `GRANT_STATS` already does. Bug 2 makes `CardComponent` resolve P/T through `CardCharacteristicService` (already importable on the client via the `@engine/*` path alias) using the synced `continuousEffectPool` and `card.state.counters`.

**Tech Stack:** TypeScript, Vitest, React, Zustand.

## Global Constraints

- Follow existing codebase patterns (pure handlers → `GameMutation[]` → `gameReducer`).
- TDD: write failing test first, verify it fails, implement, verify it passes, commit.
- Reuse existing primitives (`ADD_CONTINUOUS_EFFECT`, `STAT_DELTA`, `CardCharacteristicService`) — do not introduce a parallel modifier system.
- Hand cards must show base stats; only battlefield cards resolve modifiers.
- All existing 252 tests must continue to pass.

---

### Task 1: Make `MODIFY_STATS` emit continuous effects for P/T changes

**Files:**
- Modify: `src/engine/effect-registry.ts` (the `'MODIFY_STATS'` handler)
- Test: `tests/engine/effect-registry.test.ts` (the `MODIFY_STATS` describe block)

**Interfaces:**
- Consumes: `ContinuousEffectEntry` from `src/types/card.types.ts`; `StackEffect` from `src/types/effect.types.ts`.
- Produces: `MODIFY_STATS` now returns `ADD_CONTINUOUS_EFFECT` mutations for `params.power`/`params.toughness`, in addition to the existing `SET_DAMAGE` mutation for `params.damage`.

**Context:** The current `'MODIFY_STATS'` handler in `src/engine/effect-registry.ts` handles `damage` (via `SET_DAMAGE`) but has a `TODO` comment saying P/T changes are silently ignored. `GRANT_STATS` already shows the correct pattern: emit one `ADD_CONTINUOUS_EFFECT` entry per stat with `layer: 7`, `effect: { type: 'STAT_DELTA', ... }`, `scope: { cardUuid }`, and `duration: 'END_OF_TURN'`.

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe('MODIFY_STATS', ...)` block in `tests/engine/effect-registry.test.ts`:

```typescript
it('emits ADD_CONTINUOUS_EFFECT entries for power/toughness changes', () => {
  const creature = instantiateCard('empire-servant');
  creature.state.zone = 'battlefield';
  creature.state.ownerId = 'player1';
  creature.state.controllerId = 'player1';
  room.battlefield.push(creature);

  const sourceCard = instantiateCard('empire-servant');
  sourceCard.state.zone = 'battlefield';
  sourceCard.state.controllerId = 'player1';

  const effect = makeEffect({
    action: 'MODIFY_STATS',
    params: { power: 2, toughness: 2 },
    tags: ['until_end_of_turn'],
    targets: [{ targetType: 'permanent', cardUuid: creature.uuid }],
  });
  const stackObj = makeStackObj({ effects: [effect], source: sourceCard });

  const mutations = EffectRegistry['MODIFY_STATS'](room, stackObj, effect);
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

  expect(room.continuousEffectPool).toHaveLength(2);
  expect(room.continuousEffectPool[0].effect).toEqual({ type: 'STAT_DELTA', power: 2 });
  expect(room.continuousEffectPool[1].effect).toEqual({ type: 'STAT_DELTA', toughness: 2 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/effect-registry.test.ts -t "emits ADD_CONTINUOUS_EFFECT entries for power/toughness changes"`

Expected: FAIL — `MODIFY_STATS` currently returns `[]` for P/T-only effects (no `ADD_CONTINUOUS_EFFECT` mutations), so `expect(mutations).toHaveLength(2)` fails with `expected 0 to be 2`.

- [ ] **Step 3: Implement the fix**

Replace the `'MODIFY_STATS'` handler in `src/engine/effect-registry.ts` with:

```typescript
'MODIFY_STATS': (room, stackObj, effect) => {
  const rawParams = effect.params as { power?: number; toughness?: number; damage?: number };
  // Resolve dynamic params: use resolve-time values if available, fall back to snapshot params
  const damage = (effect.dynamicParams?.damage as number) ?? rawParams.damage;
  const power = (effect.dynamicParams?.power as number) ?? rawParams.power;
  const toughness = (effect.dynamicParams?.toughness as number) ?? rawParams.toughness;
  const sourceCard = stackObj.source as CardInstance | undefined;
  const source = sourceCard?.uuid ?? 'emblem';
  const mutations: GameMutation[] = [];

  for (const target of effect.targets) {
    if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
      const card = findCardOnBattlefield(room, target.cardUuid);
      if (!card) continue;

      if (damage !== undefined) {
        mutations.push({ type: 'SET_DAMAGE', cardUuid: card.uuid, amount: (card.state.damageTaken || 0) + damage });
      }

      // P/T changes are continuous effects (MTG layer 7), stored in the pool
      // and resolved on-demand by CardCharacteristicService.
      if (power !== undefined) {
        mutations.push({
          type: 'ADD_CONTINUOUS_EFFECT',
          entry: {
            source,
            layer: 7,
            effect: { type: 'STAT_DELTA', power },
            scope: { cardUuid: card.uuid },
            duration: 'END_OF_TURN',
          },
        });
      }

      if (toughness !== undefined) {
        mutations.push({
          type: 'ADD_CONTINUOUS_EFFECT',
          entry: {
            source,
            layer: 7,
            effect: { type: 'STAT_DELTA', toughness },
            scope: { cardUuid: card.uuid },
            duration: 'END_OF_TURN',
          },
        });
      }
    }
  }

  return mutations;
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/effect-registry.test.ts`

Expected: PASS — all `MODIFY_STATS` tests pass, including the new one.

- [ ] **Step 5: Run full suite**

Run: `npm test`

Expected: All 252+ tests pass (the new test adds 1).

- [ ] **Step 6: Commit**

```bash
git add src/engine/effect-registry.ts tests/engine/effect-registry.test.ts
git commit -m "fix(modifiers): MODIFY_STATS now emits STAT_DELTA continuous effects for P/T changes"
```

---

### Task 2: Client renders resolved P/T via CardCharacteristicService

**Files:**
- Modify: `src/client/components/CardComponent.tsx`
- Test: `tests/engine/card-characteristic-service.test.ts` (add a client-relevant test if needed — see note)

**Interfaces:**
- Consumes: `CardCharacteristicService` from `src/engine/card-characteristic-service` (importable via `@engine/card-characteristic-service`); `useGameStore` from `../store/gameStore`; `CardInstance` from `../../types/card.types`.
- Produces: `CardComponent` renders resolved P/T for battlefield cards, base P/T for hand cards.

**Context:** `CardComponent` currently reads `card.blueprint.power`/`card.blueprint.toughness` directly (line ~66), with a comment `// Deferred: client-side characteristic resolution. For now, read blueprint directly.` The client already receives `continuousEffectPool` via deltas (see `sync-service.ts` `ADD_CONTINUOUS_EFFECT`/`REMOVE_CONTINUOUS_EFFECT` and `deltaReducer.ts`). `CardCharacteristicService.resolvePower(room, card)` / `resolveToughness(room, card)` fold the pool + counters. The client tsconfig includes `../engine/**/*.ts`, so the service is importable.

**Design decision:** Only battlefield cards resolve modifiers (a card in hand has no continuous effects applied). Hand cards keep showing base blueprint stats. This matches MTG — P/T modifications only apply to permanents on the battlefield.

- [ ] **Step 1: Write the failing test**

Add this test to `tests/engine/card-characteristic-service.test.ts` (it verifies the resolution logic the client will now rely on — the client itself has no test harness, so we test the shared service):

```typescript
it('resolves power/toughness including counters for a battlefield creature', () => {
  const card = makeCreature(room);
  card.state.counters['+1/+1'] = 2;
  room.continuousEffectPool.push({
    source: card.uuid,
    layer: 7,
    effect: { type: 'STAT_DELTA', power: 1, toughness: 1 },
    scope: { cardUuid: card.uuid },
    duration: 'END_OF_TURN',
  });

  expect(CardCharacteristicService.resolvePower(room, card)).toBe(4); // 1 + 1 + 2
  expect(CardCharacteristicService.resolveToughness(room, card)).toBe(4); // 1 + 1 + 2
});
```

- [ ] **Step 2: Run test to verify it passes (service already works)**

Run: `npx vitest run tests/engine/card-characteristic-service.test.ts`

Expected: PASS — the service already resolves correctly. This test documents the contract the client will rely on.

- [ ] **Step 3: Modify `CardComponent` to resolve P/T**

In `src/client/components/CardComponent.tsx`:

1. Add imports:
```typescript
import { CardCharacteristicService } from '@engine/card-characteristic-service';
```

2. Inside the component, add a room selector and compute resolved stats:
```typescript
const room = useGameStore((s) => s.room);

// Resolve P/T through the continuous effect pool + counters (MTG layer 7).
// Only battlefield permanents have modifiers applied; hand cards show base stats.
const isBattlefield = zone === 'battlefield';
const power = isBattlefield && room
  ? CardCharacteristicService.resolvePower(room, card)
  : card.blueprint.power;
const toughness = isBattlefield && room
  ? CardCharacteristicService.resolveToughness(room, card)
  : card.blueprint.toughness;
```

3. Replace the render block:
```typescript
{power !== undefined && (
  <div className="card-stats">
    {power}/{toughness}
  </div>
)}
```

- [ ] **Step 4: Verify no type errors**

Run: `npx tsc --noEmit -p src/client/tsconfig.json`

Expected: No errors. (If the `@engine/*` path alias isn't resolving in the client build, use a relative import `../../engine/card-characteristic-service` instead.)

- [ ] **Step 5: Run full suite**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/client/components/CardComponent.tsx tests/engine/card-characteristic-service.test.ts
git commit -m "fix(render): CardComponent resolves P/T through CardCharacteristicService for battlefield cards"
```

---

### Task 3: Fix the discarded `ModifierPipeline.apply()` return value

**Files:**
- Modify: `src/engine/effect-resolver.ts` (line ~256)
- Modify: `src/engine/handlers/play-card-handler.ts` (the `modifiedAction` usage)

**Interfaces:**
- Consumes: `ModifierPipeline.apply()` from `src/engine/modifier-pipeline`.
- Produces: The transformed effect is actually used, or the dead call is removed.

**Context:** In `effect-resolver.ts:256`, `ModifierPipeline.apply(validatedEffect, workingRoom, stackObj)` is called but its return value is discarded. In `play-card-handler.ts`, `modifiedAction` is computed but never used. Since the stub is identity, this is harmless today, but it's a latent bug: the moment `apply()` returns a transformed effect, the transformation silently won't take effect.

**Design decision:** Since `ModifierPipeline` is a no-op stub with no real modifiers implemented, the cleanest fix is to **remove the dead calls** rather than wire up a transformation that never happens. This avoids pretending the pipeline works. When real modifiers are added (consumer-driven), the call site will be reintroduced with the return value used.

- [ ] **Step 1: Remove the dead call in `effect-resolver.ts`**

In `src/engine/effect-resolver.ts`, remove this block (and the now-unused `ModifierPipeline` import):

```typescript
    // 3. Run through modifier pipeline
    ModifierPipeline.apply(validatedEffect, workingRoom, stackObj);
```

Also remove the import line:
```typescript
import { ModifierPipeline } from './modifier-pipeline';
```

- [ ] **Step 2: Remove the dead call in `play-card-handler.ts`**

In `src/engine/handlers/play-card-handler.ts`, remove this block (and the now-unused `ModifierPipeline` import):

```typescript
    const modifiedAction = ModifierPipeline.apply(
      { action: 'cast_spell', params: {}, tags: [], targets: (action.targets as any) || [] },
      room,
      {} as StackObject
    );
```

Also remove the import line:
```typescript
import { ModifierPipeline } from '../modifier-pipeline';
```

- [ ] **Step 3: Verify no type errors**

Run: `npx tsc --noEmit`

Expected: No errors. (If `ModifierPipeline` is now unused anywhere, consider whether to keep the stub file — it's referenced in docs, so keep it for now.)

- [ ] **Step 4: Run full suite**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/effect-resolver.ts src/engine/handlers/play-card-handler.ts
git commit -m "refactor(modifiers): remove dead ModifierPipeline.apply() calls (no-op stub)"
```

---

## Self-Review

**1. Spec coverage:**
- Bug 1 (`MODIFY_STATS` drops P/T) → Task 1. ✅
- Bug 2 (client renders base stats) → Task 2. ✅
- Latent bug (discarded `ModifierPipeline.apply()` return) → Task 3. ✅

**2. Placeholder scan:** No TBD/TODO placeholders. All code blocks are complete. ✅

**3. Type consistency:**
- `CardCharacteristicService.resolvePower(room, card)` / `resolveToughness(room, card)` — matches existing signatures in `src/engine/card-characteristic-service.ts`. ✅
- `ADD_CONTINUOUS_EFFECT` entry shape (`source`, `layer`, `effect`, `scope`, `duration`) — matches `ContinuousEffectEntry` in `src/types/card.types.ts` and the existing `GRANT_STATS` handler. ✅
- `makeEffect` / `makeStackObj` helpers — match existing test helpers in `tests/engine/effect-registry.test.ts`. ✅