# MTG Combat Phase Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `stateBattlePhase`/`endCombat` with five MTG-faithful combat steps (`beginCombatStep` → `declareAttackersStep` → `declareBlockersStep` → `combatDamageStep` → `endCombatStep`) that auto-advance as a timing skeleton, emitting stub events for testing.

**Architecture:** The five steps are flat `GameStateName` values wired into the existing `TRANSITIONS` map. Entering combat from `stateMainPhase` runs a single linear chain of `transition()` calls in `server.ts` that walks through all five steps and completes the turn. Each step emits `PHASE_CHANGED` (existing) plus a dedicated combat event from `transition()`. The per-creature attack handler and its `option-service.ts` gate move from `stateBattlePhase` to `stateMainPhase`.

**Tech Stack:** TypeScript 6.0, Vitest 4.1, Zustand 5 (client), Socket.IO 4.8.

## Global Constraints

- Pure reducer architecture: handlers produce `GameMutation[]`, engine sequences through `gameReducer()`.
- `GameStateName` is a flat union — no nested phase containers.
- `transition()` emits `PHASE_CHANGED` with `{ phase, currentPlayer }` for every phase change (do not remove).
- The combat steps are **no-op placeholders** — no priority windows, no player input between steps, no actual combat mechanics.
- The per-creature attack handler stays functional but only in `stateMainPhase` (pre-combat).
- All existing tests that reference `stateBattlePhase` or `endCombat` must be updated to the new step names.
- Run `npx tsc --noEmit` and the full test suite before committing; both must pass.

---

### Task 1: Add the five combat step phase names

**Files:**
- Modify: `src/types/game.state.types.ts:6-16`

**Interfaces:**
- Consumes: nothing (type-only change).
- Produces: `GameStateName` now includes `'beginCombatStep' | 'declareAttackersStep' | 'declareBlockersStep' | 'combatDamageStep' | 'endCombatStep'` and no longer includes `'stateBattlePhase' | 'endCombat'`. Later tasks reference these exact strings.

- [ ] **Step 1: Write the failing test**

Add a type-level assertion to `tests/engine/state-machine.test.ts` (in the `describe('StateMachine')` block, after the existing `initial state` describe). This test fails to compile until the type is updated:

```ts
describe('combat step phases', () => {
  it('should expose the five combat step phase names', () => {
    const steps: GameStateName[] = [
      'beginCombatStep',
      'declareAttackersStep',
      'declareBlockersStep',
      'combatDamageStep',
      'endCombatStep',
    ];
    expect(steps.length).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/state-machine.test.ts`
Expected: FAIL — TypeScript error: `'beginCombatStep'` is not assignable to type `GameStateName`.

- [ ] **Step 3: Update the type**

In `src/types/game.state.types.ts`, replace the `GameStateName` union:

```ts
export type GameStateName =
    | 'waiting'
    | 'RPS'
    | 'stateTurnStart'
    | 'stateDrawPhase'
    | 'stateMainPhase'
    | 'beginCombatStep'
    | 'declareAttackersStep'
    | 'declareBlockersStep'
    | 'combatDamageStep'
    | 'endCombatStep'
    | 'stateEndPhase'
    | 'cleanupStep'
    | 'Stack'
    | 'gameOver';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/state-machine.test.ts`
Expected: PASS (the new test passes; other tests in this file may fail because they still reference `stateBattlePhase`/`endCombat` — that is expected and fixed in Task 3).

- [ ] **Step 5: Commit**

```bash
git add src/types/game.state.types.ts tests/engine/state-machine.test.ts
git commit -m "feat(combat): add five MTG combat step phase names"
```

---

### Task 2: Update the transition map and emit combat step events

**Files:**
- Modify: `src/engine/state-machine.ts:13-17` (TRANSITIONS map)
- Modify: `src/engine/state-machine.ts:104-110` (CLEAR_COMBAT relocation)
- Modify: `src/engine/state-machine.ts:126-133` (event emission block)

