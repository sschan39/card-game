# Play Card from Hand — Vertical Slice Execution Report

**Date:** 2026-07-08  
**Branch:** `review`  
**Plan:** `play-card-from-hand` (10 tasks, 4 phases)  
**Result:** 9 tasks completed, 1 skipped, 33 tests passing, 0 type errors

---

## Overview

Implemented the "play a card from hand" vertical slice in the TypeScript engine. This is the first end-to-end action flow: a client sends a `cast_spell` action, the engine validates it, pays costs, pushes to the stack, and resolves the card onto the battlefield.

---

## Architecture

```
Client Action → GameEngine.handleAction()
  → ActionRegistry[actionType].validate()   ← ActionValidator, ModifierRegistry
  → ActionRegistry[actionType].propose()    ← pay costs, push StackObject
  → EventBus.emit('ACTION_PROPOSED')

Later (both players pass):
  GameEngine.resolveTopOfStack()
  → ActionRegistry[actionType].resolve()    ← EffectRegistry
  → EventBus.emit('STACK_RESOLVED')
```

### Key design decisions:
- **ActionRegistry pattern** mirrors the existing EffectRegistry — open `Record<string, ActionHandler>`, extensible without type changes
- **3-phase handler lifecycle:** `validate` (permission checks) → `propose` (pay costs, create StackObject) → `resolve` (apply effects)
- **Thin GameEngine orchestrator** — no game rules, just routing and event emission
- **ModifierRegistry / ModifierPipeline** as stubs for future permission/value modifiers
- **EventBus** as stub for future trigger/replacement effect systems

---

## Phase 1: Foundation (Tasks 1–3)

### Task 1 — Tooling & Test Infrastructure
**Commit:** `be758ae`

- Installed `vitest` and `typescript` as devDependencies
- Created `tsconfig.json` (strict, CommonJS, ES2020, resolveJsonModule)
- Created `vitest.config.ts` (globals, node environment)
- Created `tests/helpers/test-room-factory.ts` — factory for test `GameRoom` with 2 players, empire-servant in player1's hand, main phase, priority on player1

### Task 2 — Open Type System
**Commit:** `b07d178`

**`src/types/effect.types.ts`:**
- `EffectPayload` changed from closed union to open interface: `{ effectId: string; params?: Record<string, unknown> }`
- Added `EffectId = string`, `ActionType = string` type aliases
- Removed `allowedZones` from `ActionCost` (zone validation is separate)
- Widened `globalFlag` from union to `string`
- Fixed truncated `StackObjectConfig` interface

**`src/types/card.types.ts`:**
- `CardType` widened to include `'Artifact' | 'Enchantment'`
- `CardSubType` widened from union to `string`
- Added `TriggerEvent` union type for triggered abilities
- Removed dead `CardEffect` type and old `EffectId` union
- `TriggeredAbility.triggerCondition` now typed as `TriggerEvent`

### Task 3 — Fix Card Parser & Factory
**Commit:** `dbde41f`

**`src/library/card-parser.ts`:**
- `normalizeAbility` now returns `CardAbility | null` (was `any`)
- Reads both `raw.onPlayEffect || raw.onPlay` for backward compatibility
- Proper `CardType[]` and `CardZone[]` casting

**`src/library/card-factory.ts`:**
- Removed Proxy export (unnecessary indirection)
- Named exports only: `getBlueprint`, `instantiateCard`
- Deep clone handles discriminated union (`a.type === 'activated'` guard)

**`data/card_data.json`:**
- Renamed `"onPlay"` → `"onPlayEffect"` for rock, paper, scissors entries

---

## Phase 2: Engine Core (Tasks 4–7)

### Task 4 — ActionRegistry
**Commit:** `29676cf`

New file: `src/engine/action-registry.ts`

```typescript
export interface ActionData { cardUuid: string; targets?: TargetPointer[]; [key: string]: unknown }
export type ActionResult = { success: true; stackObject?: StackObject }
                        | { success: false; phase: 'validate'|'propose'|'resolve'; reason: string }
export interface ActionHandler {
  validate(room, playerId, action): ActionResult
  propose(room, playerId, action): ActionResult
  resolve(room, stackObj): ActionResult
}
export const ActionRegistry: Record<ActionType, ActionHandler> = {}
export function registerAction(type, handler): void
```

4 tests: register/retrieve, multiple types, undefined lookup, override.

### Task 5 — EventBus Stub
**Commit:** `73b4799`

New file: `src/engine/event-bus.ts`

- `GameEvent = { eventId, roomId, payload }`
- `EventBus` class with `emit(event)` (logs to console) and `on(eventId, listener)` (no-op stub)
- Future: listeners stored and invoked for triggered abilities and replacement effects

4 tests: instantiation, on() registration, emit(), console logging.

### Task 6 — ModifierRegistry & ModifierPipeline Stubs
**Commit:** `63c769f`

New files: `src/engine/modifier-registry.ts`, `src/engine/modifier-pipeline.ts`

- `ModifierRegistry.canPlay()` — always true, logs (future: "can't cast" restrictions)
- `ModifierRegistry.canTarget()` — always true, logs (future: hexproof, shroud, protection)
- `ModifierPipeline.apply()` — identity transform, logs (future: cost reducers, flash granters)

Also added `"types": ["node"]` to `tsconfig.json` to resolve `console` type errors.

### Task 7 — Fix canPayCost Mana Loop
**Commit:** `77bd8f3`

Modified: `src/engine/action-validator.ts`

