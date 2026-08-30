# Foundational Triggers + Attack Triggers + Destroy Target — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **STATUS (2026-08-30):** ✅ COMPLETE — Tasks 1–6 implemented and committed. Task 7 (integration test) is **DEFERRED** (see Task 7 note) because the actual attackable card is not implemented yet. Deferred/undone work is consolidated in `docs/superpowers/specs/2026-08-30-deferred-work-and-next-phases.md`.

**Goal:** Wire the four foundational event gaps (PERMANENT_LEFT, TURN_STARTED, LIFE_CHANGED, ATTACK_DECLARED), extend TriggerManager to handle all trigger events, add the DESTROY effect handler, and emit ATTACK_DECLARED from the attack handler — unlocking attack triggers (6 cards), death triggers (1 card), life-loss triggers (1 card), and destroy-target (5 cards).

**Architecture:** The EventBus already works — `emit()` dispatches to registered listeners and `TriggerManager` already listens to `PERMANENT_ENTERED`. The pattern is: emit events from the reducer (for zone/life changes) and state-machine (for phase/turn changes), then add matching listeners in TriggerManager. The DESTROY handler is a thin wrapper over MOVE_CARD (battlefield→graveyard). ATTACK_DECLARED is emitted from attack-handler.ts after the stack object is pushed.

**Tech Stack:** TypeScript 6.0.3, Vitest 4.1.10 (node environment), pure reducer architecture

## Global Constraints

- All handlers produce `GameMutation[]` — never mutate `GameRoom` directly
- UUID injection via `generateUuid()` callback — handlers stay pure
- Tests use `createTestRoom()` from `tests/helpers/test-room-factory.ts`
- `tsc --noEmit` must stay clean; `npx vitest run` must pass
- Follow existing patterns: `gameReducer(room, mutation)` for applying mutations in tests

---

## Task 1: Emit PERMANENT_LEFT from game-reducer on battlefield→graveyard MOVE_CARD ✅ DONE (commit 5913042)

**Files:**
- Modify: `src/engine/game-reducer.ts` — the `MOVE_CARD` case
- Test: `tests/engine/game-reducer.test.ts` (new, or add to existing)

