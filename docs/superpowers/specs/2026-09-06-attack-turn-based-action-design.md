# Attack as a Turn-Based Action — Design Document (Option 1)

**Date:** 2026-09-06
**Status:** ❌ REJECTED (2026-09-07) — superseded by Option 3 (full MTG stack model)
**Context:** The battle-mechanics plan (`2026-09-06-battle-mechanics.md`, Tasks 1-7) is complete and committed. Attack is currently modeled as a `StackObject` with `type: 'activated'` — the source creature stays on the battlefield, and the attack "ability" resolves through the stack. This works, but it is **semantically imprecise** vs MTG: declaring attackers is a **turn-based action** (CR 508), not an activated ability (CR 602). This spec refines attack to be a turn-based action that applies damage directly, with no stack and no priority window.

---

## 1. Overview

In MTG, declaring attackers is a **turn-based action** that happens during the declare-attackers step of the combat phase. It is **not** put on the stack, does **not** use the stack, and does **not** pass priority. The attacker is tapped, and combat damage is dealt as part of the combat damage step.

The current implementation shoehorns attack into the stack as `type: 'activated'`. This causes:
- The resolution pipeline must special-case `'activated'`/`'triggered'` to avoid moving the source card (the `applyStructuralZoneChange` fix).
- Attack gets a priority window it shouldn't have (the opponent could "respond" to an attack declaration, which is wrong in MTG).
- The `StackObject` type is overloaded with a concept that isn't really a stack action.

**This spec makes attack a turn-based action:** the attack handler applies damage directly in `propose()` (like `tapForMana` does today), producing no `StackObject`. The stack pipeline no longer needs the `'activated'` branch for attack.

---

## 2. Current State (verified 2026-09-06)

| Piece | Location | Status |
|-------|----------|--------|
| `attackHandler.validate()` | `src/engine/handlers/attack-handler.ts` | ✅ Validates turn/phase/creature/tapped/sickness/attackedThisTurn/target |
| `attackHandler.propose()` | `src/engine/handlers/attack-handler.ts` | ❌ Produces a `StackObject` with `type: 'activated'` |
| `attackHandler.resolve()` | `src/engine/handlers/attack-handler.ts` | ⚠️ Dead code (engine uses `resolveStackObject`) |
| `applyStructuralZoneChange()` | `src/engine/effect-resolver.ts` | ⚠️ Has a special-case for `'activated'`/`'triggered'` (added for attack) |
| `resolveStackObject()` | `src/engine/effect-resolver.ts` | ⚠️ Gates `PERMANENT_ENTERED` on `type === 'spell'` (added for attack) |
| `proposeAndStack()` | `src/engine/game-engine.ts` | ⚠️ Calls `stateMachine.addToStack()` when `result.stackObject` exists |
| `addToStack()` | `src/engine/state-machine.ts` | ⚠️ Transitions to `Stack` phase + gives priority to controller |
| `tapForManaHandler` | `src/engine/handlers/tap-for-mana-handler.ts` | ✅ Bypasses stack entirely (the pattern to follow) |
| `ATTACK_DECLARED` event | `src/engine/game-engine.ts` | ✅ Emitted after propose (for `ON_ATTACK` triggers) |

### Gaps

1. **Attack uses the stack.** `attackHandler.propose()` builds a `StackObject` and pushes it via `PUSH_STACK`, then `proposeAndStack()` calls `addToStack()` which transitions to the `Stack` phase and gives priority. This is wrong for a turn-based action.
2. **Resolution pipeline special-cases.** `applyStructuralZoneChange()` and `resolveStackObject()` have branches for `'activated'`/`'triggered'` that exist primarily to support attack. Once attack leaves the stack, these branches are only needed for real activated abilities (e.g. `GRANT_STATS`).
3. **Dead `resolve()`.** The handler's `resolve()` method is never called by the engine — it's a vestige of the 3-phase pipeline.

---

## 3. Design

### 3.1 Attack handler — apply damage directly in `propose()`

`attackHandler.propose()` no longer builds a `StackObject`. Instead, it returns the damage mutations directly (the same pattern as `tapForManaHandler`):

