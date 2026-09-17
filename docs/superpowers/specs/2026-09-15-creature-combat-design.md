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
  mutations.push({ type: 'CLEAR_DAMAGE' });              // ← new, FIRST
  mutations.push({ type: 'CLEAR_END_OF_TURN_EFFECTS' });
}
```

**Why a dedicated mutation (not folded into `CLEAR_END_OF_TURN_EFFECTS`):** damage
and continuous effects are separate concepts with separate rules. Keeping them
distinct keeps the reducer honest and makes the delta stream readable.

**Why `CLEAR_DAMAGE` must come first (order-of-operations):** consider a 2/2 that
receives a "+0/+2 until end of turn" buff (becoming 2/4) and then takes 3 damage.
If `CLEAR_END_OF_TURN_EFFECTS` ran first, the buff would be stripped while 3 damage
is still marked — the creature becomes a 2/2 with 3 damage, and an SBA check would
destroy it. Removing damage first avoids this entirely.

**Note on current reachability:** this failure is *latent*, not active. Today
`advancePhase` folds mutations into a working copy without running SBAs, and
`applyMutations` applies the whole batch before calling `checkStateBasedActions`
(`game-engine.ts` lines 134-147). So no SBA runs between the two mutations. The
reorder is fragility-hardening: it keeps the invariant true if mutations are ever
applied incrementally, or if a trigger splits the batch. It also matches the intent
of CR 514.2.

### 2.2 Engine fix — multi-blocker damage (CR 510.1c)

**Rule:** An attacker assigns combat damage equal to its power among the creatures
blocking it. Damage is assigned in a chosen order; a blocker must be assigned lethal
damage before the next blocker receives any. Each blocker simultaneously deals its
power to the attacker.

**Decision (revised):** Damage assignment order is **automatic and attacker-neutral —
sorted by highest power, then lowest toughness, then uuid as tiebreaker**.
The attacker's controller does not manually order blockers.

**Why not declaration order (CR 510.1c):** the original design used the defender's
blocker-pairing order. That is a rule violation — CR 510.1c gives ordering to the
**attacker**, so using the defender's pairing sequence hands the defending player
control over which of their own creatures survives.

**Why not uuid sort:** sorting by uuid (arbitrary string hash) produces
unpredictable outcomes — a high-value utility creature and a vanilla blocker would
resolve in an order the player cannot anticipate. A gameplay heuristic (highest
power first, lowest toughness as tiebreaker) gives the attacker a predictable,
favorable auto-order: the most dangerous blocker takes damage first, which is what
a rational attacker would choose anyway. True attacker-chosen ordering (a prompt)
is deferred; see §5.

**Algorithm** (replaces the `decl.blockers[0]`-only block in `state-machine.ts`):

```
// Attacker-neutral heuristic: highest power first, lowest toughness tiebreaker
ordered = [...decl.blockers].sort((a, b) => {
    const pa = resolvePower(room, a), pb = resolvePower(room, b);
    if (pa !== pb) return pb - pa;           // higher power first
    const ta = resolveToughness(room, a), tb = resolveToughness(room, b);
    if (ta !== tb) return ta - tb;           // lower toughness first
    return a.uuid.localeCompare(b.uuid);     // deterministic tiebreaker
})

remaining = attackerPower
for each blocker in ordered:
    lethal = lethalDamageFor(room, blocker)      // seam — see below
    assigned = min(remaining, lethal)
    SET_DAMAGE blocker += assigned, source = attacker.uuid
    remaining -= assigned
    if remaining == 0: break

// Each blocker deals its power to the attacker as a DISCRETE mutation
for each blocker in ordered:
    SET_DAMAGE attacker += resolvePower(blocker), source = blocker.uuid

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