**Interfaces:**
- Consumes: `GameStateName` from Task 1.
- Produces: `transition()` now emits dedicated combat events `COMBAT_BEGIN`, `ATTACKERS_DECLARED`, `BLOCKERS_DECLARED`, `COMBAT_DAMAGE_RESOLVED`, `COMBAT_ENDED` when entering the corresponding step. `CLEAR_COMBAT` fires on entering `endCombatStep`. Task 3's smoke test asserts these.

- [ ] **Step 1: Write the failing test**

Add to `tests/engine/state-machine.test.ts` inside the `describe('combat step phases')` block. This test asserts the transition map allows the linear combat chain and that the dedicated events fire:

```ts
it('should transition through all five combat steps in order', () => {
  // Walk to stateMainPhase first.
  apply(sm.transition(room, 'RPS'));
  apply(sm.transition(room, 'stateTurnStart'));
  apply(sm.transition(room, 'stateDrawPhase'));
  apply(sm.transition(room, 'stateMainPhase'));

  apply(sm.transition(room, 'beginCombatStep'));
  expect(room.currentPhase).toBe('beginCombatStep');
  apply(sm.transition(room, 'declareAttackersStep'));
  expect(room.currentPhase).toBe('declareAttackersStep');
  apply(sm.transition(room, 'declareBlockersStep'));
  expect(room.currentPhase).toBe('declareBlockersStep');
  apply(sm.transition(room, 'combatDamageStep'));
  expect(room.currentPhase).toBe('combatDamageStep');
  apply(sm.transition(room, 'endCombatStep'));
  expect(room.currentPhase).toBe('endCombatStep');
});

it('should emit dedicated combat events for each step', () => {
  apply(sm.transition(room, 'RPS'));
  apply(sm.transition(room, 'stateTurnStart'));
  apply(sm.transition(room, 'stateDrawPhase'));
  apply(sm.transition(room, 'stateMainPhase'));
  apply(sm.transition(room, 'beginCombatStep'));
  apply(sm.transition(room, 'declareAttackersStep'));
  apply(sm.transition(room, 'declareBlockersStep'));
  apply(sm.transition(room, 'combatDamageStep'));
  apply(sm.transition(room, 'endCombatStep'));

  const ids = events.map(e => e.eventId);
  expect(ids).toContain('COMBAT_BEGIN');
  expect(ids).toContain('ATTACKERS_DECLARED');
  expect(ids).toContain('BLOCKERS_DECLARED');
  expect(ids).toContain('COMBAT_DAMAGE_RESOLVED');
  expect(ids).toContain('COMBAT_ENDED');
});

it('should emit empty payloads for the three stub events', () => {
  apply(sm.transition(room, 'RPS'));
  apply(sm.transition(room, 'stateTurnStart'));
  apply(sm.transition(room, 'stateDrawPhase'));
  apply(sm.transition(room, 'stateMainPhase'));
  apply(sm.transition(room, 'beginCombatStep'));
  apply(sm.transition(room, 'declareAttackersStep'));
  apply(sm.transition(room, 'declareBlockersStep'));
  apply(sm.transition(room, 'combatDamageStep'));

  const attackers = events.find(e => e.eventId === 'ATTACKERS_DECLARED');
  const blockers = events.find(e => e.eventId === 'BLOCKERS_DECLARED');
  const damage = events.find(e => e.eventId === 'COMBAT_DAMAGE_RESOLVED');
  expect(attackers!.payload.attackerIds).toEqual([]);
  expect(blockers!.payload.blockerAssignments).toEqual([]);
  expect(damage!.payload.damageAssignments).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/state-machine.test.ts`
Expected: FAIL — `canTransition` returns false for `beginCombatStep` (not in the map), and no combat events are emitted.

- [ ] **Step 3: Update the TRANSITIONS map**