```ts
propose(room, playerId, action): ActionResult {
  const card = findCardOnBattlefield(room, playerId, action.cardUuid);
  if (!card) return { success: false, phase: 'propose', reason: 'Creature disappeared' };

  const mutations: GameMutation[] = [];
  // COST: tap + mark attacked
  mutations.push({ type: 'TAP_CARD', cardUuid: card.uuid });
  mutations.push({ type: 'SET_ATTACKED_THIS_TURN', cardUuid: card.uuid, value: true });

  const attackerPower = CardCharacteristicService.resolvePower(room, card);
  const targetCreature = /* resolve from action.targets */;

  if (targetCreature) {
    // Attacker deals damage to defender
    mutations.push({ type: 'SET_DAMAGE', cardUuid: targetCreature.uuid, amount: attackerPower });
    // Defender deals counter-damage to attacker
    const defenderPower = CardCharacteristicService.resolvePower(room, targetCreature);
    mutations.push({ type: 'SET_DAMAGE', cardUuid: card.uuid, amount: defenderPower });
    // Trample excess → MODIFY_LIFE to defender's controller
    // ...
  } else {
    // Attack the face
    mutations.push({ type: 'MODIFY_LIFE', playerId: opponentId, amount: -attackerPower });
  }

  // NO stackObject — return mutations directly
  return { success: true, mutations, attackingCard: card };
}
```

**Key changes:**
- **No `StackObject`.** Remove the `PUSH_STACK` mutation and the `stackObj` construction.
- **Damage via `SET_DAMAGE`** (not `MODIFY_STATS` with `damage` param). `SET_DAMAGE` is the primitive that SBA reads (`damageTaken`). This matches how the effect registry applies combat damage.
- **`attackingCard` retained** so `proposeAndStack()` still emits `ATTACK_DECLARED` for `ON_ATTACK` triggers.

### 3.2 `proposeAndStack()` — only sync stack when a StackObject exists

`game-engine.ts` already guards `addToStack()` behind `if (result.stackObject)`. Since attack no longer returns a `stackObject`, this path is naturally skipped. **No change needed** — but verify the guard is present.

### 3.3 Resolution pipeline — remove attack-specific branches

Once attack leaves the stack, `applyStructuralZoneChange()` still needs the `'activated'`/`'triggered'` branch for **real** activated abilities (e.g. `GRANT_STATS` on Crimson Hellkite). The branch is now correct and general — **keep it**. The `PERMANENT_ENTERED` gating on `type === 'spell'` is also correct — **keep it**.

The only cleanup: the comments referencing "an attacking creature" should be generalized to "an activated/triggered ability's source."

### 3.4 `attackHandler.resolve()` — remove dead code

Delete the `resolve()` method (or leave it as a no-op if the `ActionHandler` interface requires it). Verify the interface.

### 3.5 Client — no change

The client already sends `playerAction('attack', cardUuid, targets)`. The server now applies damage immediately instead of pushing to the stack. The `StackDisplay` will no longer show attack as a stack item — which is correct.

---

## 4. Impact on existing behavior

| Behavior | Before | After |
|----------|--------|-------|
| Attack on stack | Yes (`type: 'activated'`) | No |
| Priority window after attack | Yes (opponent could respond) | No (immediate) |
| `ATTACK_DECLARED` trigger | Fires after propose | Fires after propose (unchanged) |
| Combat damage | Via `MODIFY_STATS` effect on stack | Via `SET_DAMAGE` mutation directly |
| SBA check | After stack resolution | After `proposeAndStack` applies mutations |
| `ON_ATTACK` / `ON_DAMAGE_TAKEN` / `ON_DIE` | Work | Work (unchanged) |

---

## 5. Files to change

- `src/engine/handlers/attack-handler.ts` — rewrite `propose()` to return mutations directly; remove `StackObject`; remove dead `resolve()`.
- `src/engine/effect-resolver.ts` — generalize comments (no functional change).
- `tests/engine/attack-handler.test.ts` — update tests that assert `stackObject` exists.
- `tests/engine/combat-integration.test.ts` — update to assert no stack item for attack; assert damage applied directly.
- `tests/engine/state-machine.test.ts` — verify no `Stack` phase transition on attack.

---

## 6. Out of scope

- Full MTG combat phase (declare attackers step, declare blockers step, combat damage step) — see Option 3 spec.
- Blocking mechanics.
- First-strike / double-strike / lifelink / deathtouch.
- Priority windows (deferred by user).

---

## 7. Verification

- `npx vitest run` — all tests pass.
- `npx tsc --noEmit` — clean.
- Integration test asserts: attack applies damage immediately, no stack item, SBA kills defender, `ON_DIE` fires.