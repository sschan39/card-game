# Creature-vs-Creature Combat — Design Document

**Date:** 2026-09-15
**Status:** 📝 DESIGN (approved, not yet implemented)
**Scope:** Make creature-vs-creature combat correct and playable. Fixes two engine
correctness bugs (damage never cleared; multi-blocker damage ignored) and replaces
the placeholder combat UI (all-or-nothing attackers, hardcoded empty blockers) with
click-to-select attacker/blocker assignment.
**Context:** The MTG combat pipeline (`2026-09-08`) and combat mechanics
(`2026-09-10`) specs built the 5-step combat skeleton, batch `declareAttackers`,
`declareBlockers` validation, and deferred damage resolution. A live smoke test
(2026-09-15) confirmed the pipeline works end-to-end but exposed two engine bugs and
two UI gaps that block real creature combat.

---

## 1. Overview

### 1.1 What works today (verified live 2026-09-15)

| Piece | Status |
|-------|--------|
| 5-step combat pipeline | ✅ Works |
| Batch `declareAttackers` (all eligible creatures) | ✅ Works |
| `declareBlockers` validation (flying, tapped, dupes) | ✅ Works |
| Deferred damage in `combatDamageStep` | ✅ Works (single blocker) |
| SBA creature death (`damageTaken >= toughness`) | ✅ Works |
| Trample excess → defending player | ✅ Works (single blocker) |

### 1.2 What is broken or missing

| # | Problem | Impact |
|---|---------|--------|
| 1 | **Damage is never cleared** (CR 514.2) | Creatures accumulate damage across turns; a survivor dies to a later small hit. Combat becomes nonsense after the first exchange. |
| 2 | **Only `blockers[0]` takes damage** (CR 510.1c) | Multi-blocking is silently ignored — extra blockers deal no damage and take none. |
| 3 | **Trample uses raw toughness** (CR 510.1c) | Excess is computed against base toughness, ignoring damage already marked. |
| 4 | **Attacker UI is all-or-nothing** | Player cannot choose *which* creatures attack. |
| 5 | **Blocker UI is hardcoded empty** | Player cannot block at all. |

---

## 2. Design

### 2.1 Engine fix — damage clearing (CR 514.2)

**Rule:** "At the beginning of the cleanup step, all damage marked on permanents is
removed."

**Change:** Add a `CLEAR_DAMAGE` mutation and fire it at `cleanupStep`.

```ts
// src/types/game-mutation.types.ts
| { type: 'CLEAR_DAMAGE' }   // fired at cleanupStep (CR 514.2)

// src/engine/game-reducer.ts
case 'CLEAR_DAMAGE':
  return {
    ...state,
    battlefield: state.battlefield.map(card => ({
      ...card,
      state: { ...card.state, damageTaken: 0 },
    })),
  };

// src/engine/state-machine.ts — in transition(), cleanupStep branch
if (to === 'cleanupStep') {
  mutations.push({ type: 'CLEAR_END_OF_TURN_EFFECTS' });
  mutations.push({ type: 'CLEAR_DAMAGE' });   // ← new
}
```

**Why a dedicated mutation (not folded into `CLEAR_END_OF_TURN_EFFECTS`):** damage
and continuous effects are separate concepts with separate rules. Keeping them
distinct keeps the reducer honest and makes the delta stream readable.

### 2.2 Engine fix — multi-blocker damage (CR 510.1c)

**Rule:** An attacker assigns combat damage equal to its power among the creatures
blocking it. Damage is assigned in a chosen order; a blocker must be assigned lethal
damage before the next blocker receives any. Each blocker simultaneously deals its
power to the attacker.

**Decision (approved):** Damage assignment order is **automatic — declaration order,
lethal-first**. The attacker's controller does not manually order blockers. This is
correct for the common case and avoids extra UI.

**Algorithm** (replaces the `decl.blockers[0]`-only block in `state-machine.ts`):

```
remaining = attackerPower
totalLethal = 0
for each blocker in decl.blockers (declaration order):
    lethal = max(0, toughness(blocker) - damageTaken(blocker))
    assigned = min(remaining, lethal)
    SET_DAMAGE blocker += assigned
    remaining -= assigned
    totalLethal += lethal
    if remaining == 0: break

// Each blocker deals its power to the attacker (summed)
blockerPowerTotal = sum(resolvePower(blocker) for blocker in decl.blockers)
SET_DAMAGE attacker += blockerPowerTotal

// Trample: excess over TOTAL lethal damage assigned to blockers
if hasKeyword(attacker, 'Trample') and remaining > 0:
    SET_LIFE defender -= remaining
```

**Key correctness points:**
- `lethal` accounts for **existing** `damageTaken` (a blocker already damaged this
  turn needs less to die) — this is the CR 510.1c fix for issue #3.
- Trample excess is `remaining` after all blockers are assigned lethal — not
  `attackerPower - toughness(blocker[0])`.