In `src/engine/state-machine.ts`, replace the `TRANSITIONS` map:

```ts
const TRANSITIONS: GameTransitionMap = {
  waiting: ['RPS'],
  RPS: ['stateTurnStart', 'RPS', 'Stack'],
  stateTurnStart: ['stateDrawPhase', 'Stack'],
  stateDrawPhase: ['stateMainPhase', 'Stack'],
  stateMainPhase: ['beginCombatStep', 'stateEndPhase', 'Stack'],
  beginCombatStep: ['declareAttackersStep', 'Stack'],
  declareAttackersStep: ['declareBlockersStep', 'Stack'],
  declareBlockersStep: ['combatDamageStep', 'Stack'],
  combatDamageStep: ['endCombatStep', 'Stack'],
  endCombatStep: ['stateEndPhase', 'Stack'],
  stateEndPhase: ['cleanupStep', 'Stack'],
  cleanupStep: ['stateTurnStart'],
  Stack: [],
  gameOver: [],
};
```

- [ ] **Step 4: Relocate CLEAR_COMBAT**

In `src/engine/state-machine.ts`, replace the `endCombat` block:

```ts
    // End of combat: clear declared attackers. In the current single-attacker
    // model, combat resolves immediately (damage applied in propose()), so
    // room.combat is a transient record. Clearing here prevents stale
    // declarations from leaking across turns. (Post-blockers, this moves to
    // the end of the combat damage step instead.)
    if (to === 'endCombat') {
      mutations.push({ type: 'CLEAR_COMBAT' });
    }
```

with:

```ts
    // End of combat step: clear declared attackers. In the current
    // single-attacker model, combat resolves immediately (damage applied in
    // propose()), so room.combat is a transient record. Clearing here prevents
    // stale declarations from leaking across turns. (Post-blockers, this moves
    // to the end of the combat damage step instead.)
    if (to === 'endCombatStep') {
      mutations.push({ type: 'CLEAR_COMBAT' });
    }
```

- [ ] **Step 5: Emit dedicated combat events**

In `src/engine/state-machine.ts`, inside `transition()`, immediately before the existing `PHASE_CHANGED` emission block (which starts with `mutations.push({ type: 'SET_PHASE', phase: to });`), add the combat event emission. Insert this block right after the `stateDrawPhase` draw block and before `mutations.push({ type: 'SET_PHASE', phase: to });`:

```ts
    // Combat step events: emit a dedicated event per step (stub payloads).
    // These give tests a semantic hook and give the follow-up mechanics spec a
    // stable event shape to fill in. PHASE_CHANGED also fires for each step.
    const combatEvent: Record<string, { eventId: string; payload: Record<string, unknown> }> = {
      beginCombatStep: { eventId: 'COMBAT_BEGIN', payload: { currentPlayer: room.activeTurnPlayerId } },
      declareAttackersStep: { eventId: 'ATTACKERS_DECLARED', payload: { attackerIds: [] } },
      declareBlockersStep: { eventId: 'BLOCKERS_DECLARED', payload: { blockerAssignments: [] } },
      combatDamageStep: { eventId: 'COMBAT_DAMAGE_RESOLVED', payload: { damageAssignments: [] } },
      endCombatStep: { eventId: 'COMBAT_ENDED', payload: { currentPlayer: room.activeTurnPlayerId } },
    };
    const combat = combatEvent[to];
    if (combat) {
      this.eventBus.emit({
        eventId: combat.eventId,
        roomId: this.roomId,
        payload: combat.payload,
      });
    }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/engine/state-machine.test.ts`
Expected: PASS for the three new tests. (Other tests in this file still referencing `stateBattlePhase`/`endCombat` may fail — fixed in Task 3.)

- [ ] **Step 7: Commit**

```bash
git add src/engine/state-machine.ts tests/engine/state-machine.test.ts
git commit -m "feat(combat): wire combat step transitions and stub events"
```

