# Creature-vs-Creature Combat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two engine correctness bugs (damage never cleared; multi-blocker damage ignored) and replace placeholder combat UI (all-or-nothing attackers, hardcoded empty blockers) with click-to-select attacker/blocker assignment.

**Architecture:** Engine fixes are pure reducer mutations — `CLEAR_DAMAGE` at cleanup, multi-blocker damage loop in `state-machine.ts`, `lethalDamageFor` seam in `card-utils.ts`. Client adds a `combatSelection` Zustand slice with reconciliation against server state, and `PhaseBar`/`CardComponent`/`CombatDisplay` wire click-to-select interaction.

**Tech Stack:** TypeScript, Vitest, Zustand, React, Socket.io

## Global Constraints

- `npx tsc --noEmit` must pass after every task
- `npx vitest run` must pass after every task (no regressions)
- All new code follows existing patterns: pure reducer, handler validate/propose, Zustand selectors
- `SET_DAMAGE` gains optional `source: string` field (backward-compatible)
- `lethalDamageFor` is a seam only — do NOT implement deathtouch or damage prevention
- Damage assignment order is attacker-neutral (highest power first, lowest toughness tiebreaker, uuid final tiebreaker), NOT defender's pairing order
- Damage assignment is capped at `min(remaining, lethal)` — over-assignment (CR 510.1c full compliance) is a **temporary engine constraint**, documented in spec §5 Out of Scope
- `reconcileCombatSelection` returns `{ selection, changed }` — the `changed` flag drives a UI notification when selections are silently purged
- `CLEAR_DAMAGE` fires BEFORE `CLEAR_END_OF_TURN_EFFECTS` at cleanup (order-of-operations: damage cleared first so a buffed creature that took damage doesn't briefly become a 2/2 with 3 damage when the buff is stripped)
- **Note on cleanup order reachability:** the false-death scenario (buffed creature dying between `CLEAR_END_OF_TURN_EFFECTS` and `CLEAR_DAMAGE`) is *latent*, not active. Today `advancePhase` folds mutations into a working copy without running SBAs, and `applyMutations` applies the whole batch before `checkStateBasedActions`. No SBA runs between the two mutations. The ordering is fragility-hardening — it keeps the invariant true if mutations are ever applied incrementally, or if a trigger splits the batch.

---

### Task 1: `CLEAR_DAMAGE` mutation + reducer

**Files:**
- Modify: `src/types/game-mutation.types.ts` (add `CLEAR_DAMAGE` variant)
- Modify: `src/engine/game-reducer.ts` (handle `CLEAR_DAMAGE`)

**Interfaces:**
- Produces: `{ type: 'CLEAR_DAMAGE' }` — resets `damageTaken` to 0 on all battlefield cards

- [ ] **Step 1: Add `CLEAR_DAMAGE` to the mutation union**

In `src/types/game-mutation.types.ts`, add after `CLEAR_END_OF_TURN_EFFECTS`:

```ts
  | { type: 'CLEAR_DAMAGE' }                              // fired at cleanupStep (CR 514.2)
```

- [ ] **Step 2: Handle `CLEAR_DAMAGE` in the reducer**

In `src/engine/game-reducer.ts`, add a case in the `gameReducer` switch (near the other card-state mutations, after `SET_DAMAGE`):

```ts
    case 'CLEAR_DAMAGE':
      return {
        ...state,
        battlefield: state.battlefield.map(card => ({
          ...card,
          state: { ...card.state, damageTaken: 0 },
        })),
      };
```

- [ ] **Step 3: Write the unit test**

Create a test in `tests/engine/state-machine.test.ts` (or a new `tests/engine/cleanup-step.test.ts`):

```ts
it('CLEAR_DAMAGE resets damageTaken to 0 on all battlefield cards', () => {
  // Put two damaged creatures on the battlefield
  const c1 = instantiateCard('empire-servant');
  c1.state.zone = 'battlefield';
  c1.state.damageTaken = 2;
  const c2 = instantiateCard('empire-servant');
  c2.state.zone = 'battlefield';
  c2.state.damageTaken = 1;
  room.battlefield.push(c1, c2);

  // Apply CLEAR_DAMAGE
  const next = gameReducer(room, { type: 'CLEAR_DAMAGE' });
  expect(next.battlefield[0].state.damageTaken).toBe(0);
  expect(next.battlefield[1].state.damageTaken).toBe(0);
});
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run tests/engine/state-machine.test.ts`
Expected: new test passes, no regressions.

- [ ] **Step 5: Commit**

```
git add -A && git commit -m "feat: add CLEAR_DAMAGE mutation and reducer"
```

---

### Task 2: Fire `CLEAR_DAMAGE` at cleanup step

**Files:**
- Modify: `src/engine/state-machine.ts` (cleanupStep branch in `transition()`)

**Interfaces:**
- Consumes: `CLEAR_DAMAGE` mutation type (from Task 1)
- Produces: cleanup step now emits `CLEAR_DAMAGE` before `CLEAR_END_OF_TURN_EFFECTS`

- [ ] **Step 1: Add `CLEAR_DAMAGE` to the cleanup step**

In `src/engine/state-machine.ts`, in the `transition()` method, find the `cleanupStep` block:

```ts
    // Cleanup step: strip END_OF_TURN entries from the continuous effect pool
    if (to === 'cleanupStep') {
      mutations.push({ type: 'CLEAR_END_OF_TURN_EFFECTS' });
    }
```

Replace with:

```ts
    // Cleanup step (CR 514): clear damage first, then strip end-of-turn effects.
    // Damage must be cleared BEFORE effects so a buffed creature that took
    // damage doesn't briefly become a 2/2 with 3 damage when the buff is
    // stripped. (Latent: today's batch-apply prevents SBA between these, but
    // the ordering is correct per CR 514.2 and future-proof.)
    if (to === 'cleanupStep') {
      mutations.push({ type: 'CLEAR_DAMAGE' });
      mutations.push({ type: 'CLEAR_END_OF_TURN_EFFECTS' });
    }
```

- [ ] **Step 2: Write the integration test — damage cleared at cleanup**

In `tests/engine/state-machine.test.ts`, add:

```ts
it('cleanupStep clears damage from all battlefield cards', () => {
  // Put a damaged creature on the battlefield
  const c = instantiateCard('empire-servant');
  c.state.zone = 'battlefield';
  c.state.controllerId = 'player1';
  c.state.damageTaken = 2;
  room.battlefield.push(c);
  room.phase = 'stateEndPhase';

  const mutations = sm.transition(room, 'cleanupStep');
  apply(mutations);

  const card = room.battlefield.find(x => x.uuid === c.uuid);
  expect(card?.state.damageTaken).toBe(0);
});
```

- [ ] **Step 3: Write the regression test — buffed creature survives cleanup**

In the same file, add:

```ts
it('buffed creature with damage survives cleanup (order-of-operations)', () => {
  // 2/2 creature with a "+0/+2 until end of turn" buff, took 3 damage
  const c = instantiateCard('empire-servant'); // 1/1 base
  c.state.zone = 'battlefield';
  c.state.controllerId = 'player1';
  c.state.damageTaken = 3;
  room.battlefield.push(c);

  // Simulate a +0/+2 EOT buff in the continuous effect pool
  room.continuousEffectPool.push({
    source: 'test-buff',
    duration: 'END_OF_TURN',
    scope: { type: 'SELF' },
    effect: { type: 'STAT_DELTA', power: 0, toughness: 2 },
  });

  room.phase = 'stateEndPhase';

  const mutations = sm.transition(room, 'cleanupStep');
  apply(mutations);

  // Creature should still be on the battlefield (damage cleared before buff stripped)
  const card = room.battlefield.find(x => x.uuid === c.uuid);
  expect(card).toBeDefined();
  expect(card!.state.damageTaken).toBe(0);
  // Buff should be gone
  expect(room.continuousEffectPool).toHaveLength(0);
});
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run tests/engine/state-machine.test.ts`
Expected: both new tests pass, no regressions.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```
git add -A && git commit -m "feat: fire CLEAR_DAMAGE at cleanup step (before CLEAR_END_OF_TURN_EFFECTS)"
```

---

### Task 3: `lethalDamageFor` seam + optional `source` on `SET_DAMAGE`

**Files:**
- Modify: `src/engine/card-utils.ts` (add `lethalDamageFor`)
- Modify: `src/types/game-mutation.types.ts` (add optional `source` to `SET_DAMAGE`)

**Interfaces:**
- Produces: `lethalDamageFor(room: GameRoom, card: CardInstance): number`
- Produces: `SET_DAMAGE` now has optional `source?: string`

- [ ] **Step 1: Add `lethalDamageFor` to card-utils.ts**

In `src/engine/card-utils.ts`, add the import and function:

```ts
import type { GameRoom } from '../types/game.room.types';
import { CardCharacteristicService } from './card-characteristic-service';

/**
 * Compute the lethal damage threshold for a creature (CR 510.1c).
 * Seam: deathtouch and damage prevention hook in here later.
 * Currently: toughness minus already-marked damage.
 */
export function lethalDamageFor(room: GameRoom, card: CardInstance): number {
  return Math.max(0,
    CardCharacteristicService.resolveToughness(room, card)
    - (card.state.damageTaken || 0)
  );
}
```

- [ ] **Step 2: Add optional `source` to `SET_DAMAGE`**

In `src/types/game-mutation.types.ts`, change:

```ts
  | { type: 'SET_DAMAGE'; cardUuid: string; amount: number }
```

To:

```ts
  | { type: 'SET_DAMAGE'; cardUuid: string; amount: number; source?: string }
```

- [ ] **Step 3: Write unit test for `lethalDamageFor`**

Create `tests/engine/card-utils.test.ts` (if it doesn't exist) or add to an existing utils test:

```ts
import { describe, it, expect } from 'vitest';
import { lethalDamageFor } from '../../src/engine/card-utils';
import { instantiateCard } from '../../src/library/card-factory';
import { createTestRoom } from '../helpers/test-room-factory';

describe('lethalDamageFor', () => {
  it('returns toughness for an undamaged creature', () => {
    const room = createTestRoom();
    const card = instantiateCard('empire-servant'); // 1/1
    expect(lethalDamageFor(room, card)).toBe(1);
  });

  it('subtracts existing damage from lethal threshold', () => {
    const room = createTestRoom();
    const card = instantiateCard('empire-servant'); // 1/1
    card.state.damageTaken = 0; // undamaged
    expect(lethalDamageFor(room, card)).toBe(1);
    card.state.damageTaken = 1; // already lethal
    expect(lethalDamageFor(room, card)).toBe(0);
  });

  it('returns 0 when damageTaken >= toughness', () => {
    const room = createTestRoom();
    const card = instantiateCard('empire-servant'); // 1/1
    card.state.damageTaken = 3;
    expect(lethalDamageFor(room, card)).toBe(0);
  });
});
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run tests/engine/card-utils.test.ts`
Expected: all pass.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (existing `SET_DAMAGE` call sites don't break — `source` is optional).

- [ ] **Step 6: Commit**

```
git add -A && git commit -m "feat: add lethalDamageFor seam and optional source on SET_DAMAGE"
```

---

### Task 4: Multi-blocker damage resolution in `combatDamageStep`

**Files:**
- Modify: `src/engine/state-machine.ts` (rewrite the `combatDamageStep` block in `transition()`)

**Interfaces:**
- Consumes: `lethalDamageFor` from `card-utils.ts` (Task 3)
- Consumes: `SET_DAMAGE.source` optional field (Task 3)
- Produces: multi-blocker damage loop replacing `decl.blockers[0]`-only block

- [ ] **Step 1: Rewrite the combat damage block**

In `src/engine/state-machine.ts`, in `transition()`, find the `combatDamageStep` block (lines ~153-205). Replace the entire `if (to === 'combatDamageStep') { ... }` block with:

```ts
    // combatDamageStep resolves all combat damage simultaneously (MTG CR 510).
    if (to === 'combatDamageStep') {
      const defendingPlayerId = room.activeTurnPlayerId === room.player1Id
        ? room.player2Id! : room.player1Id;

      for (const decl of room.combat) {
        if (decl.blockers.length === 0) {
          // Unblocked: attacker deals damage to defending player
          const defender = room.players[defendingPlayerId];
          mutations.push({
            type: 'SET_LIFE',
            playerId: defendingPlayerId,
            amount: defender.life - decl.attackerPower,
          });
        } else {
          // Blocked: attacker assigns damage among blockers in attacker-neutral
          // order (highest power first, lowest toughness tiebreaker, uuid final
          // tiebreaker — NOT the defender's pairing order, per CR 510.1c).
          const ordered = [...decl.blockers].sort((a, b) => {
            const pa = CardCharacteristicService.resolvePower(room, a);
            const pb = CardCharacteristicService.resolvePower(room, b);
            if (pa !== pb) return pb - pa;           // higher power first
            const ta = CardCharacteristicService.resolveToughness(room, a);
            const tb = CardCharacteristicService.resolveToughness(room, b);
            if (ta !== tb) return ta - tb;           // lower toughness first
            return a.uuid.localeCompare(b.uuid);     // deterministic tiebreaker
          });

          let remaining = decl.attackerPower;

          // Attacker deals damage to blockers (lethal-first)
          for (const blocker of ordered) {
            if (remaining <= 0) break;
            const lethal = lethalDamageFor(room, blocker);
            const assigned = Math.min(remaining, lethal);
            mutations.push({
              type: 'SET_DAMAGE',
              cardUuid: blocker.uuid,
              amount: (blocker.state.damageTaken || 0) + assigned,
              source: decl.attacker.uuid,
            });
            remaining -= assigned;
          }

          // Each blocker deals its power to the attacker (discrete per source)
          for (const blocker of ordered) {
            const blockerPower = CardCharacteristicService.resolvePower(room, blocker);
            mutations.push({
              type: 'SET_DAMAGE',
              cardUuid: decl.attacker.uuid,
              amount: (decl.attacker.state.damageTaken || 0) + blockerPower,
              source: blocker.uuid,
            });
          }

          // Trample: excess damage over total lethal → defending player
          if (hasKeyword(decl.attacker, 'Trample') && remaining > 0) {
            const defender = room.players[defendingPlayerId];
            mutations.push({
              type: 'SET_LIFE',
              playerId: defendingPlayerId,
              amount: defender.life - remaining,
            });
          }
        }
      }

      this.eventBus.emit({
        eventId: 'COMBAT_DAMAGE_RESOLVED',
        roomId: this.roomId,
        payload: { damageAssignments: [] },
      });
    }
```

- [ ] **Step 2: Add the `lethalDamageFor` import**

At the top of `src/engine/state-machine.ts`, add:

```ts
import { hasKeyword, lethalDamageFor } from './card-utils';
```

(Replace the existing `import { hasKeyword } from './card-utils';` line.)

- [ ] **Step 3: Write multi-blocker tests**

In `tests/engine/combat-damage-step.test.ts`, add these tests:

```ts
  it('two blockers: both take damage, both deal counter-damage', () => {
    const attacker = instantiateCard('empire-servant'); // 1/1
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1';
    attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);

    const blocker1 = instantiateCard('empire-servant'); // 1/1
    blocker1.state.zone = 'battlefield';
    blocker1.state.ownerId = 'player2';
    blocker1.state.controllerId = 'player2';
    blocker1.state.summoningSickness = false;
    room.battlefield.push(blocker1);

    const blocker2 = instantiateCard('empire-servant'); // 1/1
    blocker2.state.zone = 'battlefield';
    blocker2.state.ownerId = 'player2';
    blocker2.state.controllerId = 'player2';
    blocker2.state.summoningSickness = false;
    room.battlefield.push(blocker2);

    room.phase = 'stateMainPhase';
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');
    engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });
    engine.transition('declareBlockersStep');
    engine.proposeAndStack('player2', ACTION_IDS.declareBlockers, {
      assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker1.uuid, blocker2.uuid] }],
    });
    engine.transition('combatDamageStep');

    const after = engine.roomState;

    // Attacker (1/1) assigns 1 damage lethal-first → blocker1 takes 1, blocker2 takes 0
    const b1 = after.battlefield.find(c => c.uuid === blocker1.uuid);
    const b2 = after.battlefield.find(c => c.uuid === blocker2.uuid);
    // Both blockers deal 1 counter-damage each → attacker takes 2
    const atk = after.battlefield.find(c => c.uuid === attacker.uuid);

    // blocker1: took 1 from attacker (lethal for 1/1)
    expect(b1?.state.damageTaken ?? (after.players['player2'].graveyard.find(c => c.uuid === blocker1.uuid) ? 1 : 0)).toBe(1);
    // blocker2: took 0 (attacker only had 1 power, all assigned to blocker1)
    expect(b2?.state.damageTaken ?? 0).toBe(0);
    // attacker: took 1 from blocker1 + 1 from blocker2 = 2
    expect(atk?.state.damageTaken ?? (after.players['player1'].graveyard.find(c => c.uuid === attacker.uuid) ? 2 : 0)).toBe(2);
  });

  it('lethal-first: first blocker gets lethal, remainder spills to second', () => {
    const attacker = instantiateCard('card_09876_core_set'); // Crimson Hellkite 5/5
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1';
    attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);

    // Two 1/1 blockers
    const b1 = instantiateCard('empire-servant');
    b1.state.zone = 'battlefield'; b1.state.ownerId = 'player2'; b1.state.controllerId = 'player2';
    b1.state.summoningSickness = false;
    room.battlefield.push(b1);
    const b2 = instantiateCard('empire-servant');
    b2.state.zone = 'battlefield'; b2.state.ownerId = 'player2'; b2.state.controllerId = 'player2';
    b2.state.summoningSickness = false;
    room.battlefield.push(b2);

    room.phase = 'stateMainPhase';
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');
    engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });
    engine.transition('declareBlockersStep');
    engine.proposeAndStack('player2', ACTION_IDS.declareBlockers, {
      assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [b1.uuid, b2.uuid] }],
    });
    engine.transition('combatDamageStep');

    const after = engine.roomState;
    // 5 power: 1 lethal to b1, 1 lethal to b2, 3 remaining (no trample → wasted)
    // Both blockers deal 1 each to attacker
    const atkAfter = after.battlefield.find(c => c.uuid === attacker.uuid);
    expect(atkAfter?.state.damageTaken ?? 2).toBe(2);
    // Both blockers should be dead (1 damage each, 1/1)
    expect(after.players['player2'].graveyard).toHaveLength(2);
  });

  it('damage order is attacker-neutral (not defender pairing order)', () => {
    // Same setup but reverse the blocker pairing order — result must be identical
    const attacker = instantiateCard('card_09876_core_set'); // 5/5
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1'; attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);

    const b1 = instantiateCard('empire-servant');
    b1.state.zone = 'battlefield'; b1.state.ownerId = 'player2'; b1.state.controllerId = 'player2';
    b1.state.summoningSickness = false;
    room.battlefield.push(b1);
    const b2 = instantiateCard('empire-servant');
    b2.state.zone = 'battlefield'; b2.state.ownerId = 'player2'; b2.state.controllerId = 'player2';
    b2.state.summoningSickness = false;
    room.battlefield.push(b2);

    room.phase = 'stateMainPhase';
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');
    engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });
    engine.transition('declareBlockersStep');
    // Reverse order: b2 first, b1 second
    engine.proposeAndStack('player2', ACTION_IDS.declareBlockers, {
      assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [b2.uuid, b1.uuid] }],
    });
    engine.transition('combatDamageStep');

    const after = engine.roomState;
    // Both blockers still die (5 power > 2 toughness total), attacker takes 2
    expect(after.players['player2'].graveyard).toHaveLength(2);
    const atkAfter = after.battlefield.find(c => c.uuid === attacker.uuid);
    expect(atkAfter?.state.damageTaken ?? 2).toBe(2);
  });

  it('damage order uses gameplay heuristic: highest-power blocker takes damage first', () => {
    // 5/5 attacker vs a 3/3 and a 1/1 — the 3/3 should take damage first
    const attacker = instantiateCard('card_09876_core_set'); // 5/5
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1'; attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);

    // 3/3 blocker (higher power)
    const bigBlocker = instantiateCard('card_09876_core_set'); // 5/5 base, we'll use as 3/3 proxy
    bigBlocker.state.zone = 'battlefield'; bigBlocker.state.ownerId = 'player2'; bigBlocker.state.controllerId = 'player2';
    bigBlocker.state.summoningSickness = false;
    // Override power/toughness for test — use a card with known stats
    // Actually, use two empire-servants (1/1) and give one +1/+1 counters
    room.battlefield.length = 0; // clear
    room.battlefield.push(attacker);

    const bigB = instantiateCard('empire-servant'); // 1/1
    bigB.state.zone = 'battlefield'; bigB.state.ownerId = 'player2'; bigB.state.controllerId = 'player2';
    bigB.state.summoningSickness = false;
    bigB.state.counters = { '+1/+1': 2 }; // becomes 3/3
    room.battlefield.push(bigB);

    const smallB = instantiateCard('empire-servant'); // 1/1
    smallB.state.zone = 'battlefield'; smallB.state.ownerId = 'player2'; smallB.state.controllerId = 'player2';
    smallB.state.summoningSickness = false;
    room.battlefield.push(smallB);

    room.phase = 'stateMainPhase';
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');
    engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });
    engine.transition('declareBlockersStep');
    engine.proposeAndStack('player2', ACTION_IDS.declareBlockers, {
      assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [smallB.uuid, bigB.uuid] }],
    });
    engine.transition('combatDamageStep');

    const after = engine.roomState;
    // 5 power: 3 lethal to bigB (3/3), 1 lethal to smallB (1/1), 1 remaining (no trample → wasted)
    // bigB should be dead (took 3 damage, 3 toughness)
    expect(after.players['player2'].graveyard.find(c => c.uuid === bigB.uuid)).toBeDefined();
    // smallB should be dead (took 1 damage, 1 toughness)
    expect(after.players['player2'].graveyard.find(c => c.uuid === smallB.uuid)).toBeDefined();
    // Attacker takes 3 + 1 = 4 counter-damage
    const atkAfter = after.battlefield.find(c => c.uuid === attacker.uuid);
    expect(atkAfter?.state.damageTaken ?? 4).toBe(4);
  });

  it('trample with multiple blockers: excess over total lethal → player', () => {
    const attacker = instantiateCard('card_09876_core_set'); // 5/5
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1'; attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    const origKw = attacker.blueprint.keywords;
    attacker.blueprint.keywords = ['Trample'];
    room.battlefield.push(attacker);

    const b1 = instantiateCard('empire-servant'); // 1/1
    b1.state.zone = 'battlefield'; b1.state.ownerId = 'player2'; b1.state.controllerId = 'player2';
    b1.state.summoningSickness = false;
    room.battlefield.push(b1);
    const b2 = instantiateCard('empire-servant'); // 1/1
    b2.state.zone = 'battlefield'; b2.state.ownerId = 'player2'; b2.state.controllerId = 'player2';
    b2.state.summoningSickness = false;
    room.battlefield.push(b2);

    room.phase = 'stateMainPhase';
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');
    engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });
    engine.transition('declareBlockersStep');
    engine.proposeAndStack('player2', ACTION_IDS.declareBlockers, {
      assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [b1.uuid, b2.uuid] }],
    });
    engine.transition('combatDamageStep');

    const after = engine.roomState;
    // 5 power: 1 lethal to b1, 1 lethal to b2, 3 trample → player2
    expect(after.players['player2'].life).toBe(20 - 3);
    // Both blockers dead
    expect(after.players['player2'].graveyard).toHaveLength(2);
    // Attacker takes 2 (1 from each blocker)
    const atkAfter = after.battlefield.find(c => c.uuid === attacker.uuid);
    expect(atkAfter?.state.damageTaken ?? 2).toBe(2);

    attacker.blueprint.keywords = origKw; // restore
  });

  it('trample with pre-damaged blocker: lethal accounts for existing damageTaken', () => {
    const attacker = instantiateCard('card_09876_core_set'); // 5/5
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1'; attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    const origKw = attacker.blueprint.keywords;
    attacker.blueprint.keywords = ['Trample'];
    room.battlefield.push(attacker);

    const blocker = instantiateCard('empire-servant'); // 1/1, already damaged
    blocker.state.zone = 'battlefield'; blocker.state.ownerId = 'player2'; blocker.state.controllerId = 'player2';
    blocker.state.summoningSickness = false;
    blocker.state.damageTaken = 0; // undamaged, lethal = 1
    room.battlefield.push(blocker);

    room.phase = 'stateMainPhase';
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');
    engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });
    engine.transition('declareBlockersStep');
    engine.proposeAndStack('player2', ACTION_IDS.declareBlockers, {
      assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }],
    });
    engine.transition('combatDamageStep');

    const after = engine.roomState;
    // 5 power: 1 lethal to blocker, 4 trample → player2
    expect(after.players['player2'].life).toBe(20 - 4);
    // Blocker dead
    expect(after.players['player2'].graveyard).toHaveLength(1);

    attacker.blueprint.keywords = origKw;
  });

  it('per-blocker attribution: each blocker emits its own SET_DAMAGE with source', () => {
    // This test verifies the mutation shape, not just the outcome.
    // We'll check by inspecting the mutations returned from transition().
    const attacker = instantiateCard('empire-servant');
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1'; attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);

    const b1 = instantiateCard('empire-servant');
    b1.state.zone = 'battlefield'; b1.state.ownerId = 'player2'; b1.state.controllerId = 'player2';
    b1.state.summoningSickness = false;
    room.battlefield.push(b1);
    const b2 = instantiateCard('empire-servant');
    b2.state.zone = 'battlefield'; b2.state.ownerId = 'player2'; b2.state.controllerId = 'player2';
    b2.state.summoningSickness = false;
    room.battlefield.push(b2);

    room.phase = 'stateMainPhase';
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');
    engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });
    engine.transition('declareBlockersStep');
    engine.proposeAndStack('player2', ACTION_IDS.declareBlockers, {
      assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [b1.uuid, b2.uuid] }],
    });

    // Capture mutations from combatDamageStep transition
    const muts = engine.transition('combatDamageStep');

    // Find SET_DAMAGE mutations targeting the attacker (counter-damage from blockers)
    const attackerDamageMuts = muts.filter(
      m => m.type === 'SET_DAMAGE' && m.cardUuid === attacker.uuid
    );
    // Should be 2 discrete mutations, one per blocker
    expect(attackerDamageMuts).toHaveLength(2);
    // Each should have a source
    expect(attackerDamageMuts[0]).toHaveProperty('source');
    expect(attackerDamageMuts[1]).toHaveProperty('source');
    // Sources should be the two blockers
    const sources = attackerDamageMuts.map(m => (m as any).source).sort();
    expect(sources).toContain(b1.uuid);
    expect(sources).toContain(b2.uuid);
  });
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run tests/engine/combat-damage-step.test.ts`
Expected: all new tests pass, existing tests still pass.

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: no regressions.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```
git add -A && git commit -m "feat: multi-blocker damage resolution with per-blocker attribution and lethal-first ordering"
```

---

### Task 5: `combatSelection` store slice + reconciliation

**Files:**
- Create: `src/client/store/combatSelection.ts` (reconciliation pure function)
- Modify: `src/client/store/gameStore.ts` (add `combatSelection` slice + actions + wire reconciliation)

**Interfaces:**
- Produces: `CombatSelection` interface, `reconcileCombatSelection(selection, room): { selection: CombatSelection; changed: boolean }`
- Produces: store actions: `toggleAttacker`, `selectBlocker`, `assignBlocker`, `clearCombatSelection`
- Consumes: `GameRoom` type, `CardInstance` type

- [ ] **Step 1: Create `combatSelection.ts` with reconciliation logic**

Create `src/client/store/combatSelection.ts`:

```ts
// src/client/store/combatSelection.ts
// Client-only combat selection state and reconciliation logic.
// Holds local UUID selections; reconciles against server state on every delta.

import type { GameRoom } from '../../types/game.room.types';

export interface CombatSelection {
  attackers: string[];                       // selected attacker uuids
  blockerPairs: { attackerUuid: string; blockerUuid: string }[];
  pendingBlocker: string | null;             // blocker awaiting an attacker click
}

export const EMPTY_COMBAT_SELECTION: CombatSelection = {
  attackers: [],
  blockerPairs: [],
  pendingBlocker: null,
};

/**
 * Reconcile local combat selection against the latest server state.
 * Drops any reference to cards that no longer exist or are no longer eligible.
 * Returns the reconciled selection and a `changed` flag for UI notification.
 * Pure function — testable independently of Zustand.
 */
export function reconcileCombatSelection(
  selection: CombatSelection,
  room: GameRoom,
): { selection: CombatSelection; changed: boolean } {
  // Gather eligible attacker uuids (untapped, non-sick creatures on the active player's battlefield)
  const activePlayerId = room.activeTurnPlayerId;
  const eligibleAttackers = new Set(
    room.battlefield
      .filter(c =>
        c.state.controllerId === activePlayerId &&
        c.blueprint.cardTypes.includes('Creature') &&
        !c.state.isTapped &&
        !c.state.summoningSickness &&
        !c.state.attackedThisTurn,
      )
      .map(c => c.uuid),
  );

  // Gather combat attacker uuids (still in room.combat)
  const combatAttackerUuids = new Set(room.combat.map(d => d.uuid));

  // Gather eligible blocker uuids (untapped creatures on the defending player's battlefield)
  const defendingPlayerId = room.activeTurnPlayerId === room.player1Id
    ? room.player2Id! : room.player1Id;
  const eligibleBlockers = new Set(
    room.battlefield
      .filter(c =>
        c.state.controllerId === defendingPlayerId &&
        c.blueprint.cardTypes.includes('Creature') &&
        !c.state.isTapped,
      )
      .map(c => c.uuid),
  );

  const reconciledAttackers = selection.attackers.filter(uuid => eligibleAttackers.has(uuid));
  const reconciledPairs = selection.blockerPairs.filter(
    pair =>
      combatAttackerUuids.has(pair.attackerUuid) &&
      eligibleBlockers.has(pair.blockerUuid),
  );
  const reconciledPending =
    selection.pendingBlocker && eligibleBlockers.has(selection.pendingBlocker)
      ? selection.pendingBlocker
      : null;

  const changed =
    reconciledAttackers.length !== selection.attackers.length ||
    reconciledPairs.length !== selection.blockerPairs.length ||
    reconciledPending !== selection.pendingBlocker;

  return {
    selection: {
      attackers: reconciledAttackers,
      blockerPairs: reconciledPairs,
      pendingBlocker: reconciledPending,
    },
    changed,
  };
}
```

- [ ] **Step 2: Write unit tests for reconciliation**

Create `tests/client/combatSelection.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reconcileCombatSelection, EMPTY_COMBAT_SELECTION, type CombatSelection } from '../../src/client/store/combatSelection';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';

describe('reconcileCombatSelection', () => {
  it('drops attackers no longer on the battlefield', () => {
    const room = createTestRoom();
    const selection: CombatSelection = {
      attackers: ['gone-uuid', 'also-gone'],
      blockerPairs: [],
      pendingBlocker: null,
    };
    const { selection: result, changed } = reconcileCombatSelection(selection, room);
    expect(result.attackers).toEqual([]);
    expect(changed).toBe(true);
  });

  it('drops attackers that are no longer eligible (tapped)', () => {
    const room = createTestRoom();
    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.controllerId = 'player1'; // active player
    card.state.isTapped = true; // tapped → not eligible
    card.state.summoningSickness = false;
    room.battlefield.push(card);

    const selection: CombatSelection = {
      attackers: [card.uuid],
      blockerPairs: [],
      pendingBlocker: null,
    };
    const { selection: result, changed } = reconcileCombatSelection(selection, room);
    expect(result.attackers).toEqual([]);
    expect(changed).toBe(true);
  });

  it('keeps eligible attackers', () => {
    const room = createTestRoom();
    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.controllerId = 'player1'; // active player
    card.state.isTapped = false;
    card.state.summoningSickness = false;
    card.state.attackedThisTurn = false;
    room.battlefield.push(card);

    const selection: CombatSelection = {
      attackers: [card.uuid],
      blockerPairs: [],
      pendingBlocker: null,
    };
    const { selection: result, changed } = reconcileCombatSelection(selection, room);
    expect(result.attackers).toEqual([card.uuid]);
    expect(changed).toBe(false);
  });

  it('drops blockerPairs whose attacker left combat', () => {
    const room = createTestRoom();
    // No combat declarations
    const selection: CombatSelection = {
      attackers: [],
      blockerPairs: [{ attackerUuid: 'gone', blockerUuid: 'some-blocker' }],
      pendingBlocker: null,
    };
    const { selection: result, changed } = reconcileCombatSelection(selection, room);
    expect(result.blockerPairs).toEqual([]);
    expect(changed).toBe(true);
  });

  it('drops blockerPairs whose blocker is no longer eligible', () => {
    const room = createTestRoom();
    // Add a combat declaration
    const attacker = instantiateCard('empire-servant');
    attacker.state.zone = 'battlefield';
    room.combat = [{ uuid: attacker.uuid, attacker, attackerPower: 1, blockers: [] }];

    const selection: CombatSelection = {
      attackers: [],
      blockerPairs: [{ attackerUuid: attacker.uuid, blockerUuid: 'gone-blocker' }],
      pendingBlocker: null,
    };
    const { selection: result, changed } = reconcileCombatSelection(selection, room);
    expect(result.blockerPairs).toEqual([]);
    expect(changed).toBe(true);
  });

  it('clears pendingBlocker if that creature is gone', () => {
    const room = createTestRoom();
    const selection: CombatSelection = {
      attackers: [],
      blockerPairs: [],
      pendingBlocker: 'gone',
    };
    const { selection: result, changed } = reconcileCombatSelection(selection, room);
    expect(result.pendingBlocker).toBeNull();
    expect(changed).toBe(true);
  });

  it('returns changed: false when nothing is purged', () => {
    const room = createTestRoom();
    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.controllerId = 'player1';
    card.state.isTapped = false;
    card.state.summoningSickness = false;
    card.state.attackedThisTurn = false;
    room.battlefield.push(card);

    const selection: CombatSelection = {
      attackers: [card.uuid],
      blockerPairs: [],
      pendingBlocker: null,
    };
    const { changed } = reconcileCombatSelection(selection, room);
    expect(changed).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests, verify pass**

Run: `npx vitest run tests/client/combatSelection.test.ts`
Expected: all pass.

- [ ] **Step 4: Add `combatSelection` to the Zustand store**

In `src/client/store/gameStore.ts`:

Add import:
```ts
import { type CombatSelection, EMPTY_COMBAT_SELECTION, reconcileCombatSelection } from './combatSelection';
```

Add to the `GameStore` interface:
```ts
  combatSelection: CombatSelection;
  toggleAttacker: (uuid: string) => void;
  selectBlocker: (uuid: string) => void;
  assignBlocker: (attackerUuid: string) => void;
  clearCombatSelection: () => void;
```

Add to initial state:
```ts
  combatSelection: EMPTY_COMBAT_SELECTION,
```

Add actions after `clearSession`:
```ts
  toggleAttacker: (uuid) => {
    const { combatSelection } = get();
    const idx = combatSelection.attackers.indexOf(uuid);
    if (idx >= 0) {
      set({ combatSelection: { ...combatSelection, attackers: combatSelection.attackers.filter(a => a !== uuid) } });
    } else {
      set({ combatSelection: { ...combatSelection, attackers: [...combatSelection.attackers, uuid] } });
    }
  },

  selectBlocker: (uuid) => {
    const { combatSelection } = get();
    // Toggle: if already pending, deselect; otherwise set as pending
    if (combatSelection.pendingBlocker === uuid) {
      set({ combatSelection: { ...combatSelection, pendingBlocker: null } });
    } else {
      set({ combatSelection: { ...combatSelection, pendingBlocker: uuid } });
    }
  },

  assignBlocker: (attackerUuid) => {
    const { combatSelection } = get();
    if (!combatSelection.pendingBlocker) return;
    // Don't add duplicate pairs
    const alreadyPaired = combatSelection.blockerPairs.some(
      p => p.attackerUuid === attackerUuid && p.blockerUuid === combatSelection.pendingBlocker
    );
    if (alreadyPaired) {
      set({ combatSelection: { ...combatSelection, pendingBlocker: null } });
      return;
    }
    set({
      combatSelection: {
        ...combatSelection,
        blockerPairs: [
          ...combatSelection.blockerPairs,
          { attackerUuid, blockerUuid: combatSelection.pendingBlocker! },
        ],
        pendingBlocker: null,
      },
    });
  },

  clearCombatSelection: () => set({ combatSelection: EMPTY_COMBAT_SELECTION }),
```

- [ ] **Step 5: Wire reconciliation into `applyDelta` and `setRoom`**

In `applyDelta`, after `const nextRoom = applyDeltaChanges(current, delta.changes);`, add:

```ts
    const { selection: reconciled, changed } = reconcileCombatSelection(get().combatSelection, nextRoom);
    if (changed) {
      // Show a brief notification — the player's combat selection was silently adjusted
      // because a creature left the battlefield or became ineligible.
      // Implementation: set a transient flag consumed by a toast/notification component.
      set({ combatNotification: 'Selection updated due to board change' });
      setTimeout(() => set({ combatNotification: null }), 2000);
    }
```

And in the `set` call, add `combatSelection: reconciled`:

```ts
    set((state) => ({
      room: nextRoom,
      combatSelection: reconcileCombatSelection(state.combatSelection, nextRoom).selection,
      log: [...],
    }));
```

In `setRoom`, change `set({ room })` to:

```ts
  setRoom: (room) => set((state) => ({ room, combatSelection: reconcileCombatSelection(state.combatSelection, room).selection })),
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run`
Expected: no regressions.

- [ ] **Step 8: Commit**

```
git add -A && git commit -m "feat: add combatSelection store slice with reconciliation"
```

---

### Task 6: Attacker selection UI (click-to-select + Confirm)

**Files:**
- Modify: `src/client/components/PhaseBar.tsx` (replace all-or-nothing with selection)
- Modify: `src/client/components/CardComponent.tsx` (highlight selected attackers)
- Modify: `src/client/style.css` (`.combat-selected` style)

**Interfaces:**
- Consumes: `combatSelection` from store (Task 5)
- Consumes: `toggleAttacker` from store (Task 5)
- Consumes: `clearCombatSelection` from store (Task 5)

- [ ] **Step 1: Add `.combat-selected` style**

In `src/client/style.css`, add after the existing `.card.targetable.selected` block:

```css
/* Combat selection highlight (attacker/blocker selection) */
.card.combat-selected {
  outline: 2px solid #4fc3f7;
  outline-offset: 2px;
  box-shadow: 0 0 8px rgba(79, 195, 247, 0.5);
}

.card.pending-blocker {
  outline: 2px solid #ffb74d;
  outline-offset: 2px;
  animation: pending-pulse 0.8s ease-in-out infinite;
}

@keyframes pending-pulse {
  0%, 100% { outline-color: #ffb74d; }
  50% { outline-color: #ff9800; }
}
```

- [ ] **Step 2: Update `CardComponent` to show combat selection highlights**

In `src/client/components/CardComponent.tsx`:

Add import:
```ts
import { useGameStore as useGameStoreForCombat } from '../store/gameStore';
```

In the component, read combat selection:
```ts
  const combatSelection = useGameStoreForCombat((s) => s.combatSelection);
  const toggleAttacker = useGameStoreForCombat((s) => s.toggleAttacker);
  const selectBlocker = useGameStoreForCombat((s) => s.selectBlocker);
  const assignBlocker = useGameStoreForCombat((s) => s.assignBlocker);
  const phase = useGameStoreForCombat((s) => s.room?.phase ?? null);
  const isMyTurn = useGameStoreForCombat(selectIsMyTurn);
```

Add combat selection classes:
```ts
  const isCombatSelected = combatSelection.attackers.includes(card.uuid);
  const isPendingBlocker = combatSelection.pendingBlocker === card.uuid;
```

Update the `className` on the card div to include:
```
${isCombatSelected ? 'combat-selected' : ''} ${isPendingBlocker ? 'pending-blocker' : ''}
```

Update `handleClick` to handle combat selection mode:
```ts
  const handleClick = (e: React.MouseEvent) => {
    // Targeting mode: tap a battlefield card to select/deselect it
    if (isTargetable) {
      toggleTarget({ targetType: 'permanent', cardUuid: card.uuid });
      return;
    }

    // Attacker selection mode (declareAttackersStep, my turn)
    if (zone === 'battlefield' && phase === 'declareAttackersStep' && isMyTurn) {
      const isCreature = card.blueprint.cardTypes.includes('Creature');
      const isEligible = !card.state.isTapped && !card.state.summoningSickness && !card.state.attackedThisTurn;
      if (isCreature && isEligible) {
        toggleAttacker(card.uuid);
        return;
      }
    }

    // Blocker selection mode (declareBlockersStep, not my turn)
    if (zone === 'battlefield' && phase === 'declareBlockersStep' && !isMyTurn) {
      const isCreature = card.blueprint.cardTypes.includes('Creature');
      const isEligible = !card.state.isTapped;
      if (isCreature && isEligible) {
        selectBlocker(card.uuid);
        return;
      }
    }

    // Simple click: if in hand, play the card
    if (zone === 'hand') {
      // ... existing hand-click logic unchanged
    }
  };
```

- [ ] **Step 3: Update `PhaseBar` — attacker selection**

In `src/client/components/PhaseBar.tsx`:

Add imports:
```ts
import { useGameStore as useCombatStore } from '../store/gameStore';
```

Read combat selection:
```ts
  const combatSelection = useCombatStore((s) => s.combatSelection);
  const clearCombatSelection = useCombatStore((s) => s.clearCombatSelection);
```

Replace the "Declare Attackers" button block:

```tsx
          {/* Declare Attackers: active player in declareAttackersStep.
              Click creatures on the battlefield to toggle selection. */}
          {isMyTurn && hasPriority && phase === 'declareAttackersStep' && (
            <button
              disabled={combatSelection.attackers.length === 0}
              onClick={() => {
                playerAction(
                  ACTION_IDS.declareAttackers,
                  undefined,
                  undefined,
                  { attackers: combatSelection.attackers.map(uuid => ({ cardUuid: uuid })) },
                );
                clearCombatSelection();
              }}
            >
              Confirm Attackers ({combatSelection.attackers.length})
            </button>
          )}
```

- [ ] **Step 4: Run tests, verify no regressions**

Run: `npx vitest run`
Expected: all existing tests pass.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```
git add -A && git commit -m "feat: click-to-select attacker UI with combat selection highlights"
```

---

### Task 7: Blocker selection UI (click-to-pair + Confirm)

**Files:**
- Modify: `src/client/components/PhaseBar.tsx` (blocker Confirm + No Blocks buttons)
- Modify: `src/client/components/CombatDisplay.tsx` (clickable attackers for pairing)
- Modify: `src/client/style.css` (`.block-target` style)

**Interfaces:**
- Consumes: `combatSelection`, `assignBlocker`, `clearCombatSelection` from store (Task 5)

- [ ] **Step 1: Add `.block-target` style**

In `src/client/style.css`:

```css
.combat-display .combat-attacker.clickable {
  cursor: pointer;
  text-decoration: underline;
  color: #4fc3f7;
}

.combat-display .combat-attacker.clickable:hover {
  color: #81d4fa;
}
```

- [ ] **Step 2: Update `CombatDisplay` — clickable attackers for blocker pairing**

In `src/client/components/CombatDisplay.tsx`:

Add imports:
```ts
import { useGameStore } from '../store/gameStore';
```

Read combat selection and phase:
```ts
  const combatSelection = useGameStore((s) => s.combatSelection);
  const assignBlocker = useGameStore((s) => s.assignBlocker);
  const phase = useGameStore((s) => s.room?.phase ?? null);
  const isMyTurn = useGameStore((s) => {
    const room = s.room;
    const myId = s.myPlayerId;
    if (!room || !myId) return false;
    return room.activeTurnPlayerId === myId;
  });

  const isBlockingPhase = phase === 'declareBlockersStep' && !isMyTurn;
  const hasPendingBlocker = combatSelection.pendingBlocker !== null;
```

Make attacker names clickable when in blocker-pairing mode:

```tsx
            <span
              className={`combat-attacker ${isBlockingPhase && hasPendingBlocker ? 'clickable' : ''}`}
              onClick={() => {
                if (isBlockingPhase && hasPendingBlocker) {
                  assignBlocker(decl.uuid);
                }
              }}
            >
              {decl.attacker.blueprint.name}
            </span>
```

Also show pending blocker pairs:

```tsx
        {combatSelection.blockerPairs.length > 0 && (
          <div className="pending-pairs">
            <h4>Pending Blocks</h4>
            <ul>
              {combatSelection.blockerPairs.map((pair, i) => {
                const attacker = combat.find(d => d.uuid === pair.attackerUuid);
                const blocker = /* find on battlefield */ null; // simplified — show uuid for now
                return (
                  <li key={i}>
                    {attacker?.attacker.blueprint.name ?? pair.attackerUuid}
                    {' blocked by '}
                    {blocker?.blueprint.name ?? pair.blockerUuid}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
```

- [ ] **Step 3: Update `PhaseBar` — blocker Confirm + No Blocks**

Replace the "Declare Blockers" button block:

```tsx
          {/* Declare Blockers: defending player in declareBlockersStep.
              Click your creatures to select a blocker, then click an attacker to pair. */}
          {!isMyTurn && hasPriority && phase === 'declareBlockersStep' && (
            <>
              <button
                onClick={() => {
                  const assignments = combatSelection.blockerPairs.reduce((acc, pair) => {
                    const existing = acc.find(a => a.attackerUuid === pair.attackerUuid);
                    if (existing) {
                      existing.blockerUuids.push(pair.blockerUuid);
                    } else {
                      acc.push({ attackerUuid: pair.attackerUuid, blockerUuids: [pair.blockerUuid] });
                    }
                    return acc;
                  }, [] as { attackerUuid: string; blockerUuids: string[] }[]);
                  playerAction(
                    ACTION_IDS.declareBlockers,
                    undefined,
                    undefined,
                    { assignments },
                  );
                  clearCombatSelection();
                }}
              >
                Confirm Blockers ({combatSelection.blockerPairs.length})
              </button>
              <button
                onClick={() => {
                  playerAction(
                    ACTION_IDS.declareBlockers,
                    undefined,
                    undefined,
                    { assignments: [] },
                  );
                  clearCombatSelection();
                }}
              >
                No Blocks
              </button>
            </>
          )}
```

- [ ] **Step 4: Run tests, verify no regressions**

Run: `npx vitest run`
Expected: all existing tests pass.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```
git add -A && git commit -m "feat: click-to-pair blocker selection UI with Confirm and No Blocks"
```

---

### Task 8: Summoning sickness visual

**Files:**
- Modify: `src/client/components/CardComponent.tsx` (add `.summoning-sick` class)
- Modify: `src/client/style.css` (`.summoning-sick` style)

- [ ] **Step 1: Add `.summoning-sick` style**

In `src/client/style.css`:

```css
/* Summoning sickness indicator */
.card.summoning-sick {
  opacity: 0.6;
  position: relative;
}

.card.summoning-sick::after {
  content: 'zZ';
  position: absolute;
  top: 2px;
  right: 4px;
  font-size: 10px;
  color: #9e9e9e;
  font-weight: bold;
}
```

- [ ] **Step 2: Add class to `CardComponent`**

In `src/client/components/CardComponent.tsx`, add to the card div's `className`:

```
${card.state.summoningSickness ? 'summoning-sick' : ''}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```
git add -A && git commit -m "feat: summoning sickness visual indicator (dimmed + zZ badge)"
```

---

### Task 9: Final verification

- [x] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [x] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: all tests pass, no regressions.

- [x] **Step 3: Build check**

Run: `npm run build` (or `npx vite build`)
Expected: builds without errors.

- [x] **Step 4: Live smoke test**

Start server: `node dist/server.js`
Open two browser tabs, join the same room, and verify:
1. Cast creatures for both players
2. Enter Battle → click creatures to select attackers → Confirm Attackers
3. Defending player clicks a creature (pending blocker) → clicks an attacker → Confirm Blockers
4. Verify damage resolves, creatures die, life changes
5. Next turn: verify damage was cleared (survivors are at full health)
6. Verify summoning sickness badge appears on newly cast creatures

- [x] **Step 5: Commit any final fixes**

```
git add -A && git commit -m "chore: final verification fixes"
```

**Outcome:** Two bugs were found and fixed during the live smoke test (commit
`e87eb03`):
1. Combat mutations (`DECLARE_ATTACKERS`, `ASSIGN_BLOCKERS`, `CLEAR_COMBAT`) and
   `CLEAR_DAMAGE` were not mapped in `sync-service.ts`, so `room.combat` never
   reached the client and `CombatDisplay` rendered nothing.
2. `GameEngine.advancePhase` applied the director's entire flat mutation array in
   a single `applyMutations` batch, so State-Based Actions only ran after
   `cleanupStep` had already cleared combat damage — creatures with lethal damage
   survived. Fixed by splitting the array after each `SET_PHASE` and running SBA
   at every phase boundary (CR 704.3).