**Per-blocker discrete damage (source attribution):** each blocker emits its **own**
`SET_DAMAGE` mutation rather than being summed into one. Summing collapses multiple
damage sources into a single blob, which would make lifelink, deathtouch, and
per-source damage triggers impossible to implement later. Discrete mutations also
make the delta stream self-describing. `SET_DAMAGE` gains an optional `source` field
(the dealing card's uuid).

**Lethal-damage seam:** extract a helper rather than inlining the formula:

```ts
// src/engine/card-utils.ts (or card-characteristic-service.ts)
export function lethalDamageFor(room: GameRoom, card: CardInstance): number {
  return Math.max(0, CardCharacteristicService.resolveToughness(room, card)
                     - (card.state.damageTaken || 0));
}
```

This is a **seam, not an implementation**. Deathtouch (1 damage is lethal regardless
of toughness) and damage prevention / protection (incoming damage reduced before
spillover) are out of scope, but they now have a single place to hook in. Do **not**
implement them in this plan.

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

**Reconciliation against server state (required):** the slice holds raw uuids, so a
network update can invalidate them — e.g. an opponent removes a selected creature
with an instant. Without reconciliation the UI holds dangling references and sends
invalid payloads. `applyDelta` (and `setRoom`) must reconcile `combatSelection`
against the incoming `room`:

- Drop any `attackers` uuid no longer on the battlefield, or no longer eligible
  (tapped / sick / already attacked).
- Drop any `blockerPairs` entry whose attacker is no longer in `room.combat`, or
  whose blocker is no longer on the battlefield / untapped.
- Clear `pendingBlocker` if that creature is gone.

Reconciliation is a pure function returning both the reconciled selection and a
`changed` flag:

```ts
export function reconcileCombatSelection(
  selection: CombatSelection,
  room: GameRoom,
): { selection: CombatSelection; changed: boolean }
```

When `changed` is true, the UI displays a brief notification (e.g. "Selection
updated due to board change") so the player is not silently surprised by
disappearing selections. The notification auto-dismisses after 2 seconds.

### 2.6 Visual: summoning sickness

While touching `CardComponent`, render summoning sickness so players understand why
a creature cannot attack. Add a `.summoning-sick` class (dimmed / "zZ" badge) when
`card.state.summoningSickness` is true on a battlefield creature.

---

## 3. Files touched

| File | Change |
|------|--------|
| `src/types/game-mutation.types.ts` | Add `CLEAR_DAMAGE`; add optional `source` to `SET_DAMAGE` |
| `src/engine/game-reducer.ts` | Handle `CLEAR_DAMAGE` |
| `src/engine/state-machine.ts` | Fire `CLEAR_DAMAGE` at cleanup (before effects); rewrite multi-blocker damage |
| `src/engine/card-utils.ts` | Add `lethalDamageFor` seam |
| `src/client/store/gameStore.ts` | Add `combatSelection` slice + actions + reconciliation |
| `src/client/store/combatSelection.ts` | New: `reconcileCombatSelection` pure helper |
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
3. Buffed creature survives cleanup: 2/2 + "+0/+2 until EOT" takes 3 damage, then
   cleanup — must NOT die (order-of-operations regression test)
4. Two blockers on one attacker: both take damage, both deal counter-damage
5. Lethal-first ordering: first blocker gets lethal, remainder spills to second
6. Damage order is attacker-neutral: reversing the defender's pairing order does
   NOT change which blocker dies
7. Damage order uses gameplay heuristic: highest-power blocker takes damage first
   (predictable, not arbitrary uuid sort)
8. Trample with multiple blockers: excess over *total* lethal → player
9. Trample with pre-damaged blocker: lethal accounts for existing `damageTaken`
10. Simultaneity: a blocker that dies still deals its damage
11. Per-blocker attribution: each blocker emits its own `SET_DAMAGE` with `source`

**Unit (client):**
12. `reconcileCombatSelection` drops uuids removed from the battlefield
13. `reconcileCombatSelection` drops pairs whose attacker left `room.combat`
14. `reconcileCombatSelection` returns `changed: true` when it purges entries
15. `reconcileCombatSelection` returns `changed: false` when nothing changes

**Integration:**
16. Full combat: 1 attacker, 2 blockers, verify final life + graveyard

**Live (Playwright):** per `docs/playwright-smoke-testing.md` — select 2 attackers,
confirm; opponent pairs 1 blocker, confirms; verify damage and life.

---

## 5. Out of scope

- **Manual damage assignment order UI** — the attacker's controller does not choose
  blocker order. Order uses a gameplay heuristic (highest power first, lowest
  toughness tiebreaker, uuid final tiebreaker). True CR 510.1c attacker choice is
  deferred; the `lethalDamageFor` seam and per-blocker discrete mutations keep the
  door open.
- **Over-assignment of damage (CR 510.1c full compliance)** — the engine caps
  assigned damage at `min(remaining, lethal)`. Under full CR 510.1c, an attacker
  may legally assign *more* than lethal damage to a blocker (e.g. dumping all 5
  damage from a 5/5 onto a 1/1 to play around instant-speed toughness buffs). This
  cap is a **temporary engine constraint**, not a design decision. It will be
  lifted when the attacker-ordering UI is added (the UI will let the attacker
  specify how much damage to assign to each blocker).
- **Deathtouch / damage prevention / protection** — `lethalDamageFor` is a seam only;
  the vanilla formula is unchanged.
- **Lifelink** — per-blocker `source` metadata is emitted, but no lifelink handler
  consumes it yet.
- First strike / double strike damage steps
- Banding, rampage, or other exotic combat keywords
- Menace / "can't be blocked except by N creatures" restrictions