---

### Task 3: Update existing tests that reference the old phase names

**Files:**
- Modify: `tests/engine/state-machine.test.ts:116-119, 128-146`
- Modify: `tests/engine/battle-phase-smoke.test.ts:20, 28, 31, 73, 79`
- Modify: `tests/engine/attack-handler.test.ts:25`
- Modify: `tests/engine/combat-integration.test.ts:15`
- Modify: `tests/engine/game-engine.test.ts:238, 346`
- Modify: `tests/engine/game-reducer.test.ts:320-321`
- Modify: `tests/engine/option-service.test.ts:173`
- Modify: `tests/server/state-store.test.ts:44`

**Interfaces:**
- Consumes: the new `GameStateName` values from Task 1.
- Produces: a green test suite with no references to `stateBattlePhase` or `endCombat`.

- [ ] **Step 1: Update `state-machine.test.ts`**

Replace the `should transition through full turn cycle` test's combat portion:

```ts
      apply(sm.transition(room, 'stateMainPhase'));
      expect(room.currentPhase).toBe('stateMainPhase');
      apply(sm.transition(room, 'beginCombatStep'));
      expect(room.currentPhase).toBe('beginCombatStep');
      apply(sm.transition(room, 'declareAttackersStep'));
      expect(room.currentPhase).toBe('declareAttackersStep');
      apply(sm.transition(room, 'declareBlockersStep'));
      expect(room.currentPhase).toBe('declareBlockersStep');
      apply(sm.transition(room, 'combatDamageStep'));
      expect(room.currentPhase).toBe('combatDamageStep');
      apply(sm.transition(room, 'endCombatStep'));
      expect(room.currentPhase).toBe('endCombatStep');
      apply(sm.transition(room, 'stateEndPhase'));
```

Replace the `should emit CLEAR_COMBAT when transitioning to endCombat` test's walk-through:

```ts
      // Walk through the phases to reach endCombatStep legally.
      apply(sm.transition(room, 'RPS'));
      apply(sm.transition(room, 'stateTurnStart'));
      apply(sm.transition(room, 'stateDrawPhase'));
      apply(sm.transition(room, 'stateMainPhase'));
      apply(sm.transition(room, 'beginCombatStep'));
      apply(sm.transition(room, 'declareAttackersStep'));
      apply(sm.transition(room, 'declareBlockersStep'));
      apply(sm.transition(room, 'combatDamageStep'));
      apply(sm.transition(room, 'endCombatStep'));
      expect(room.currentPhase).toBe('endCombatStep');
      expect(room.combat.length).toBe(0);
```

Also rename the test title from `should emit CLEAR_COMBAT when transitioning to endCombat` to `should emit CLEAR_COMBAT when transitioning to endCombatStep`.

- [ ] **Step 2: Update `battle-phase-smoke.test.ts`**

Replace the `serverEndTurn` helper's combat branch:

```ts
  if (room.currentPhase === 'stateMainPhase') {
    mutations.push(...engine.transition('beginCombatStep'));
    mutations.push(...engine.transition('declareAttackersStep'));
    mutations.push(...engine.transition('declareBlockersStep'));
    mutations.push(...engine.transition('combatDamageStep'));
    mutations.push(...engine.transition('endCombatStep'));
    mutations.push(...engine.transition('stateEndPhase'));
    mutations.push(...engine.transition('cleanupStep'));
    mutations.push(...engine.transition('stateTurnStart'));
    mutations.push(...engine.switchTurn());
    mutations.push(...engine.transition('stateDrawPhase'));
    mutations.push(...engine.transition('stateMainPhase'));
    mutations.push(...engine.givePriorityTo(engine.activeTurnPlayerId));
  }
```

Update the comment at the top of the file:

```ts
 *   Main Phase → (End Turn) → combat steps → next turn.
```

Update the assertion at line 73 (currently `expect(engine.roomState.currentPhase).toBe('stateBattlePhase')`) to assert the turn completed:

```ts
    expect(engine.roomState.currentPhase).toBe('stateMainPhase');
```

Update line 79 (`room.currentPhase = 'stateBattlePhase'`) to `room.currentPhase = 'stateMainPhase'`.

- [ ] **Step 3: Update `attack-handler.test.ts`**

Replace line 25 (`room.currentPhase = 'stateBattlePhase';`) with `room.currentPhase = 'stateMainPhase';`.

- [ ] **Step 4: Update `combat-integration.test.ts`**

Replace line 15 (`room.currentPhase = 'stateBattlePhase';`) with `room.currentPhase = 'stateMainPhase';`.

- [ ] **Step 5: Update `game-engine.test.ts`**

Replace line 238 (`room.currentPhase = 'stateBattlePhase';`) with `room.currentPhase = 'stateMainPhase';`.

Replace line 346 (`engine.transition('stateBattlePhase');`) with `engine.transition('beginCombatStep');`.

- [ ] **Step 6: Update `game-reducer.test.ts`**

Replace lines 320-321:

```ts
      const next = gameReducer(room, { type: 'SET_PHASE', phase: 'stateBattlePhase' });
      expect(next.currentPhase).toBe('stateBattlePhase');
```

with:

```ts
      const next = gameReducer(room, { type: 'SET_PHASE', phase: 'beginCombatStep' });
      expect(next.currentPhase).toBe('beginCombatStep');
```

- [ ] **Step 7: Update `option-service.test.ts`**

Replace line 173 (`room.currentPhase = 'stateBattlePhase';`) with `room.currentPhase = 'stateMainPhase';`.

- [ ] **Step 8: Update `state-store.test.ts`**

Replace line 44 (`room.currentPhase = 'stateBattlePhase';`) with `room.currentPhase = 'stateMainPhase';`.

- [ ] **Step 9: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (all tests green, no references to `stateBattlePhase` or `endCombat` remain).

- [ ] **Step 10: Commit**

```bash
git add tests/
git commit -m "test(combat): update tests to new combat step phase names"
```

---

### Task 4: Rewire the server endTurn flow

**Files:**
- Modify: `src/server.ts:318-345`

**Interfaces:**
- Consumes: the five combat step names from Task 1.
- Produces: entering combat from `stateMainPhase` runs the full combat pipeline and completes the turn in one action. The `else` branch (battle phase → end turn) is removed.

- [ ] **Step 1: Write the failing test**

Add a test to `tests/engine/battle-phase-smoke.test.ts` that replicates the new server flow. This test fails until `server.ts` is updated (it asserts the full chain completes the turn):

```ts
it('should run the full combat pipeline and complete the turn from main phase', () => {
  // Ensure we're in stateMainPhase.
  room.currentPhase = 'stateMainPhase';
  const result = serverEndTurn(engine, room, 'player1');
  expect(result.success).toBe(true);
  // After the full chain, the turn has switched to player2 and we're back in main phase.
  expect(engine.roomState.activeTurnPlayerId).toBe('player2');
  expect(engine.roomState.currentPhase).toBe('stateMainPhase');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/battle-phase-smoke.test.ts`
Expected: FAIL — the current `serverEndTurn` helper (updated in Task 3) already runs the full chain, so this test may actually pass. If it passes, that's fine — the real verification is the typecheck in Step 4. Proceed.

- [ ] **Step 3: Update `server.ts`**

Replace the entire `case ACTION_IDS.endTurn:` block (lines 318-345):