- All damage is computed from the **pre-damage snapshot** (`room`), then emitted as
  mutations. This preserves simultaneity (CR 510.2): a blocker that dies still deals
  its damage.

### 2.3 Client — attacker selection (click-to-select + Confirm)

**Current:** `PhaseBar.tsx` sends *all* eligible creatures in one click.

**New:** In `declareAttackersStep`, the active player clicks eligible creatures to
toggle them, then confirms.

- Eligible = `Creature && !isTapped && !summoningSickness && !attackedThisTurn`
  (existing filter, unchanged)
- Clicking an eligible creature toggles it into a local `selectedAttackers: Set<string>`
- Selected creatures render with a highlight class (reuse `.selected` styling)
- Button becomes **"Confirm Attackers (N)"**, disabled when `N === 0`
- Sends `{ attackers: [...selected].map(uuid => ({ cardUuid: uuid })) }`

**State location:** local component state in `PhaseBar.tsx` (or a small
`combatSelection` slice in the store if the highlight must live in `CardComponent`).
Because `CardComponent` renders the highlight, a store slice is cleaner — see 2.5.

### 2.4 Client — blocker selection (click-to-pair + Confirm)

**Current:** `PhaseBar.tsx` sends hardcoded `{ assignments: [] }`.

**New:** In `declareBlockersStep`, the defending player pairs blockers to attackers.

- Click one of your untapped creatures → it becomes the "pending blocker"
- Click an attacker in `room.combat` → creates a pair `{ attackerUuid, blockerUuids: [blocker] }`
- A blocker may only be assigned once (server validates; UI prevents too)
- Pairs render in `CombatDisplay` (already shows `attacker → blockers`)
- Button becomes **"Confirm Blockers (N)"**; sends the collected `assignments`
- An explicit **"No Blocks"** button sends `{ assignments: [] }`

### 2.5 Client state — `combatSelection` store slice

Add a small client-only slice to `gameStore.ts`:

```ts
interface CombatSelection {
  attackers: string[];                       // selected attacker uuids
  blockerPairs: { attackerUuid: string; blockerUuid: string }[];
  pendingBlocker: string | null;             // blocker awaiting an attacker click
}
```

Actions: `toggleAttacker(uuid)`, `selectBlocker(uuid)`, `assignBlocker(attackerUuid)`,
`clearCombatSelection()`. Cleared on phase change and after confirm.

`CardComponent` reads this slice to render `.selected` (attacker) and
`.pending-blocker` / `.block-target` (blocker) highlights.

### 2.6 Visual: summoning sickness

While touching `CardComponent`, render summoning sickness so players understand why
a creature cannot attack. Add a `.summoning-sick` class (dimmed / "zZ" badge) when
`card.state.summoningSickness` is true on a battlefield creature.

---

## 3. Files touched

| File | Change |
|------|--------|
| `src/types/game-mutation.types.ts` | Add `CLEAR_DAMAGE` |
| `src/engine/game-reducer.ts` | Handle `CLEAR_DAMAGE` |
| `src/engine/state-machine.ts` | Fire `CLEAR_DAMAGE` at cleanup; rewrite multi-blocker damage |
| `src/client/store/gameStore.ts` | Add `combatSelection` slice + actions |
| `src/client/components/PhaseBar.tsx` | Attacker/blocker selection + Confirm buttons |
| `src/client/components/CardComponent.tsx` | Selection highlights + summoning-sick class |
| `src/client/components/CombatDisplay.tsx` | Show pending pairs (minor) |
| `src/client/style.css` | `.selected`, `.pending-blocker`, `.summoning-sick` styles |
| `tests/engine/combat-damage-step.test.ts` | Multi-blocker + trample-lethal tests |
| `tests/engine/state-machine.test.ts` | Damage-clearing test |

---

## 4. Testing

**Unit (engine):**
1. `CLEAR_DAMAGE` resets `damageTaken` to 0 on all battlefield cards
2. Damage is cleared at `cleanupStep` (survivor heals between turns)
3. Two blockers on one attacker: both take damage, both deal counter-damage
4. Lethal-first ordering: first blocker gets lethal, remainder spills to second
5. Trample with multiple blockers: excess over *total* lethal → player
6. Trample with pre-damaged blocker: lethal accounts for existing `damageTaken`
7. Simultaneity: a blocker that dies still deals its damage

**Integration:**
8. Full combat: 1 attacker, 2 blockers, verify final life + graveyard

**Live (Playwright):** per `docs/playwright-smoke-testing.md` — select 2 attackers,
confirm; opponent pairs 1 blocker, confirms; verify damage and life.

---

## 5. Out of scope

- Manual damage assignment order UI (auto lethal-first chosen instead)
- First strike / double strike damage steps
- Banding, rampage, or other exotic combat keywords
- Menace / "can't be blocked except by N creatures" restrictions
