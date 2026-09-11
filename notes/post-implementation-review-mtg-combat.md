# Post-Implementation Review — MTG Combat Mechanics

> **Date:** 2026-09-11 (prepared for review session)
> **Branch:** `stack-full-MTG-refac`
> **Plan:** `docs/superpowers/plans/2026-09-10-mtg-combat-mechanics.md` (10 tasks)
> **Status:** All 10 tasks complete, committed, verified (typecheck clean, 317/317 tests pass)

---

## 1. What Was Implemented

Replaced the Hearthstone-style per-creature attack model with MTG-faithful batch combat:

| Area | Before | After |
|------|--------|-------|
| Attack action | `attack` (per-creature, immediate damage) | `declare_attackers` (batch, MTG CR 508) |
| Blocking | None | `declare_blockers` (MTG CR 509) |
| Damage timing | Immediate on attack | Deferred to `combatDamageStep` (CR 510) |
| Attack target | Player or creature | Always the defending player; blockers intercept |
| `CombatDeclaration` | `{target, defenderPower}` | `{blockers[]}` (no target) |
| Mutations | `ADD_COMBAT_DECLARATION` | `DECLARE_ATTACKERS` (batch) + `ASSIGN_BLOCKERS` |
| `server.ts` endTurn | Chained all 5 combat steps | Stops at `declareAttackersStep` |

**New files:** `declare-attackers-handler.ts`, `declare-blockers-handler.ts`
**Deleted files:** `attack-handler.ts`, `attack-handler.test.ts`

---

## 2. Verification Evidence

- `npx tsc --noEmit` → **0 errors**
- `npx vitest run` → **27 files / 317 tests pass**
- Working tree clean; 17 commits ahead of `origin/stack-full-MTG-refac`
- New handler tests: `declare-attackers-handler.test.ts` (10 tests), `declare-blockers-handler.test.ts` (11 tests), `combat-damage-step.test.ts` (3 tests)

---

## 3. Design Decisions Worth Reviewing

### 3.1 Attackers always target the defending player
Attackers no longer target creatures. Blockers intercept. This is MTG-faithful but **removes the ability to attack planeswalkers** (out of scope, but worth confirming).

### 3.2 Single blocker per attacker
`combatDamageStep` uses `decl.blockers[0]` only. Multiple blockers (CR 509.1c) are deferred. **The `blockers: CardInstance[]` array is plural but only index 0 is used** — a latent inconsistency if multiple blockers are later allowed.

### 3.3 `declareBlockersHandler` requires non-empty assignments
```ts
if (!assignments || assignments.length === 0) {
  return { success: false, phase: 'validate', reason: 'At least one blocker assignment is required' };
}
```
**There is no "declare no blockers" path.** The defending player must always send at least one assignment. This is a UX gap — a player with no blockers (or choosing not to block) cannot advance past `declareBlockersStep` via the handler. The server flow relies on the client sending a non-empty assignment, which is awkward.