```ts
      case ACTION_IDS.endTurn: {
        // Validate
        const validateResult = endTurnHandler.validate(room, playerId, {});
        if (!validateResult.success) {
          socket.emit('error', { message: validateResult.reason });
          return;
        }

        if (room.currentPhase === 'stateMainPhase') {
          // Main Phase → combat: entering combat runs the full five-step
          // combat pipeline (auto-advance, no priority windows) and completes
          // the turn: endCombatStep → endPhase → cleanupStep → turnStart, then
          // switch turn, then advance through draw phase (draw a card) → main
          // phase. Finally give priority to the new active player so they can
          // act. The combat steps are no-op placeholders that emit stub events.
          allMutations.push(...engine.transition('beginCombatStep'));
          allMutations.push(...engine.transition('declareAttackersStep'));
          allMutations.push(...engine.transition('declareBlockersStep'));
          allMutations.push(...engine.transition('combatDamageStep'));
          allMutations.push(...engine.transition('endCombatStep'));
          allMutations.push(...engine.transition('stateEndPhase'));
          allMutations.push(...engine.transition('cleanupStep'));
          allMutations.push(...engine.transition('stateTurnStart'));
          allMutations.push(...engine.switchTurn());
          allMutations.push(...engine.transition('stateDrawPhase'));
          allMutations.push(...engine.transition('stateMainPhase'));
          allMutations.push(...engine.givePriorityTo(engine.activeTurnPlayerId));
        }
        break;
      }
```

- [ ] **Step 4: Run typecheck and tests**

Run: `npx tsc --noEmit`
Expected: CLEAN (no errors).

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts tests/engine/battle-phase-smoke.test.ts
git commit -m "feat(combat): rewire server endTurn to run combat pipeline"
```

---

### Task 5: Update the attack handler and option-service phase gates

**Files:**
- Modify: `src/engine/handlers/attack-handler.ts:28`
- Modify: `src/engine/option-service.ts:87, 97`

**Interfaces:**
- Consumes: `stateMainPhase` (still a valid `GameStateName`).
- Produces: attacks are valid only in `stateMainPhase` (pre-combat). The combat steps reject attacks.

- [ ] **Step 1: Write the failing test**

Add to `tests/engine/attack-handler.test.ts`:

```ts
it('should reject attacks during combat steps', () => {
  room.currentPhase = 'beginCombatStep';
  const result = attackHandler.validate(room, 'player1', { cardUuid: attacker.uuid });
  expect(result.success).toBe(false);
  expect(result.reason).toContain('main phase');
});
```

(Adjust `attacker` to the variable name used in that test file's `beforeEach`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/attack-handler.test.ts`
Expected: FAIL — the handler still checks `stateBattlePhase`, so `beginCombatStep` passes the current check (it's not `stateBattlePhase`, so it returns the "battle phase" error, but the reason string won't contain "main phase").

- [ ] **Step 3: Update `attack-handler.ts`**

Replace:

```ts
    // Must be in battle phase
    if (room.currentPhase !== 'stateBattlePhase') {
      return { success: false, phase: 'validate', reason: 'Can only attack during battle phase' };
    }
```

with:

```ts
    // Must be in main phase (pre-combat). Combat steps are no-op placeholders;
    // the follow-up mechanics spec relocates attacks into declareAttackersStep.
    if (room.currentPhase !== 'stateMainPhase') {
      return { success: false, phase: 'validate', reason: 'Can only attack during main phase' };
    }
```

- [ ] **Step 4: Update `option-service.ts`**

Replace the `canAttack` condition:

```ts
      const canAttack = !card.state.isTapped && !card.state.summoningSickness
        && !card.state.attackedThisTurn
        && room.activeTurnPlayerId === playerId
        && room.currentPhase === 'stateMainPhase';
```

Replace the `disabledReason` string:

```ts
          : room.currentPhase !== 'stateMainPhase' ? 'Not in main phase'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/engine/attack-handler.test.ts tests/engine/option-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full suite and typecheck**

Run: `npx vitest run`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: CLEAN.

- [ ] **Step 7: Commit**

```bash
git add src/engine/handlers/attack-handler.ts src/engine/option-service.ts tests/engine/attack-handler.test.ts
git commit -m "feat(combat): gate attacks to main phase pre-combat"
```

---

### Task 6: Update the client PhaseBar

**Files:**
- Modify: `src/client/components/PhaseBar.tsx:12-13`

**Interfaces:**
- Consumes: the five combat step names from Task 1.
- Produces: `PHASE_LABELS` covers all `GameStateName` values (no missing-key type error).

- [ ] **Step 1: Write the failing test**

Add to `tests/client/gameStore.test.ts` (or a new `tests/client/phase-bar.test.ts` if one exists). Since `PHASE_LABELS` is a `Record<GameStateName, string>`, the typecheck fails if any key is missing. Add a test that imports the labels and asserts the five steps have labels:

```ts
import { PHASE_LABELS } from '../../src/client/components/PhaseBar';

it('should label all five combat steps', () => {
  expect(PHASE_LABELS.beginCombatStep).toBe('Beginning of Combat');
  expect(PHASE_LABELS.declareAttackersStep).toBe('Declare Attackers');
  expect(PHASE_LABELS.declareBlockersStep).toBe('Declare Blockers');
  expect(PHASE_LABELS.combatDamageStep).toBe('Combat Damage');
  expect(PHASE_LABELS.endCombatStep).toBe('End of Combat');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/gameStore.test.ts`
Expected: FAIL — `PHASE_LABELS` is not exported, and the typecheck fails because `PHASE_LABELS` is missing the five new keys.

- [ ] **Step 3: Update `PhaseBar.tsx`**

Replace the `PHASE_LABELS` map:

```ts
const PHASE_LABELS: Record<GameStateName, string> = {
  waiting: 'Waiting for opponent',
  RPS: 'Rock-Paper-Scissors',
  stateTurnStart: 'Untap Step',
  stateDrawPhase: 'Draw Step',
  stateMainPhase: 'Main Phase',
  beginCombatStep: 'Beginning of Combat',
  declareAttackersStep: 'Declare Attackers',
  declareBlockersStep: 'Declare Blockers',
  combatDamageStep: 'Combat Damage',
  endCombatStep: 'End of Combat',
  stateEndPhase: 'End Step',
  cleanupStep: 'Cleanup Step',
  Stack: 'Resolving Stack',
  gameOver: 'Game Over',
};
```

Export `PHASE_LABELS` so the test can import it:

```ts
export const PHASE_LABELS: Record<GameStateName, string> = {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/client/gameStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full suite and typecheck**

Run: `npx vitest run`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: CLEAN.

- [ ] **Step 6: Commit**

```bash
git add src/client/components/PhaseBar.tsx tests/client/gameStore.test.ts
git commit -m "feat(combat): add combat step labels to PhaseBar"
```

---

### Task 7: Add the combat pipeline smoke test

**Files:**
- Create: `tests/engine/combat-pipeline-smoke.test.ts`

**Interfaces:**
- Consumes: the five combat step names, the dedicated events, and the `serverEndTurn`-style chain from Tasks 1-4.
- Produces: a standalone smoke test proving the full pipeline runs end-to-end.

- [ ] **Step 1: Write the failing test**

Create `tests/engine/combat-pipeline-smoke.test.ts`:

```ts
// tests/engine/combat-pipeline-smoke.test.ts
// Smoke test for the MTG combat phase pipeline: entering combat from
// stateMainPhase auto-advances through all five steps, emitting a dedicated
// event per step, then completes the turn.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import type { GameRoom } from '../../src/types/game.room.types';

describe('combat pipeline smoke test', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom();
    engine = new GameEngine(room);
    engine.initRoom();
  });

  it('should auto-advance through all five combat steps and complete the turn', () => {
    const bus = (engine as any).eventBus;
    const emitSpy = vi.spyOn(bus, 'emit');

    // Replicate the server endTurn flow from stateMainPhase.
    const mutations: ReturnType<GameEngine['transition']> = [];
    mutations.push(...engine.transition('beginCombatStep'));
    mutations.push(...engine.transition('declareAttackersStep'));
    mutations.push(...engine.transition('declareBlockersStep'));
    mutations.push(...engine.transition('combatDamageStep'));
    mutations.push(...engine.transition('endCombatStep'));
    mutations.push(...engine.transition('stateEndPhase'));
    mutations.push(...engine.transition('cleanupStep'));
    mutations.push(...engine.transition('stateTurnStart'));
    mutations.push(...engine.switchTurn());
    mutations.push(...engine.transition('stateDrawPhase'));
    mutations.push(...engine.transition('stateMainPhase'));

    // The turn completed and switched to player2.
    expect(engine.roomState.activeTurnPlayerId).toBe('player2');
    expect(engine.roomState.currentPhase).toBe('stateMainPhase');

    // The five dedicated combat events fired in order.
    const combatEvents = emitSpy.mock.calls
      .map((args) => args[0]?.eventId)
      .filter((id) => ['COMBAT_BEGIN', 'ATTACKERS_DECLARED', 'BLOCKERS_DECLARED', 'COMBAT_DAMAGE_RESOLVED', 'COMBAT_ENDED'].includes(id));
    expect(combatEvents).toEqual([
      'COMBAT_BEGIN',
      'ATTACKERS_DECLARED',
      'BLOCKERS_DECLARED',
      'COMBAT_DAMAGE_RESOLVED',
      'COMBAT_ENDED',
    ]);
  });

  it('should emit empty payloads for the three stub events', () => {
    const bus = (engine as any).eventBus;
    const emitSpy = vi.spyOn(bus, 'emit');

    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');
    engine.transition('declareBlockersStep');
    engine.transition('combatDamageStep');

    const attackers = emitSpy.mock.calls.find((args) => args[0]?.eventId === 'ATTACKERS_DECLARED');
    const blockers = emitSpy.mock.calls.find((args) => args[0]?.eventId === 'BLOCKERS_DECLARED');
    const damage = emitSpy.mock.calls.find((args) => args[0]?.eventId === 'COMBAT_DAMAGE_RESOLVED');
    expect(attackers![0].payload.attackerIds).toEqual([]);
    expect(blockers![0].payload.blockerAssignments).toEqual([]);
    expect(damage![0].payload.damageAssignments).toEqual([]);
  });

  it('should clear combat declarations on entering endCombatStep', () => {
    // Seed a combat declaration so we can observe it being cleared.
    room.combat.push({
      uuid: 'combat-1',
      attacker: engine.roomState.battlefield[0],
      target: { targetType: 'player', playerId: 'player2' },
      attackerPower: 1,
    });
    expect(engine.roomState.combat.length).toBe(1);

    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');
    engine.transition('declareBlockersStep');
    engine.transition('combatDamageStep');
    engine.transition('endCombatStep');

    // CLEAR_COMBAT is a mutation applied by the reducer, not an event.
    expect(engine.roomState.combat.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/engine/combat-pipeline-smoke.test.ts`
Expected: PASS (all prior tasks are complete, so this test should pass immediately).

- [ ] **Step 3: Run full suite and typecheck**

Run: `npx vitest run`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: CLEAN.

- [ ] **Step 4: Commit**

```bash
git add tests/engine/combat-pipeline-smoke.test.ts
git commit -m "test(combat): add combat pipeline smoke test"
```

---

### Task 8: Final verification

**Files:**
- None (verification only).

**Interfaces:**
- Consumes: all prior tasks.

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (all tests green).

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: CLEAN.

- [ ] **Step 3: Confirm no stale references**

Run: `npx grep -rn "stateBattlePhase\|endCombat" src tests`
Expected: No matches (all references updated).

- [ ] **Step 4: Commit any remaining changes**

```bash
git add -A
git commit -m "chore(combat): final verification of combat pipeline"
```

(If there are no changes, skip this commit.)