The `canPayCost` method had an incomplete mana loop placeholder (`{ /* ... your existing mana loop ... */ }`). Replaced with proper iteration:

```typescript
if (cost.mana) {
  for (const [color, amount] of Object.entries(cost.mana)) {
    const playerMana = player.mana[color as ManaColor] ?? 0;
    if (playerMana < amount) return false;
  }
}
```

Added `ManaColor` import. 12 new tests covering: no cost, enough mana, missing color, insufficient quantity, life cost, tap cost, discard cost, colorless mana, zone validation, sorcery speed, and priority checks.

---

## Phase 3: Play Card Handler (Task 8)

### Task 8 — playCardHandler
**Commit:** `9dabf47`

New file: `src/engine/handlers/play-card-handler.ts`

The core of the vertical slice — a complete `ActionHandler` registered as `'cast_spell'`:

- **validate:** finds card in hand, checks `ModifierRegistry.canPlay`/`canTarget`, runs `ModifierPipeline.apply`, then `ActionValidator.canActivate`
- **propose:** pays mana/life costs, removes card from hand, sets zone to `'stack'`, creates `StackObject` with `effectId: 'CAST_SPELL'`, pushes to stack
- **resolve:** looks up `EffectRegistry[effectId]`, calls the handler (moves creature to battlefield with summoning sickness, or instant/sorcery to graveyard)

8 tests: validate success, zone rejection, mana rejection, missing UUID, propose with cost payment and StackObject creation, propose rejection, resolve to battlefield, and full validate→propose→resolve lifecycle.

---

## Phase 4: Orchestrator (Task 10)

### Task 9 — GRANT_STATS Handler
**Skipped.** The `GRANT_STATS` effect handler is not needed for the play-card vertical slice. The `EffectRegistry` needs re-planning to separate "spell resolution" (`CAST_SPELL`) from "card effects" (`DEAL_DAMAGE`, `ADD_MANA`, etc.). Deferred to a follow-up plan.

### Task 10 — GameEngine Orchestrator
**Commit:** `251619f`

New file: `src/engine/game-engine.ts`

Thin orchestrator with two methods:

- **`handleAction(room, playerId, actionType, actionData)`** — looks up `ActionRegistry[actionType]`, runs `validate` → `propose`, emits `ACTION_PROPOSED` event
- **`resolveTopOfStack(room)`** — pops top of stack, calls `handler.resolve()`, emits `STACK_RESOLVED` event

Known limitation: `resolveTopOfStack` hardcodes `ActionRegistry['cast_spell']` since stack objects don't yet carry their originating action type. This is sufficient for the vertical slice and will be generalized when more action types are added.

5 tests: valid action, unregistered action, validation failure, stack resolution, empty stack.

---

## Files Changed

| File | Status | Purpose |
|---|---|---|
| `src/types/effect.types.ts` | Modified | Open `EffectPayload`, `EffectId`, `ActionType` |
| `src/types/card.types.ts` | Modified | Wider `CardType`/`CardSubType`, `TriggerEvent` |
| `src/library/card-parser.ts` | Modified | Typed `normalizeAbility`, `onPlay`/`onPlayEffect` |
| `src/library/card-factory.ts` | Modified | Remove Proxy, named exports, deep clone fix |
| `data/card_data.json` | Modified | `onPlay` → `onPlayEffect` |
| `src/engine/action-registry.ts` | **New** | Action handler registry |
| `src/engine/action-validator.ts` | Modified | Complete `canPayCost` mana loop |
| `src/engine/event-bus.ts` | **New** | Event emission stub |
| `src/engine/modifier-registry.ts` | **New** | Permission check stubs |
| `src/engine/modifier-pipeline.ts` | **New** | Value transform stub |
| `src/engine/handlers/play-card-handler.ts` | **New** | Play card action handler |
| `src/engine/game-engine.ts` | **New** | Action orchestrator |
| `tsconfig.json` | **New** | TypeScript configuration |
| `vitest.config.ts` | **New** | Test runner configuration |
| `package.json` | Modified | vitest, typescript devDeps, test scripts |
| `tests/helpers/test-room-factory.ts` | **New** | Test room factory |
| `tests/engine/action-registry.test.ts` | **New** | 4 tests |
| `tests/engine/event-bus.test.ts` | **New** | 4 tests |
| `tests/engine/action-validator.test.ts` | **New** | 12 tests |
| `tests/engine/play-card-handler.test.ts` | **New** | 8 tests |
| `tests/engine/game-engine.test.ts` | **New** | 5 tests |

**Total:** 22 files, +2570 / −356 lines, 33 tests

---

## Deferred Work

1. **EffectRegistry re-planning** — separate "spell resolution" (`CAST_SPELL`) from "card effects" (`DEAL_DAMAGE`, `ADD_MANA`, `DISCARD_HAND`). Add `GRANT_STATS`, `DRAW_CARDS`, `COUNTER_SPELL` handlers.
2. **StackObject action type tracking** — stack objects need to carry their originating `actionType` so `resolveTopOfStack` can look up the correct handler dynamically.
3. **EventBus implementation** — store listeners, invoke on matching events for triggered abilities.
4. **ModifierRegistry implementation** — scan permanents for "can't cast", hexproof, shroud, protection.
5. **ModifierPipeline implementation** — chain cost reducers, flash granters, target modifiers.
6. **ManaCost parser** — convert `manaCost: "{R}"` from card data into `castRequirements.cost.mana`.