**Interfaces:**
- Consumes: `EventBus.emit()` — but the reducer is pure and has no EventBus. We need a different approach.
- Produces: The reducer cannot emit events (it's pure). Instead, the engine layer (`GameEngine.applyMutations()`) must detect `MOVE_CARD` from battlefield→graveyard and emit `PERMANENT_LEFT`.

**Design decision:** The reducer stays pure. `GameEngine.applyMutations()` already drains the mutation collector after applying mutations. We add a post-mutation hook: after applying each `MOVE_CARD` where `from === 'battlefield'` and `to === 'graveyard'`, emit `PERMANENT_LEFT` via the EventBus.

- [ ] **Step 1: Write the failing test**

Create `tests/engine/game-engine.test.ts` if it doesn't exist, or add to it:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import { gameReducer } from '../../src/engine/game-reducer';
import type { GameRoom } from '../../src/types/game.room.types';

describe('GameEngine — event emission', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom();
    engine = new GameEngine(room);
    engine.initRoom();
  });

  it('should emit PERMANENT_LEFT when a creature moves from battlefield to graveyard', () => {
    // Spy on EventBus.emit
    const emitSpy = vi.spyOn(engine['eventBus'], 'emit');

    // Put a creature on the battlefield
    const creature = instantiateCard('empire-servant');
    creature.state.zone = 'battlefield';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    room.battlefield.push(creature);

    // Move it to graveyard via MOVE_CARD mutation
    engine.applyMutations([{
      type: 'MOVE_CARD',
      cardUuid: creature.uuid,
      playerId: 'player1',
      from: 'battlefield',
      to: 'graveyard',
    }]);

    // Should have emitted PERMANENT_LEFT
    const leftCalls = emitSpy.mock.calls.filter(
      ([eventId]) => eventId === 'PERMANENT_LEFT'
    );
    expect(leftCalls.length).toBe(1);
    expect(leftCalls[0][1].payload.card.uuid).toBe(creature.uuid);
  });

  it('should NOT emit PERMANENT_LEFT for non-battlefield moves', () => {
    const emitSpy = vi.spyOn(engine['eventBus'], 'emit');

    const card = instantiateCard('empire-servant');
    card.state.zone = 'hand';
    card.state.ownerId = 'player1';
    room.players['player1'].hand.push(card);

    engine.applyMutations([{
      type: 'MOVE_CARD',
      cardUuid: card.uuid,
      playerId: 'player1',
      from: 'hand',
      to: 'graveyard',
    }]);

    const leftCalls = emitSpy.mock.calls.filter(
      ([eventId]) => eventId === 'PERMANENT_LEFT'
    );
    expect(leftCalls.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/game-engine.test.ts 2>&1`
Expected: FAIL — `PERMANENT_LEFT` is never emitted

- [ ] **Step 3: Implement PERMANENT_LEFT emission in GameEngine.applyMutations()**

Modify `src/engine/game-engine.ts`, in the `applyMutations` method, after applying each mutation:

```typescript
applyMutations(mutations: GameMutation[]): GameMutation[] {
  const allApplied: GameMutation[] = [];

  const apply = (muts: GameMutation[]): void => {
    for (const m of muts) {
      this.room = gameReducer(this.room, m);
      allApplied.push(m);

      // Emit PERMANENT_LEFT when a card leaves the battlefield for graveyard
      if (m.type === 'MOVE_CARD' && m.from === 'battlefield' && m.to === 'graveyard') {
        const card = this.room.battlefield.find(c => c.uuid === m.cardUuid)
          ?? this.room.players[m.playerId]?.graveyard.find(c => c.uuid === m.cardUuid);
        // Card is already in graveyard after reducer, so check graveyard
        const movedCard = this.room.players[m.playerId]?.graveyard.find(c => c.uuid === m.cardUuid);
        if (movedCard) {
          this.eventBus.emit({
            eventId: 'PERMANENT_LEFT',
            roomId: this.room.roomId,
            payload: { card: movedCard, controllerId: movedCard.state.controllerId },
          });
        }
      }
    }
  };

  apply(mutations);

  // Drain trigger-produced mutations (may produce more triggers)
  while (this.mutationCollector.length > 0) {
    const triggered = this.mutationCollector.splice(0);
    apply(triggered);
  }

  return allApplied;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/game-engine.test.ts 2>&1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/game-engine.ts tests/engine/game-engine.test.ts
git commit -m "feat: emit PERMANENT_LEFT when card moves from battlefield to graveyard"
```

---

## Task 2: Emit LIFE_CHANGED from game-reducer on SET_LIFE ✅ DONE (commit 5871758)

**Files:**
- Modify: `src/engine/game-engine.ts` — `applyMutations()` post-mutation hook
- Test: `tests/engine/game-engine.test.ts` — add test case

**Interfaces:**
- Consumes: `SET_LIFE` mutation in `applyMutations()`
- Produces: `LIFE_CHANGED` event via EventBus

- [ ] **Step 1: Write the failing test**

Add to `tests/engine/game-engine.test.ts`:

```typescript
it('should emit LIFE_CHANGED when player life changes', () => {
  const emitSpy = vi.spyOn(engine['eventBus'], 'emit');

  engine.applyMutations([{
    type: 'SET_LIFE',
    playerId: 'player1',
    amount: 15,
  }]);

  const lifeCalls = emitSpy.mock.calls.filter(
    ([eventId]) => eventId === 'LIFE_CHANGED'
  );
  expect(lifeCalls.length).toBe(1);
  expect(lifeCalls[0][1].payload.playerId).toBe('player1');
  expect(lifeCalls[0][1].payload.newLife).toBe(15);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/game-engine.test.ts 2>&1`
Expected: FAIL — `LIFE_CHANGED` is never emitted

- [ ] **Step 3: Implement LIFE_CHANGED emission**

Add after the `PERMANENT_LEFT` check in `applyMutations()`:

```typescript
// Emit LIFE_CHANGED when player life changes
if (m.type === 'SET_LIFE') {
  this.eventBus.emit({
    eventId: 'LIFE_CHANGED',
    roomId: this.room.roomId,
    payload: { playerId: m.playerId, newLife: m.amount },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/game-engine.test.ts 2>&1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/game-engine.ts tests/engine/game-engine.test.ts
git commit -m "feat: emit LIFE_CHANGED when player life changes"
```

---

## Task 3: Emit TURN_STARTED from state-machine on turn start ✅ DONE (commit 659b577)

**Files:**
- Modify: `src/engine/state-machine.ts` — `transition()` method
- Test: `tests/engine/state-machine.test.ts` — add test case

**Interfaces:**
- Consumes: `transition(room, 'stateTurnStart')` in StateMachine
- Produces: `TURN_STARTED` event via EventBus

- [ ] **Step 1: Write the failing test**

Add to `tests/engine/state-machine.test.ts`:

```typescript
it('should emit TURN_STARTED when transitioning to stateTurnStart', () => {
  const emitSpy = vi.spyOn(stateMachine['eventBus'], 'emit');

  stateMachine.transition(room, 'stateTurnStart');

  const turnCalls = emitSpy.mock.calls.filter(
    ([eventId]) => eventId === 'TURN_STARTED'
  );
  expect(turnCalls.length).toBe(1);
  expect(turnCalls[0][1].payload.currentPlayer).toBe(room.activeTurnPlayerId);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/state-machine.test.ts 2>&1`
Expected: FAIL — `TURN_STARTED` is never emitted

- [ ] **Step 3: Implement TURN_STARTED emission**

In `state-machine.ts`, in the `transition()` method, inside the `if (to === 'stateTurnStart')` block, add at the end (before the `mutations.push({ type: 'SET_PHASE', phase: to })` line):

```typescript
this.eventBus.emit({
  eventId: 'TURN_STARTED',
  roomId: this.roomId,
  payload: { currentPlayer: room.activeTurnPlayerId },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/state-machine.test.ts 2>&1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/state-machine.ts tests/engine/state-machine.test.ts
git commit -m "feat: emit TURN_STARTED when transitioning to stateTurnStart"
```

---

## Task 4: Extend TriggerManager to handle all trigger events ✅ DONE (commit 84df591 + fc2517e)

**Files:**
- Modify: `src/engine/trigger-manager.ts` — add listeners for PERMANENT_LEFT, LIFE_CHANGED, TURN_STARTED, ATTACK_DECLARED
- Test: `tests/engine/trigger-manager.test.ts` — add test cases

**Interfaces:**
- Consumes: EventBus events: `PERMANENT_LEFT`, `LIFE_CHANGED`, `TURN_STARTED`, `ATTACK_DECLARED`
- Produces: `PUSH_STACK` mutations into the collector for cards with matching `onEnterEffects` / `onLeaveEffects` / `onAttackEffects` / etc.

**Design decision:** Currently `TriggerManager` only checks `card.blueprint.onEnterEffects` for `PERMANENT_ENTERED`. We need to generalize: each trigger event maps to a different blueprint field. For now, we use the existing `abilities` array with `TriggeredAbility` entries that have `triggerCondition` matching the event.

The `TriggeredAbility` type already has `triggerCondition: TriggerEvent`. We need to add `ON_ATTACK` to the `TriggerEvent` union and have TriggerManager scan `card.blueprint.abilities` for matching triggered abilities.

- [ ] **Step 1: Add ON_ATTACK to TriggerEvent union**

Modify `src/types/card.types.ts`:

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
    | 'ON_LIFE_GAIN'
    | 'ON_SPELL_CAST'
    | 'ON_ATTACK';
```

- [ ] **Step 2: Write the failing test for attack trigger**

Add to `tests/engine/trigger-manager.test.ts`:

```typescript
it('should push a triggered StackObject when ATTACK_DECLARED fires with ON_ATTACK ability', () => {
  new TriggerManager(eventBus, collector, () => 'triggered-uuid-attack');

  const card = instantiateCard('empire-servant');
  card.state.zone = 'battlefield';
  card.state.controllerId = 'player1';
  // Attach a triggered ability with ON_ATTACK
  card.blueprint.abilities = [{
    type: 'triggered',
    triggerCondition: 'ON_ATTACK',
    effect: { effectId: 'DRAW', params: { amount: 1 } },
    castSpeed: 'instant',
  }];

  eventBus.emit({
    eventId: 'ATTACK_DECLARED',
    roomId: room.roomId,
    payload: { card, controllerId: 'player1' },
  });

  expect(collector.length).toBe(1);
  const mutation = collector[0];
  expect(mutation.type).toBe('PUSH_STACK');
  if (mutation.type === 'PUSH_STACK') {
    expect(mutation.stackObject.type).toBe('triggered');
    expect(mutation.stackObject.effects[0].action).toBe('DRAW');
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/engine/trigger-manager.test.ts 2>&1`
Expected: FAIL — no ATTACK_DECLARED listener

- [ ] **Step 4: Implement generalized trigger handling in TriggerManager**

Refactor `src/engine/trigger-manager.ts` to use a helper that scans abilities for matching trigger conditions:

```typescript
// src/engine/trigger-manager.ts
import { EventBus } from './event-bus';
import { buildStackEffects } from './effect-resolver';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom } from '../types/game.room.types';
import type { CardInstance, TriggeredAbility, TriggerEvent } from '../types/card.types';
import type { StackObject, StackEffect } from '../types/effect.types';

/**
 * Build StackEffects from a TriggeredAbility's effect payload.
 * Converts the legacy EffectPayload format to StackEffect[].
 */
function buildTriggeredEffects(ability: TriggeredAbility, controllerId: string): StackEffect[] {
  return [{
    action: ability.effect.effectId,
    params: ability.effect.params || {},
    tags: [],
    targets: [{ targetType: 'player', playerId: controllerId }],
  }];
}

/**
 * Scan a card's abilities for triggered abilities matching the given event.
 * Returns StackEffects for each matching ability.
 */
function getMatchingTriggers(card: CardInstance, event: TriggerEvent, controllerId: string): StackEffect[] {
  const effects: StackEffect[] = [];
  for (const ability of card.blueprint.abilities) {
    if (ability.type === 'triggered' && ability.triggerCondition === event) {
      effects.push(...buildTriggeredEffects(ability, controllerId));
    }
  }
  return effects;
}

export class TriggerManager {
  private collector: GameMutation[];
  private generateUuid: () => string;

  constructor(eventBus: EventBus, collector: GameMutation[], generateUuid: () => string) {
    this.collector = collector;
    this.generateUuid = generateUuid;

    // Helper: register a trigger listener for a given event
    const onTrigger = (eventId: string, triggerEvent: TriggerEvent) => {
      eventBus.on(eventId, (event) => {
        const card = event.payload.card as CardInstance;
        const controllerId = (card.state.controllerId || event.payload.controllerId) as string;
        const effects = getMatchingTriggers(card, triggerEvent, controllerId);

        // Also check legacy onEnterEffects for PERMANENT_ENTERED
        if (triggerEvent === 'ON_ENTER_BATTLEFIELD' && card.blueprint.onEnterEffects?.length) {
          effects.push(...buildStackEffects(card.blueprint.onEnterEffects, controllerId));
        }

        if (effects.length === 0) return;

        const stackObj: StackObject = {
          uuid: this.generateUuid(),
          type: 'triggered',
          controllerId,
          source: card,
          effects,
          countered: false,
        };

        this.collector.push({ type: 'PUSH_STACK', stackObject: stackObj });

        eventBus.emit({
          eventId: 'ACTION_PROPOSED',
          roomId: event.roomId,
          payload: { actionType: 'triggered', playerId: controllerId, stackObj },
        });
      });
    };

    // Register all trigger event listeners
    onTrigger('PERMANENT_ENTERED', 'ON_ENTER_BATTLEFIELD');
    onTrigger('PERMANENT_LEFT', 'ON_LEAVE_BATTLEFIELD');
    onTrigger('ATTACK_DECLARED', 'ON_ATTACK');
    onTrigger('TURN_STARTED', 'BEGIN_UPKEEP');
    onTrigger('LIFE_CHANGED', 'ON_LIFE_GAIN');
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/engine/trigger-manager.test.ts 2>&1`
Expected: PASS (existing ETB tests + new attack trigger test)

- [ ] **Step 6: Commit**

```bash
git add src/engine/trigger-manager.ts src/types/card.types.ts tests/engine/trigger-manager.test.ts
git commit -m "feat: generalize TriggerManager to handle all trigger events (attack, death, upkeep, life)"
```

---

## Task 5: Emit ATTACK_DECLARED from attack-handler ✅ DONE (commit 30d9244)

**Files:**
- Modify: `src/engine/handlers/attack-handler.ts` — `propose()` method
- Test: `tests/engine/attack-handler.test.ts` — add test case

**Interfaces:**
- Consumes: Attack action in `propose()`
- Produces: `ATTACK_DECLARED` event — but the handler is pure (no EventBus). The event must be emitted by the engine layer.

**Design decision:** The handler stays pure. `GameEngine.proposeAndStack()` already calls `this.actionService.proposeAndStack()` and then applies mutations. After applying, if the action was 'attack', emit `ATTACK_DECLARED`. But `proposeAndStack` doesn't know the action type. Better: emit from `attack-handler.propose()` by returning it in the result, then have the engine emit it. Or simpler: have `GameEngine.proposeAndStack()` accept the action type and emit accordingly.

Actually, the simplest approach: `attack-handler.propose()` returns the attacking card in the result, and `GameEngine.proposeAndStack()` emits `ATTACK_DECLARED` after applying mutations. We add an `attackingCard` field to `ActionResult`.

- [ ] **Step 1: Write the failing test**

Add to `tests/engine/attack-handler.test.ts`:

```typescript
it('should include attackingCard in propose result for ATTACK_DECLARED emission', () => {
  const card = room.battlefield[0];
  const result = attackHandler.propose(room, 'player1', { cardUuid: card.uuid, stackUuid: 'stack-uuid-1' });
  expect(result.success).toBe(true);
  if (result.success) {
    // The handler returns the attacking card so the engine can emit ATTACK_DECLARED
    expect(result.attackingCard).toBeDefined();
    expect(result.attackingCard!.uuid).toBe(card.uuid);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/attack-handler.test.ts 2>&1`
Expected: FAIL — `attackingCard` not in result

- [ ] **Step 3: Add attackingCard to ActionResult and return it from attack-handler**

Modify `src/engine/action-registry.ts`:

```typescript
export type ActionResult =
  | { success: true; stackObject?: StackObject; mutations?: GameMutation[]; attackingCard?: CardInstance }
  | { success: false; phase: 'validate' | 'propose' | 'resolve'; reason: string };
```

Modify `src/engine/handlers/attack-handler.ts` — in `propose()`, change the return:

```typescript
return { success: true, stackObject: stackObj, mutations, attackingCard: card };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/attack-handler.test.ts 2>&1`
Expected: PASS

- [ ] **Step 5: Emit ATTACK_DECLARED in GameEngine.proposeAndStack()**

Modify `src/engine/game-engine.ts` — in `proposeAndStack()`, after applying mutations:

```typescript
// Emit ATTACK_DECLARED for attack triggers
if (result.attackingCard) {
  this.eventBus.emit({
    eventId: 'ATTACK_DECLARED',
    roomId: this.room.roomId,
    payload: { card: result.attackingCard, controllerId: playerId },
  });
  // Drain any trigger-produced mutations from ATTACK_DECLARED
  while (this.mutationCollector.length > 0) {
    const triggered = this.mutationCollector.splice(0);
    for (const m of triggered) {
      this.room = gameReducer(this.room, m);
      allApplied.push(m);
    }
  }
}
```

- [ ] **Step 6: Run all tests**

Run: `npx vitest run 2>&1`
Expected: All existing tests still pass

- [ ] **Step 7: Commit**

```bash
git add src/engine/action-registry.ts src/engine/handlers/attack-handler.ts src/engine/game-engine.ts tests/engine/attack-handler.test.ts
git commit -m "feat: emit ATTACK_DECLARED from attack handler for attack triggers"
```

---

## Task 6: Add DESTROY effect handler ✅ DONE (commit c63497a)

**Files:**
- Modify: `src/engine/effect-registry.ts` — add `DESTROY` handler
- Test: `tests/engine/effect-registry.test.ts` — add test case

**Interfaces:**
- Consumes: `DESTROY` effect with targets on battlefield
- Produces: `MOVE_CARD` mutations (battlefield→graveyard)

- [ ] **Step 1: Write the failing test**

Add to `tests/engine/effect-registry.test.ts`:

```typescript
describe('DESTROY', () => {
  it('should move a creature from battlefield to graveyard', () => {
    const creature = instantiateCard('empire-servant');
    creature.state.zone = 'battlefield';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    room.battlefield.push(creature);

    const effect = makeEffect({
      action: 'DESTROY',
      params: {},
      targets: [{ targetType: 'permanent', cardUuid: creature.uuid }],
    });
    const stackObj = makeStackObj({ effects: [effect] });

    apply(EffectRegistry['DESTROY'](room, stackObj, effect));

    // Creature should be gone from battlefield
    expect(room.battlefield.find(c => c.uuid === creature.uuid)).toBeUndefined();
    // Creature should be in graveyard
    expect(room.players['player1'].graveyard.find(c => c.uuid === creature.uuid)).toBeDefined();
  });

  it('should do nothing if target is not on battlefield', () => {
    const effect = makeEffect({
      action: 'DESTROY',
      params: {},
      targets: [{ targetType: 'permanent', cardUuid: 'nonexistent' }],
    });
    const stackObj = makeStackObj({ effects: [effect] });

    const initialBf = room.battlefield.length;
    apply(EffectRegistry['DESTROY'](room, stackObj, effect));
    expect(room.battlefield.length).toBe(initialBf);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/effect-registry.test.ts 2>&1`
Expected: FAIL — no `DESTROY` handler

- [ ] **Step 3: Implement DESTROY handler**

Add to `src/engine/effect-registry.ts`:

```typescript
'DESTROY': (room, _stackObj, effect) => {
  const mutations: GameMutation[] = [];
  for (const target of effect.targets) {
    if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
      const card = findCardOnBattlefield(room, target.cardUuid);
      if (!card) continue;
      mutations.push({
        type: 'MOVE_CARD',
        cardUuid: card.uuid,
        playerId: card.state.ownerId,
        from: 'battlefield',
        to: 'graveyard',
      });
    }
  }
  return mutations;
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/effect-registry.test.ts 2>&1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/effect-registry.ts tests/engine/effect-registry.test.ts
git commit -m "feat: add DESTROY effect handler (battlefield to graveyard)"
```

---

## Task 7: Integration — verify full flow end-to-end ⏸️ DEFERRED

> **DEFERRED (2026-08-30):** The actual attackable card is not implemented yet — only the RPS phase is tested. The `full turn play loop` test in `game-engine.test.ts` fails because the attack flow depends on a real attackable creature card that doesn't exist yet. Revisit this task once the attackable card and full attack flow are implemented.

**Files:**
- Test: `tests/engine/game-engine.test.ts` — add integration test

- [ ] **Step 1: Write integration test for attack → trigger → destroy flow**

```typescript
it('should fire attack trigger when a creature attacks', () => {
  // Set up: creature with ON_ATTACK trigger on battlefield
  const creature = instantiateCard('empire-servant');
  creature.state.zone = 'battlefield';
  creature.state.ownerId = 'player1';
  creature.state.controllerId = 'player1';
  creature.state.summoningSickness = false;
  creature.blueprint.abilities = [{
    type: 'triggered',
    triggerCondition: 'ON_ATTACK',
    effect: { effectId: 'DRAW', params: { amount: 1 } },
    castSpeed: 'instant',
  }];
  room.battlefield.push(creature);
  room.currentPhase = 'stateBattlePhase';

  // Put a card in deck so draw works
  const deckCard = instantiateCard('empire-servant');
  deckCard.state.ownerId = 'player1';
  room.players['player1'].deck.push(deckCard);

  const initialHandSize = room.players['player1'].hand.length;

  // Propose attack
  const result = engine.proposeAndStack('player1', 'attack', {
    cardUuid: creature.uuid,
    stackUuid: engine.generateUuid(),
  });

  expect(result.success).toBe(true);

  // The attack trigger should have pushed a DRAW onto the stack
  // Stack should have 2 items: the attack StackObject + the triggered DRAW StackObject
  expect(engine.roomState.stack.length).toBe(2);
  // The triggered DRAW should be on top (last pushed)
  expect(engine.roomState.stack[1].type).toBe('triggered');
  expect(engine.roomState.stack[1].effects[0].action).toBe('DRAW');
});
```

- [ ] **Step 2: Run integration test**

Run: `npx vitest run tests/engine/game-engine.test.ts 2>&1`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run 2>&1`
Expected: All tests pass

- [ ] **Step 4: Verify TypeScript compilation**

Run: `npx tsc --noEmit 2>&1`
Expected: Clean (no errors)

- [ ] **Step 5: Commit**

```bash
git add tests/engine/game-engine.test.ts
git commit -m "test: add integration test for attack trigger flow"
```

---

## Self-Review

**1. Spec coverage:**
- F1 (PERMANENT_LEFT): Task 1 ✅
- F2 (TURN_STARTED): Task 3 ✅
- F3 (LIFE_CHANGED): Task 2 ✅
- F4 (TriggerManager generalization): Task 4 ✅
- P0 (Attack triggers): Tasks 4 + 5 ✅
- P1 (Destroy target): Task 6 ✅
- Integration test: Task 7 ⏸️ DEFERRED — blocked on attackable card not being implemented. See `2026-08-30-deferred-work-and-next-phases.md` §2.1.

**2. Placeholder scan:** No TBDs, TODOs, or "add appropriate error handling" patterns. All code is concrete.

**3. Type consistency:**
- `TriggerEvent` union gets `ON_ATTACK` added in Task 4 Step 1
- `ActionResult` gets `attackingCard` in Task 5 Step 3
- `TriggerManager` uses `TriggeredAbility.triggerCondition` which already exists
- `DESTROY` handler uses `MOVE_CARD` which already exists