### 3.4 Declaration uuid == card uuid
`declareAttackersHandler.propose()` sets `declaration.uuid = card.uuid`, and `declareBlockersHandler` matches `combatDecl.uuid === attackerUuid`. This couples the declaration identity to the card identity. Works for single-attacker-per-card, but if a card could ever be in combat twice (it can't in MTG), this would collide. Acceptable but worth noting.

### 3.5 `hasKeyword` reads `card.blueprint.keywords`
```ts
function hasKeyword(card: CardInstance, keyword: string): boolean {
  return card.blueprint.keywords?.includes(keyword) ?? false;
}
```
This is duplicated in both `state-machine.ts` and `declare-blockers-handler.ts`. **Duplication** — should be a shared helper. Also, `keywords` was added to `CardBlueprint` but the plan's global constraint said `(card.blueprint as any).keywords` — the implementation properly typed it instead, which is an improvement.

### 3.6 Trample damage uses `SET_LIFE` directly
Trample excess damage is applied via `SET_LIFE` mutation. This bypasses the damage pipeline (no `DAMAGE_TAKEN` event for the player). Worth confirming this is intended vs. routing through a damage event.

---

## 4. Potential Issues / Risks

### 4.1 No "no blockers" path — **FIXED** (2026-09-11)
~~The `declareBlockersHandler` requires non-empty assignments.~~ **Fixed:** `validate()` now allows empty `assignments` array (returns `{ success: true }` early). `propose()` handles empty assignments gracefully (returns empty mutations). Added tests for both paths.

### 4.2 Combat damage simultaneity — **VERIFIED OK** (was a concern, now resolved)
MTG CR 510.2 requires all combat damage to be dealt simultaneously. The implementation pushes `SET_DAMAGE` mutations sequentially, but `applyMutations()` in `game-engine.ts` (lines 134-147) runs `checkStateBasedActions()` **only after the entire mutation batch is applied**, looping until no more SBAs fire. This means all combat damage is applied before any SBA death check — simultaneity is preserved. **No action needed.** (Confirmed by reading `game-engine.ts`.)

### 4.3 `hasKeyword` duplication — **FIXED** (2026-09-11)
~~Two copies of the same helper.~~ **Fixed:** Extracted to `src/engine/card-utils.ts`. Both `state-machine.ts` and `declare-blockers-handler.ts` now import from the shared helper.

### 4.4 Client cannot actually declare attackers or blockers — **FIXED** (2026-09-11)
~~The engine handlers require a non-empty `attackers`/`assignments` payload, but the client has no mechanism to provide it.~~ **Fixed:**
- `useGameActions.playerAction()` now accepts an optional 4th parameter `extraData: Record<string, unknown>` that gets spread into the socket payload.
- PhaseBar "Declare Attackers" button now passes `{ attackers: availableAttackers.map(c => ({ cardUuid: c.uuid })) }` — all untapped, non-sick creatures are auto-selected.
- PhaseBar "Declare Blockers" button now passes `{ assignments: [] }` (no blockers, which is now valid per 4.1 fix).
- Server `playerAction` socket handler type widened to `{ [key: string]: any }` to accept extra fields.
- **Note:** A proper creature-selection UI (click to toggle attackers/blockers) is still deferred. The current auto-select-all approach makes the flow playable end-to-end.

---

## 5. Test Coverage Assessment

**Good:**
- Handler validation (phase, turn, tapped, sickness, already-attacked, duplicates)
- Flying evasion (non-flying can't block flying)
- Damage resolution (unblocked → player, blocked → both, trample excess)
- Death trigger fires after combat damage SBA
- Mutual destruction

**Gaps:**
- No test for the "no blockers" path (because it's not implemented)
- No client-side test for the PhaseBar button payload — **this is the confirmed integration gap (4.4)**
- No test for the full server `declareBlockers` → turn-completion flow with an actual blocker (the smoke test covers it, but only via direct engine calls)
- No end-to-end test that the client can actually drive the combat flow (attacker selection → declare → blocker selection → declare → damage)

---

## 6. Suggested Review Agenda

1. **Verify the fixes work end-to-end** — run the server and confirm the combat flow is playable from the UI (Enter Battle → Declare Attackers → Declare Blockers → damage → turn switch).
2. **Creature selection UI** — the current auto-select-all approach is a stopgap. A proper click-to-toggle selection for attackers/blockers is the next priority.
3. **Confirm scope** — planeswalker attacks, multiple blockers, first strike, etc. are intentionally deferred.
4. **Damage simultaneity (4.2)** — already verified OK; no action needed.

---

## 7. Commits (newest first)

```
2fee1f2 test: update existing tests for new MTG combat flow
e9ff36d feat: remove ATTACK_DECLARED event and unused ActionResult fields
6d240c2 feat: delete attack-handler, remove attack option, update CombatDisplay/PhaseBar
12031b9 feat: update server.ts for MTG combat — endTurn shrinks, new declareAttackers/declareBlockers cases
080d7d3 feat: implement combat damage resolution in combatDamageStep
f2972da feat: add declareBlockersHandler with flying evasion; add keywords to CardBlueprint
4ae379d feat: add declareAttackersHandler with batch declare attackers
dc72e31 Task 2: Update game-reducer.ts - DECLARE_ATTACKERS and ASSIGN_BLOCKERS cases
69c0bd0 Task 1: Update CombatDeclaration interface, action IDs, mutations, docs
```