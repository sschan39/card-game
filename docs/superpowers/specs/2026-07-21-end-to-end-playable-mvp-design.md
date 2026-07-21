# End-to-End Playable MVP — Design Document

**Date:** 2026-07-21
**Status:** Draft — Awaiting Review
**Context:** Engine consolidation complete (120 tests passing). Need a playable game loop: two players connect, play lands, tap for mana, cast creatures, attack, and someone wins.

---

## 1. Overview

Two layers of work to reach a playable MVP:

- **Layer 1 — Critical Debt Fixes:** 4 refactors from `notes/review.md` that prevent bugs and unlock future cards. No behavior change.
- **Layer 2 — Playability Features:** Mana system, direct attack combat, life total tracking. These make the game actually playable.

**Out of scope:** Trigger system evaluation, GRANT_STATS handler, full combat with blockers, new cards, deployment.

**Canonical card data:** `src/library/card_data.json` is the source of truth. `data/card_data.json` is legacy and should be removed.

---

## 2. Layer 1: Critical Debt Fixes

### 2.1 CardInstance Composition (Review #4)

**Problem:** `CardInstance extends CardBlueprint` causes shared-mutation bugs. Two instances can share references to nested objects like `abilities[0].cost`.

**Fix:** Replace inheritance with composition:
```typescript
export interface CardInstance {
  readonly uuid: string;
  readonly blueprint: CardBlueprint;  // shared, immutable reference
  state: CardState;
}
```
All rules lookups go through `card.blueprint.power`. The engine applies modifications from `card.state.counters` or active effects. Eliminates all deep-cloning in `card-factory.ts`.

**Files touched:** `types/card.types.ts`, `library/card-factory.ts`, all consumers of `CardInstance` properties.

### 2.2 Open EffectPayload (Review #1)

**Problem:** `EffectPayload` is a closed discriminated union of 5 types. Every new card effect requires editing this central type.

**Fix:** Convert to an open interface:
```typescript
export interface EffectPayload {
  effectId: string;  // open string, not closed union
  params?: Record<string, unknown>;
}
```
Handlers narrow params as needed. New effects added purely by registering a handler + adding card data — zero type changes.

**Files touched:** `types/effect.types.ts`, `engine/effect-registry.ts`.

### 2.3 Open CardType / CardSubType (Review #2)

**Problem:** `CardType = 'Creature' | 'Spell' | 'Land'` is hardcoded. Adding "Artifact" or "Enchantment" requires editing the core type file.

**Fix:** Widen to `string` with a const array for known types:
```typescript
export const CARD_TYPES = ['Creature', 'Spell', 'Land', 'Artifact', 'Enchantment'] as const;
export type CardType = string;
```
Runtime validation where needed, but the type system no longer blocks new types.

**Files touched:** `types/card.types.ts`.

### 2.4 Typed Trigger Events (Review #3)

**Problem:** `triggerCondition: string` with no type safety. Typos like `'ON_ENTB'` won't be caught.

**Fix:** Define a trigger event union (types only — no engine evaluation yet):
```typescript
export type TriggerEvent = 
  | 'ON_ENTER_BATTLEFIELD' 
  | 'ON_LEAVE_BATTLEFIELD' 
  | 'ON_DIE' 
  | 'ON_DRAW' 
  | 'ON_DISCARD' 
  | 'BEGIN_UPKEEP' 
  | 'END_OF_TURN'
  | 'ON_DAMAGE_TAKEN'
  | 'ON_LIFE_GAIN';
```
Update `TriggeredAbility.triggerCondition` from `string` to `TriggerEvent`.

**Files touched:** `types/card.types.ts`.

---

## 3. Layer 2: Playability Features

### 3.1 Mana System

**Mana Pool** — added to each player's state:
```typescript
// On GamePlayer
manaPool: { red: number; colorless: number; total: number }
```
Resets at the start of each turn (during untap step).

**Tapping for Mana** — flows through existing `executeCardAction` pipeline:
1. Player clicks land/Empire Servant on battlefield → context menu shows "Tap for Mana" (already exists via `OptionService`)
2. Client sends `executeCardAction` with `actionId: 'tapForManaAction'` (already in `game.js`)
3. Server validates: card is untapped, controller is active player
4. `ADD_MANA` effect handler fires (already exists in `effect-registry.ts`)
5. Mana added to player's `manaPool`
6. Card's `state.tapped = true`
7. Sync service picks up changes via delta

**Paying for Spells** — integrated into `ActionValidator`:
1. When casting a card, validator checks `manaPool` against `ActionCost.mana`
2. If insufficient, returns `{ success: false, reason: 'Not enough mana' }`
3. On successful cast, deduct mana from pool before card moves to stack

**Files touched:** `types/game.player.types.ts` (manaPool), `engine/action-validator.ts` (mana check), `engine/action-service.ts` (mana deduction), `engine/effect-registry.ts` (ADD_MANA writes to pool).

### 3.2 Direct Attack Combat

**Simplified combat for MVP:** No blockers, no combat damage step. Creatures attack directly.

Flow:
1. Player clicks untapped, non-sick creature on battlefield → context menu shows "Attack"
2. `OptionService` returns an attack action for eligible creatures
3. Client sends `executeCardAction` with `actionId: 'attackAction'`
4. Server validates: creature not tapped, not summoning sick, hasn't attacked this turn
5. Creature becomes tapped
6. Opponent's life reduced by creature's power
7. If life ≤ 0, game ends (see 3.3)

**Summoning sickness:** Creatures that entered the battlefield this turn cannot attack. Tracked via a `turnEnteredBattlefield` field on `CardState`, compared against `room.turnNumber`.

**Once-per-turn attack:** Tracked via `attackedThisTurn` flag on `CardState`, cleared during untap step.

**Files touched:** `engine/option-service.ts` (attack action), `engine/action-registry.ts` (attack handler), `types/card.types.ts` (CardState fields).

### 3.3 Life Total & Game Over

**Life totals** — already exist as `playerHealth` / `opponentHealth` divs in `index.html` (hardcoded to 20). Need:
- `life` field on `GamePlayer` type (initialized to 20)
- Server mutates `player.life` on damage
- Sync service picks up the change in delta

**Client delta handler** — new `socket.on('stateDelta', ...)` handler in `game.js`:
- Parses delta changes
- Updates life total displays when `players.*.life` changes
- Updates card visual states when `battlefield.*.state.tapped` changes
- Detects `life <= 0` and shows game over

**Game over detection** — server-side, after any life change:
- If a player's life ≤ 0, set `room.winner = otherPlayerId`
- Sync service emits delta with winner field
- Client shows winner announcement

**Files touched:** `types/game.player.types.ts` (life field), `types/game.room.types.ts` (winner field), `public/game.js` (stateDelta handler).

### 3.4 onPlay/onPlayEffect JSON Fix (Review #18)

**Problem:** `card_data.json` uses `"onPlay"` but `CardBlueprint` expects `onPlayEffect`. RPS cards' DISCARD_HAND effect never fires.

**Fix:** Update `card-parser.ts` to read `raw.onPlay || raw.onPlayEffect`.

**Files touched:** `library/card-parser.ts`.

### 3.5 card-parser.ts Type Safety (Review #9)

**Problem:** `normalizeAbility(ability: any): any` bypasses the type system entirely.

**Fix:** Add proper return type:
```typescript
export function normalizeAbility(ability: Record<string, unknown>): CardAbility | null
```

**Files touched:** `library/card-parser.ts`.

### 3.6 RPS Card ID Constants (Review #8)

**Problem:** `room-factory.ts` hardcodes `instantiateCard('rock')`, `'paper'`, `'scissors'`.

**Fix:** Extract to a constant:
```typescript
const RPS_CARD_IDS = ['rock', 'paper', 'scissors'] as const;
```

**Files touched:** `engine/room-factory.ts`.

---

## 4. Turn Structure (Refined)

```
TURN START (stateTurnStart)
  ├─ Untap all permanents (clear tapped, attackedThisTurn, summoningSick)
  ├─ Reset mana pool to zero
  ├─ Draw card (auto for active player)
  └─ Transition to main phase

MAIN PHASE (player actions, any order)
  ├─ Play Land (1 per turn limit)
  ├─ Tap for Mana (click permanent → executeCardAction)
  ├─ Cast Creature (click card in hand → playCard)
  └─ Attack (click creature → executeCardAction)

END TURN
  ├─ Transition through end phase
  ├─ Switch active player
  └─ Emit turn change to clients
```

**Untap implementation:** The untap logic runs inside `stateMachine.transition('stateTurnStart')` — no new phase needed. It iterates the active player's battlefield and resets `tapped`, `attackedThisTurn`, and clears summoning sickness for creatures that entered before this turn.

---

## 5. What Does NOT Change

- **No new socket events.** All actions flow through `executeCardAction` / `playCard`. State sync through existing `stateDelta`.
- **No new engine classes.** Mana pool is data on `GamePlayer`, combat is an action handler, life is a field.
- **No trigger evaluation.** `TriggerEvent` types are defined but the engine doesn't scan for matching triggers yet.
- **No GRANT_STATS.** Crimson Hellkite's firebreathing won't work in this milestone.
- **No new cards.** The 6 existing cards are the full pool.

---

## 6. Testing Strategy

- **Layer 1:** Update existing tests for new types. `card-factory.test.ts` needs significant updates for composition change. `card-parser.test.ts` (if exists) for `onPlay` fix and `normalizeAbility` return type.
- **Layer 2:** New tests for:
  - Mana pool add/deduct/reset
  - Attack validation (tapped, sick, already attacked)
  - Life total changes and game over detection
  - Untap step (all permanents untap, flags reset)
- **Integration:** `game-engine.test.ts` extended with mana+attack scenarios.

---

## 7. Rollback & Risk

- **CardInstance composition** is the riskiest change — touches many files. Mitigation: do it first, run full test suite, fix cascading type errors before moving on.
- **Mana system** is additive — new fields, new validation. Low risk to existing functionality.
- **Combat** is additive — new action handler. Low risk.
- If Layer 1 breaks things, we can revert and fix before attempting Layer 2.