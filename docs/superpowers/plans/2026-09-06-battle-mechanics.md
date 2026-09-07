# Hearthstone-Style Combat + Death/SBA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Hearthstone-style combat (creatures can attack players or other creatures, defender deals counter-attack damage), state-based actions (creatures die when damageTaken ≥ toughness, players lose at life ≤ 0), death triggers (ON_DIE), and combat keywords (Flying evasion, Trample excess damage).

**Architecture:** The attack handler gains a `targets` parameter — if the target is a player, existing behavior (MODIFY_LIFE); if a creature, both attacker and defender deal damage equal to their power simultaneously via MODIFY_STATS. After each mutation batch, a new SBA module checks the battlefield for dead creatures and dead players, producing DESTROY mutations. The TriggerManager wires ON_DIE (fires when a creature is destroyed, distinct from ON_LEAVE_BATTLEFIELD) and ON_DAMAGE_TAKEN. Combat keywords are checked in attack validation (Flying blocks non-flyers) and damage resolution (Trample excess to player). An `attackedThisTurn` flag on CardState tracks per-turn attack eligibility, cleared at stateTurnStart.

**Tech Stack:** TypeScript 6.0, Vitest 4.1, pure reducer architecture, Zustand 5 (client), Socket.IO 4.8.

## Global Constraints

- All handlers produce `GameMutation[]` — never mutate `GameRoom` directly.
- UUID injection via `generateUuid()` callback — handlers stay pure.
- Tests use `createTestRoom()` from `tests/helpers/test-room-factory.ts`.
- `npx tsc --noEmit` must stay clean; `npx vitest run` must pass.
- Follow existing patterns: `gameReducer(room, mutation)` for applying mutations in tests.
- `CardCharacteristicService.resolvePower()` / `resolveToughness()` for all P/T queries (respects continuous effects).
- Hearthstone-style: no declare blockers step. MTG-style blocking can be added later by inserting a `declareBlockers` phase between `stateBattlePhase` and `endCombat`.
- Test command: `npx vitest run` (all). Single file: `npx vitest run <path>`.

---

### Task 1: Add `attackedThisTurn` flag to CardState and clear it at turn start

**Files:**
- Modify: `src/types/card.types.ts` — `CardState` interface
- Modify: `src/library/card-factory.ts` — `instantiateCard()` default state
- Modify: `src/engine/state-machine.ts` — `stateTurnStart` transition
- Modify: `src/engine/game-reducer.ts` — new `SET_ATTACKED_THIS_TURN` mutation case
- Modify: `src/types/game-mutation.types.ts` — new mutation type
- Test: `tests/engine/state-machine.test.ts`

**Interfaces:**
- Consumes: existing `CardState`, `GameMutation` union, `stateMachine.transition()`
- Produces: `CardState.attackedThisTurn: boolean` (default `false`), `SET_ATTACKED_THIS_TURN` mutation, cleared in `stateTurnStart` untap step

- [ ] **Step 1: Add `attackedThisTurn` to CardState type**

In `src/types/card.types.ts`, add the field to `CardState`:

```ts
export interface CardState {
    zone: CardZone;
    ownerId: string;
    controllerId: string;
    isTapped: boolean;
    damageTaken: number;
    summoningSickness: boolean;
    attackedThisTurn: boolean;   // NEW: cleared at turn start, set when attack is proposed
    counters: Record<string, number>;
    attachedTo?: string | null;
}
```

- [ ] **Step 2: Add default in card-factory**

In `src/library/card-factory.ts`, add `attackedThisTurn: false` to the default state:

```ts
const instance: CardInstance = {
    blueprint,
    uuid: uuidv4(),
    state: {
      zone: 'library',
      ownerId: '',
      controllerId: '',
      isTapped: false,
      summoningSickness: false,
      attackedThisTurn: false,
      damageTaken: 0,
      counters: {},
    },
  };
```

- [ ] **Step 3: Add `SET_ATTACKED_THIS_TURN` mutation type**

In `src/types/game-mutation.types.ts`, add to the `GameMutation` union (after the `SET_SUMMONING_SICKNESS` line):

```ts
  | { type: 'SET_ATTACKED_THIS_TURN'; cardUuid: string; value: boolean }
```

- [ ] **Step 4: Add reducer case**

In `src/engine/game-reducer.ts`, add after the `SET_SUMMONING_SICKNESS` case:

```ts
    case 'SET_ATTACKED_THIS_TURN':
      return updateCardOnBattlefield(state, mutation.cardUuid, card => ({
        ...card,
        state: { ...card.state, attackedThisTurn: mutation.value },
      }));
```

- [ ] **Step 5: Clear `attackedThisTurn` at turn start**

In `src/engine/state-machine.ts`, in the `transition()` method, inside the `if (to === 'stateTurnStart')` block, add alongside the existing UNTAP_CARD and SET_SUMMONING_SICKNESS mutations:

```ts
      // Also clear attackedThisTurn for all of active player's permanents
      for (const card of room.battlefield) {
        if (card.state.controllerId === playerId) {
          mutations.push({ type: 'SET_ATTACKED_THIS_TURN', cardUuid: card.uuid, value: false });
        }
      }
```

This goes right after the existing `SET_SUMMONING_SICKNESS` loop inside the same `if (to === 'stateTurnStart')` block.

- [ ] **Step 6: Write the test**

In `tests/engine/state-machine.test.ts`, add a test:

```ts
  it('should clear attackedThisTurn on all of active player permanents at turn start', () => {
    // Put a creature on the battlefield with attackedThisTurn = true
    const creature = instantiateCard('empire-servant');
    creature.state.zone = 'battlefield';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    creature.state.attackedThisTurn = true;
    room.battlefield.push(creature);

    // Transition to stateTurnStart
    const mutations = sm.transition(room, 'stateTurnStart');
    for (const m of mutations) {
      room = gameReducer(room, m);
    }

    const updated = room.battlefield.find(c => c.uuid === creature.uuid)!;
    expect(updated.state.attackedThisTurn).toBe(false);
  });
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run tests/engine/state-machine.test.ts`
Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/types/card.types.ts src/library/card-factory.ts src/types/game-mutation.types.ts src/engine/game-reducer.ts src/engine/state-machine.ts tests/engine/state-machine.test.ts
git commit -m "feat: add attackedThisTurn flag, cleared at turn start"
```

---

### Task 2: Update attack handler — accept target parameter, support creature-vs-creature combat

**Files:**
- Modify: `src/engine/handlers/attack-handler.ts`
- Test: `tests/engine/attack-handler.test.ts`

**Interfaces:**
- Consumes: `ActionData.targets?: TargetPointer[]`, `CardCharacteristicService.resolvePower()`, `CardCharacteristicService.resolveToughness()`
- Produces: Attack handler now reads `action.targets` to determine target. If target is a player → MODIFY_LIFE (existing). If target is a creature → MODIFY_STATS damage to target AND MODIFY_STATS damage to attacker (defender's power as counter-attack). Sets `attackedThisTurn: true` on attacker.

- [ ] **Step 1: Write the failing tests**

Add these tests to `tests/engine/attack-handler.test.ts`:

```ts
  describe('creature-vs-creature combat', () => {
    it('should validate attack targeting an opponent creature', () => {
      // Put a defender creature on player2's battlefield
      const defender = instantiateCard('empire-servant');
      defender.state.zone = 'battlefield';
      defender.state.ownerId = 'player2';
      defender.state.controllerId = 'player2';
      defender.state.summoningSickness = false;
      room.battlefield.push(defender);

      const attacker = room.battlefield.find(c => c.state.controllerId === 'player1')!;
      const result = attackHandler.validate(room, 'player1', {
        cardUuid: attacker.uuid,
        targets: [{ targetType: 'permanent', cardUuid: defender.uuid }],
      });
      expect(result.success).toBe(true);
    });

    it('should reject attack targeting own creature', () => {
      // Put a second creature on player1's battlefield
      const ownCreature = instantiateCard('empire-servant');
      ownCreature.state.zone = 'battlefield';
      ownCreature.state.ownerId = 'player1';
      ownCreature.state.controllerId = 'player1';
      ownCreature.state.summoningSickness = false;
      room.battlefield.push(ownCreature);

      const attacker = room.battlefield.find(c => c.state.controllerId === 'player1' && c.uuid !== ownCreature.uuid)!;
      const result = attackHandler.validate(room, 'player1', {
        cardUuid: attacker.uuid,
        targets: [{ targetType: 'permanent', cardUuid: ownCreature.uuid }],
      });
      expect(result.success).toBe(false);
      expect(result.reason).toContain('own creature');
    });

    it('should reject attack targeting a non-existent creature', () => {
      const attacker = room.battlefield.find(c => c.state.controllerId === 'player1')!;
      const result = attackHandler.validate(room, 'player1', {
        cardUuid: attacker.uuid,
        targets: [{ targetType: 'permanent', cardUuid: 'nonexistent' }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject attack with already-attacked creature', () => {
      const defender = instantiateCard('empire-servant');
      defender.state.zone = 'battlefield';
      defender.state.ownerId = 'player2';
      defender.state.controllerId = 'player2';
      room.battlefield.push(defender);

      const attacker = room.battlefield.find(c => c.state.controllerId === 'player1')!;
      attacker.state.attackedThisTurn = true;
      const result = attackHandler.validate(room, 'player1', {
        cardUuid: attacker.uuid,
        targets: [{ targetType: 'permanent', cardUuid: defender.uuid }],
      });
      expect(result.success).toBe(false);
      expect(result.reason).toContain('already attacked');
    });
  });

  describe('propose — creature target', () => {
    it('should produce MODIFY_STATS damage effects for both attacker and defender', () => {
      const defender = instantiateCard('empire-servant');
      defender.state.zone = 'battlefield';
      defender.state.ownerId = 'player2';
      defender.state.controllerId = 'player2';
      defender.state.summoningSickness = false;
      room.battlefield.push(defender);

      const attacker = room.battlefield.find(c => c.state.controllerId === 'player1')!;
      const result = attackHandler.propose(room, 'player1', {
        cardUuid: attacker.uuid,
        stackUuid: 'stack-uuid-1',
        targets: [{ targetType: 'permanent', cardUuid: defender.uuid }],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.mutations).toBeDefined();
        apply(result.mutations!);
      }

      // Attacker should be tapped
      const updatedAttacker = room.battlefield.find(c => c.uuid === attacker.uuid)!;
      expect(updatedAttacker.state.isTapped).toBe(true);
      expect(updatedAttacker.state.attackedThisTurn).toBe(true);

      // StackObject should have two effects: damage to defender, damage to attacker
      if (result.success) {
        expect(result.stackObject!.effects.length).toBe(2);
        // First effect: damage to defender (attacker's power)
        const defenderEffect = result.stackObject!.effects[0];
        expect(defenderEffect.action).toBe('MODIFY_STATS');
        expect(defenderEffect.tags).toContain('damage');
        expect(defenderEffect.tags).toContain('combat');
        expect(defenderEffect.targets[0].cardUuid).toBe(defender.uuid);
        // Second effect: damage to attacker (defender's power)
        const attackerEffect = result.stackObject!.effects[1];
        expect(attackerEffect.action).toBe('MODIFY_STATS');
        expect(attackerEffect.tags).toContain('damage');
        expect(attackerEffect.tags).toContain('combat');
        expect(attackerEffect.targets[0].cardUuid).toBe(attacker.uuid);
      }
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine/attack-handler.test.ts -t 'creature-vs-creature|propose — creature'`
Expected: FAIL — validation rejects creature targets, propose doesn't produce two effects.

- [ ] **Step 3: Implement the updated attack handler**

Replace `src/engine/handlers/attack-handler.ts`:

```ts
// src/engine/handlers/attack-handler.ts
import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import type { GameMutation } from '../../types/game-mutation.types';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { CardInstance } from '../../types/card.types';
import type { StackObject, StackEffect, TargetPointer } from '../../types/effect.types';
import { CardCharacteristicService } from '../card-characteristic-service';

function findCardOnBattlefield(room: GameRoom, playerId: PlayerId, cardUuid: string): CardInstance | undefined {
  return room.battlefield.find(c => c.uuid === cardUuid && c.state.controllerId === playerId);
}

function findAnyCardOnBattlefield(room: GameRoom, cardUuid: string): CardInstance | undefined {
  return room.battlefield.find(c => c.uuid === cardUuid);
}

export const attackHandler: ActionHandler = {
  validate(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    if (!action.cardUuid) {
      return { success: false, phase: 'validate', reason: 'cardUuid is required' };
    }
    // Must be your turn
    if (room.activeTurnPlayerId !== playerId) {
      return { success: false, phase: 'validate', reason: 'Not your turn' };
    }

    // Must be in battle phase
    if (room.currentPhase !== 'stateBattlePhase') {
      return { success: false, phase: 'validate', reason: 'Can only attack during battle phase' };
    }

    const card = findCardOnBattlefield(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'validate', reason: 'Creature not found on your battlefield' };
    }

    // Must be a creature
    if (!card.blueprint.cardTypes.includes('Creature')) {
      return { success: false, phase: 'validate', reason: 'Only creatures can attack' };
    }

    // Must be untapped
    if (card.state.isTapped) {
      return { success: false, phase: 'validate', reason: 'Creature is already tapped' };
    }

    // Must not have summoning sickness
    if (card.state.summoningSickness) {
      return { success: false, phase: 'validate', reason: 'Creature has summoning sickness' };
    }

    // Must not have already attacked this turn
    if (card.state.attackedThisTurn) {
      return { success: false, phase: 'validate', reason: 'Creature has already attacked this turn' };
    }

    // Validate target
    const targets = action.targets as TargetPointer[] | undefined;
    if (targets && targets.length > 0) {
      const target = targets[0];

      // Target is a creature
      if (target.targetType === 'permanent' && target.cardUuid) {
        const defender = findAnyCardOnBattlefield(room, target.cardUuid);
        if (!defender) {
          return { success: false, phase: 'validate', reason: 'Target creature not found on battlefield' };
        }
        if (!defender.blueprint.cardTypes.includes('Creature')) {
          return { success: false, phase: 'validate', reason: 'Target is not a creature' };
        }
        // Cannot attack your own creatures
        if (defender.state.controllerId === playerId) {
          return { success: false, phase: 'validate', reason: 'Cannot attack your own creature' };
        }
        // Flying evasion: non-flying creatures cannot attack flying creatures
        const attackerHasFlying = hasKeyword(card, 'Flying');
        const defenderHasFlying = hasKeyword(defender, 'Flying');
        if (defenderHasFlying && !attackerHasFlying) {
          return { success: false, phase: 'validate', reason: 'Cannot attack a Flying creature without Flying' };
        }
      }
      // Target is a player — always valid (attack the face)
      // No additional validation needed for player targets
    }
    // If no targets provided, default to attacking the opponent player (attack the face)

    return { success: true };
  },

  propose(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    if (!action.cardUuid) {
      return { success: false, phase: 'propose', reason: 'cardUuid is required' };
    }
    const card = findCardOnBattlefield(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'propose', reason: 'Creature disappeared from battlefield' };
    }

    const mutations: GameMutation[] = [];

    // --- COST: Tap the creature and mark as attacked ---
    mutations.push({ type: 'TAP_CARD', cardUuid: card.uuid });
    mutations.push({ type: 'SET_ATTACKED_THIS_TURN', cardUuid: card.uuid, value: true });

    const attackerPower = CardCharacteristicService.resolvePower(room, card);
    const targets = action.targets as TargetPointer[] | undefined;
    const targetCreature = targets && targets.length > 0 && targets[0].cardUuid
      ? findAnyCardOnBattlefield(room, targets[0].cardUuid)
      : undefined;

    const effects: StackEffect[] = [];

    if (targetCreature) {
      // --- Creature-vs-creature combat ---
      const defenderPower = CardCharacteristicService.resolvePower(room, targetCreature);
      const defenderToughness = CardCharacteristicService.resolveToughness(room, targetCreature);

      // Attacker deals damage to defender
      effects.push({
        action: 'MODIFY_STATS',
        params: { damage: attackerPower },
        tags: ['damage', 'combat'],
        targets: [{ targetType: 'permanent', cardUuid: targetCreature.uuid }],
      });

      // Defender deals counter-attack damage to attacker
      effects.push({
        action: 'MODIFY_STATS',
        params: { damage: defenderPower },
        tags: ['damage', 'combat'],
        targets: [{ targetType: 'permanent', cardUuid: card.uuid }],
      });

      // Trample: excess damage (attackerPower - defenderToughness) dealt to defending player
      if (hasKeyword(card, 'Trample') && attackerPower > defenderToughness) {
        const excessDamage = attackerPower - defenderToughness;
        const defenderControllerId = targetCreature.state.controllerId;
        effects.push({
          action: 'MODIFY_LIFE',
          params: { amount: -excessDamage },
          tags: ['damage', 'combat', 'trample'],
          targets: [{ targetType: 'player', playerId: defenderControllerId }],
        });
      }
    } else {
      // --- Attack the face (opponent player) ---
      const opponentId = room.player1Id === playerId ? room.player2Id! : room.player1Id;
      effects.push({
        action: 'MODIFY_LIFE',
        params: { amount: -attackerPower },
        tags: ['damage', 'combat'],
        targets: [{ targetType: 'player', playerId: opponentId }],
      });
    }

    const stackObj: StackObject = {
      uuid: (action.stackUuid as string) || '',
      type: 'activated',
      controllerId: playerId,
      source: card,
      effects,
      countered: false,
    };

    mutations.push({ type: 'PUSH_STACK', stackObject: stackObj });

    return { success: true, stackObject: stackObj, mutations, attackingCard: card };
  },

  resolve(_room: GameRoom, _stackObj: StackObject): ActionResult {
    return { success: true };
  },
};

/** Check if a card has a keyword (from card_data.json `keywords` array). */
function hasKeyword(card: CardInstance, keyword: string): boolean {
  const keywords = (card.blueprint as any).keywords as string[] | undefined;
  return keywords?.includes(keyword) ?? false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine/attack-handler.test.ts`
Expected: All tests PASS (existing + new).

- [ ] **Step 5: Verify existing tests still pass**

Run: `npx vitest run`
Expected: All 254+ tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/handlers/attack-handler.ts tests/engine/attack-handler.test.ts
git commit -m "feat: attack handler supports creature targets with counter-attack damage"
```

---

### Task 3: State-Based Actions — creature death from damage, player death from life ≤ 0

**Files:**
- Create: `src/engine/state-based-actions.ts`
- Modify: `src/engine/game-engine.ts` — call SBA after each mutation batch in `applyMutations()`
- Test: `tests/engine/state-based-actions.test.ts`

**Interfaces:**
- Consumes: `GameRoom`, `CardCharacteristicService.resolveToughness()`, `GameMutation`
- Produces: `checkStateBasedActions(room: GameRoom): GameMutation[]` — returns DESTROY mutations for creatures with `damageTaken >= toughness`, and a game-over signal for players with `life <= 0`.

- [ ] **Step 1: Write the failing tests**

Create `tests/engine/state-based-actions.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { checkStateBasedActions } from '../../src/engine/state-based-actions';
import { gameReducer } from '../../src/engine/game-reducer';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';
import type { GameMutation } from '../../src/types/game-mutation.types';

function apply(room: GameRoom, mutations: GameMutation[]): GameRoom {
  let r = room;
  for (const m of mutations) {
    r = gameReducer(r, m);
  }
  return r;
}

describe('checkStateBasedActions', () => {
  let room: GameRoom;

  beforeEach(() => {
    room = createTestRoom();
  });

  it('returns empty array when no creatures are damaged', () => {
    const creature = instantiateCard('empire-servant');
    creature.state.zone = 'battlefield';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    room.battlefield.push(creature);

    const result = checkStateBasedActions(room);
    expect(result).toEqual([]);
  });

  it('destroys a creature when damageTaken >= toughness', () => {
    const creature = instantiateCard('empire-servant'); // 1/1
    creature.state.zone = 'battlefield';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    creature.state.damageTaken = 1; // damageTaken (1) >= toughness (1)
    room.battlefield.push(creature);

    const result = checkStateBasedActions(room);
    expect(result.length).toBeGreaterThan(0);
    const destroyMutations = result.filter(m => m.type === 'MOVE_CARD' && m.from === 'battlefield' && m.to === 'graveyard');
    expect(destroyMutations.length).toBe(1);
    expect(destroyMutations[0]).toMatchObject({
      type: 'MOVE_CARD',
      cardUuid: creature.uuid,
      from: 'battlefield',
      to: 'graveyard',
    });
  });

  it('does not destroy a creature when damageTaken < toughness', () => {
    const creature = instantiateCard('empire-servant'); // 1/1
    creature.state.zone = 'battlefield';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    creature.state.damageTaken = 0;
    room.battlefield.push(creature);

    const result = checkStateBasedActions(room);
    const destroyMutations = result.filter(m => m.type === 'MOVE_CARD' && m.from === 'battlefield' && m.to === 'graveyard');
    expect(destroyMutations.length).toBe(0);
  });

  it('destroys multiple damaged creatures in one check', () => {
    const c1 = instantiateCard('empire-servant'); // 1/1
    c1.state.zone = 'battlefield';
    c1.state.ownerId = 'player1';
    c1.state.controllerId = 'player1';
    c1.state.damageTaken = 2;
    room.battlefield.push(c1);

    const c2 = instantiateCard('empire-servant'); // 1/1
    c2.state.zone = 'battlefield';
    c2.state.ownerId = 'player2';
    c2.state.controllerId = 'player2';
    c2.state.damageTaken = 1;
    room.battlefield.push(c2);

    const result = checkStateBasedActions(room);
    const destroyMutations = result.filter(m => m.type === 'MOVE_CARD' && m.from === 'battlefield' && m.to === 'graveyard');
    expect(destroyMutations.length).toBe(2);
  });

  it('returns game-over signal when a player has life <= 0', () => {
    room.players['player1'].life = 0;

    const result = checkStateBasedActions(room);
    const gameOverMutations = result.filter(m => m.type === 'SET_PHASE' && m.phase === 'gameOver');
    expect(gameOverMutations.length).toBe(1);
  });

  it('returns game-over signal when a player has negative life', () => {
    room.players['player2'].life = -5;

    const result = checkStateBasedActions(room);
    const gameOverMutations = result.filter(m => m.type === 'SET_PHASE' && m.phase === 'gameOver');
    expect(gameOverMutations.length).toBe(1);
  });

  it('does not return game-over when both players have positive life', () => {
    room.players['player1'].life = 20;
    room.players['player2'].life = 1;

    const result = checkStateBasedActions(room);
    const gameOverMutations = result.filter(m => m.type === 'SET_PHASE' && m.phase === 'gameOver');
    expect(gameOverMutations.length).toBe(0);
  });

  it('respects toughness from continuous effects (via CardCharacteristicService)', () => {
    const creature = instantiateCard('empire-servant'); // 1/1
    creature.state.zone = 'battlefield';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    creature.state.damageTaken = 2;
    room.battlefield.push(creature);

    // Add a continuous effect giving +0/+2 (toughness becomes 3)
    room.continuousEffectPool.push({
      source: 'emblem',
      layer: 7,
      effect: { type: 'STAT_DELTA', toughness: 2 },
      scope: { cardUuid: creature.uuid },
      duration: 'PERMANENT',
    });

    // damageTaken (2) < toughness (1 + 2 = 3) → should NOT be destroyed
    const result = checkStateBasedActions(room);
    const destroyMutations = result.filter(m => m.type === 'MOVE_CARD' && m.from === 'battlefield' && m.to === 'graveyard');
    expect(destroyMutations.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine/state-based-actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the SBA module**

Create `src/engine/state-based-actions.ts`:

```ts
// src/engine/state-based-actions.ts
// State-Based Actions (SBA) — checked after every mutation batch.
// Hearthstone-style: creatures die when damageTaken >= toughness.
// Players lose when life <= 0.
//
// MTG CR 704.3: SBAs are checked whenever a player would receive priority.
// We check them after each mutation batch in GameEngine.applyMutations().

import { CardCharacteristicService } from './card-characteristic-service';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom } from '../types/game.room.types';

/**
 * Check all state-based actions and return mutations to apply.
 * Pure function — does not mutate the room.
 *
 * Checks performed (in order):
 * 1. Creatures with damageTaken >= toughness → DESTROY (MOVE_CARD battlefield→graveyard)
 * 2. Players with life <= 0 → game over (SET_PHASE gameOver)
 */
export function checkStateBasedActions(room: GameRoom): GameMutation[] {
  const mutations: GameMutation[] = [];

  // 1. Destroy creatures with lethal damage
  for (const card of room.battlefield) {
    if (!card.blueprint.cardTypes.includes('Creature')) continue;

    const toughness = CardCharacteristicService.resolveToughness(room, card);
    if (card.state.damageTaken >= toughness) {
      mutations.push({
        type: 'MOVE_CARD',
        cardUuid: card.uuid,
        playerId: card.state.ownerId,
        from: 'battlefield',
        to: 'graveyard',
      });
    }
  }

  // 2. Check player death
  for (const player of Object.values(room.players)) {
    if (player.life <= 0) {
      mutations.push({ type: 'SET_PHASE', phase: 'gameOver' });
      break; // Game is over, no need to check further
    }
  }

  return mutations;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine/state-based-actions.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Integrate SBA into GameEngine.applyMutations()**

In `src/engine/game-engine.ts`, modify the `applyMutations()` method. After the `while (this.mutationCollector.length > 0)` loop that drains trigger-produced mutations, add an SBA check loop:

```ts
  applyMutations(mutations: GameMutation[]): GameMutation[] {
    const allApplied: GameMutation[] = [];

    const apply = (muts: GameMutation[]): void => {
      for (const m of muts) {
        this.room = gameReducer(this.room, m);
        allApplied.push(m);

        // Emit PERMANENT_LEFT when a card leaves the battlefield for graveyard
        if (m.type === 'MOVE_CARD' && m.from === 'battlefield' && m.to === 'graveyard') {
          const movedCard = this.room.players[m.playerId]?.graveyard.find(c => c.uuid === m.cardUuid);
          if (movedCard) {
            this.eventBus.emit({
              eventId: 'PERMANENT_LEFT',
              roomId: this.room.roomId,
              payload: { card: movedCard, controllerId: movedCard.state.controllerId },
            });
          }
        }

        // ... rest of existing apply() body (housekeeping, LIFE_CHANGED) ...
      }
    };

    apply(mutations);

    // Drain trigger-produced mutations (may produce more triggers)
    while (this.mutationCollector.length > 0) {
      const triggered = this.mutationCollector.splice(0);
      apply(triggered);
    }

    // --- State-Based Actions: check after each mutation batch ---
    // SBA runs in a loop because destroying a creature may cause more SBAs
    // (e.g., an anthem effect leaving could reduce another creature's toughness).
    let sbaMutations = checkStateBasedActions(this.room);
    while (sbaMutations.length > 0) {
      apply(sbaMutations);
      // Drain any triggers from SBA destructions (e.g., ON_DIE)
      while (this.mutationCollector.length > 0) {
        const triggered = this.mutationCollector.splice(0);
        apply(triggered);
      }
      sbaMutations = checkStateBasedActions(this.room);
    }

    return allApplied;
  }
```

Add the import at the top of `src/engine/game-engine.ts`:

```ts
import { checkStateBasedActions } from './state-based-actions';
```

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/engine/state-based-actions.ts src/engine/game-engine.ts tests/engine/state-based-actions.test.ts
git commit -m "feat: state-based actions — creatures die from lethal damage, players lose at 0 life"
```

---

### Task 4: Wire ON_DIE and ON_DAMAGE_TAKEN triggers in TriggerManager

**Files:**
- Modify: `src/engine/trigger-manager.ts` — add ON_DIE and ON_DAMAGE_TAKEN listeners
- Modify: `src/engine/game-engine.ts` — emit ON_DIE when SBA destroys a creature, emit ON_DAMAGE_TAKEN when SET_DAMAGE is applied
- Test: `tests/engine/trigger-manager.test.ts`

**Interfaces:**
- Consumes: `EventBus.emit()`, `TriggerEvent.ON_DIE`, `TriggerEvent.ON_DAMAGE_TAKEN`
- Produces: `ON_DIE` fires when a creature is destroyed by SBA (MOVE_CARD battlefield→graveyard with lethal damage). `ON_DAMAGE_TAKEN` fires when SET_DAMAGE is applied to a creature.

- [ ] **Step 1: Add ON_DIE and ON_DAMAGE_TAKEN listeners in TriggerManager**

In `src/engine/trigger-manager.ts`, add two new `onTrigger` calls at the end of the constructor (after the existing `onTrigger('LIFE_CHANGED', 'ON_LIFE_GAIN')` line):

```ts
    onTrigger('PERMANENT_DIED', 'ON_DIE');
    onTrigger('DAMAGE_TAKEN', 'ON_DAMAGE_TAKEN');
```

- [ ] **Step 2: Emit PERMANENT_DIED from GameEngine when SBA destroys a creature**

In `src/engine/game-engine.ts`, in the `apply()` inner function, modify the PERMANENT_LEFT emission block to also emit PERMANENT_DIED when the move is a destruction (from battlefield to graveyard). The PERMANENT_LEFT emission already exists — add PERMANENT_DIED right after it:

```ts
        // Emit PERMANENT_LEFT when a card leaves the battlefield for graveyard
        if (m.type === 'MOVE_CARD' && m.from === 'battlefield' && m.to === 'graveyard') {
          const movedCard = this.room.players[m.playerId]?.graveyard.find(c => c.uuid === m.cardUuid);
          if (movedCard) {
            this.eventBus.emit({
              eventId: 'PERMANENT_LEFT',
              roomId: this.room.roomId,
              payload: { card: movedCard, controllerId: movedCard.state.controllerId },
            });
            // Also emit PERMANENT_DIED for death triggers (ON_DIE).
            // PERMANENT_LEFT fires for any leave (bounce, exile, destroy).
            // PERMANENT_DIED fires specifically when a creature is destroyed (lethal damage / destroy effect).
            this.eventBus.emit({
              eventId: 'PERMANENT_DIED',
              roomId: this.room.roomId,
              payload: { card: movedCard, controllerId: movedCard.state.controllerId },
            });
          }
        }
```

- [ ] **Step 3: Emit DAMAGE_TAKEN when SET_DAMAGE is applied to a creature**

In `src/engine/game-engine.ts`, in the `apply()` inner function, add after the existing `SET_DAMAGE` handling (which currently doesn't emit anything). Add inside the `for (const m of muts)` loop, after the MOVE_CARD block:

```ts
        // Emit DAMAGE_TAKEN when a creature takes damage
        if (m.type === 'SET_DAMAGE') {
          const damagedCard = this.room.battlefield.find(c => c.uuid === m.cardUuid);
          if (damagedCard && damagedCard.blueprint.cardTypes.includes('Creature')) {
            this.eventBus.emit({
              eventId: 'DAMAGE_TAKEN',
              roomId: this.room.roomId,
              payload: { card: damagedCard, controllerId: damagedCard.state.controllerId, amount: m.amount },
            });
          }
        }
```

- [ ] **Step 4: Write the tests**

In `tests/engine/trigger-manager.test.ts`, add tests for ON_DIE and ON_DAMAGE_TAKEN. First check what existing tests look like:

Run: `npx vitest run tests/engine/trigger-manager.test.ts`
Expected: Existing tests PASS.

Add these tests to the file:

```ts
  it('should fire ON_DIE trigger when PERMANENT_DIED event is emitted', () => {
    // Create a card with an ON_DIE triggered ability
    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.ownerId = 'player1';
    card.state.controllerId = 'player1';
    // Manually add an ON_DIE trigger to the card blueprint for testing
    (card.blueprint as any).abilities.push({
      type: 'triggered',
      triggerCondition: 'ON_DIE',
      effect: { effectId: 'DRAW', params: { amount: 1 } },
      castSpeed: 'instant',
    });
    room.battlefield.push(card);

    // Emit PERMANENT_DIED
    eventBus.emit({
      eventId: 'PERMANENT_DIED',
      roomId: room.roomId,
      payload: { card, controllerId: 'player1' },
    });

    // Should have pushed a triggered StackObject
    const pushMutations = collector.filter(m => m.type === 'PUSH_STACK');
    expect(pushMutations.length).toBe(1);
    const stackObj = (pushMutations[0] as any).stackObject;
    expect(stackObj.type).toBe('triggered');
    expect(stackObj.source.uuid).toBe(card.uuid);
  });

  it('should fire ON_DAMAGE_TAKEN trigger when DAMAGE_TAKEN event is emitted', () => {
    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.ownerId = 'player1';
    card.state.controllerId = 'player1';
    (card.blueprint as any).abilities.push({
      type: 'triggered',
      triggerCondition: 'ON_DAMAGE_TAKEN',
      effect: { effectId: 'DRAW', params: { amount: 1 } },
      castSpeed: 'instant',
    });
    room.battlefield.push(card);

    eventBus.emit({
      eventId: 'DAMAGE_TAKEN',
      roomId: room.roomId,
      payload: { card, controllerId: 'player1', amount: 3 },
    });

    const pushMutations = collector.filter(m => m.type === 'PUSH_STACK');
    expect(pushMutations.length).toBe(1);
  });
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/engine/trigger-manager.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/engine/trigger-manager.ts src/engine/game-engine.ts tests/engine/trigger-manager.test.ts
git commit -m "feat: wire ON_DIE and ON_DAMAGE_TAKEN triggers"
```

---

### Task 5: Integration test — full combat → SBA → death trigger flow

**Files:**
- Create: `tests/engine/combat-integration.test.ts`

**Interfaces:**
- Consumes: `GameEngine`, `createTestRoom`, `attackHandler`, `checkStateBasedActions`, `gameReducer`
- Produces: End-to-end test proving the full pipeline: attack creature → counter-damage → SBA kill → death trigger fires.

- [ ] **Step 1: Write the integration test**

Create `tests/engine/combat-integration.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { registerAction } from '../../src/engine/action-registry';
import { attackHandler } from '../../src/engine/handlers/attack-handler';
import { gameReducer } from '../../src/engine/game-reducer';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';
import type { GameMutation } from '../../src/types/game-mutation.types';

describe('Combat Integration — attack → SBA → death trigger', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom();
    room.currentPhase = 'stateBattlePhase';
    registerAction('attack', attackHandler);

    // Put attacker (3/3) on player1's battlefield
    const attacker = instantiateCard('empire-servant');
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1';
    attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    // Override power/toughness for test clarity
    (attacker.blueprint as any).power = 3;
    (attacker.blueprint as any).toughness = 3;
    room.battlefield.push(attacker);

    // Put defender (1/1) on player2's battlefield with an ON_DIE trigger
    const defender = instantiateCard('empire-servant');
    defender.state.zone = 'battlefield';
    defender.state.ownerId = 'player2';
    defender.state.controllerId = 'player2';
    defender.state.summoningSickness = false;
    (defender.blueprint as any).power = 1;
    (defender.blueprint as any).toughness = 1;
    // Give defender an ON_DIE trigger that draws a card for its controller
    (defender.blueprint as any).abilities = [
      ...defender.blueprint.abilities,
      {
        type: 'triggered',
        triggerCondition: 'ON_DIE',
        effect: { effectId: 'DRAW', params: { amount: 1 } },
        castSpeed: 'instant',
      },
    ];
    room.battlefield.push(defender);

    engine = new GameEngine(room);
    engine.initRoom();
  });

  it('full combat flow: attack creature → both take damage → defender dies → death trigger fires', () => {
    const attacker = room.battlefield.find(c => c.state.controllerId === 'player1')!;
    const defender = room.battlefield.find(c => c.state.controllerId === 'player2')!;

    // Propose attack targeting the defender creature
    const result = engine.proposeAndStack('player1', 'attack', {
      cardUuid: attacker.uuid,
      targets: [{ targetType: 'permanent', cardUuid: defender.uuid }],
    });

    expect(result.success).toBe(true);

    // Attacker should be tapped and marked as attacked
    const roomAfterPropose = engine.roomState;
    const attackerAfter = roomAfterPropose.battlefield.find(c => c.uuid === attacker.uuid)!;
    expect(attackerAfter.state.isTapped).toBe(true);
    expect(attackerAfter.state.attackedThisTurn).toBe(true);

    // Stack should have the attack StackObject
    expect(roomAfterPropose.stack.length).toBe(1);

    // Resolve the stack (this applies damage effects, then SBA runs)
    const resolveResult = engine.resolveTopOfStack();
    expect(resolveResult.success).toBe(true);

    const roomAfterResolve = engine.roomState;

    // Defender should be in graveyard (destroyed by SBA: damageTaken 3 >= toughness 1)
    const defenderInGraveyard = roomAfterResolve.players['player2'].graveyard.find(
      c => c.uuid === defender.uuid
    );
    expect(defenderInGraveyard).toBeDefined();

    // Attacker should still be on battlefield with 1 damage (defender's counter-attack)
    const attackerOnBoard = roomAfterResolve.battlefield.find(c => c.uuid === attacker.uuid)!;
    expect(attackerOnBoard).toBeDefined();
    expect(attackerOnBoard.state.damageTaken).toBe(1); // defender's power

    // ON_DIE trigger should have fired — a triggered StackObject should be on the stack
    // (the death trigger pushes a new StackObject for the draw)
    expect(roomAfterResolve.stack.length).toBeGreaterThanOrEqual(1);
    const deathTrigger = roomAfterResolve.stack.find(
      s => s.type === 'triggered' && s.source.uuid === defender.uuid
    );
    expect(deathTrigger).toBeDefined();
  });

  it('attack the face: opponent player takes damage, no SBA destruction', () => {
    const attacker = room.battlefield.find(c => c.state.controllerId === 'player1')!;
    const initialLife = room.players['player2'].life;

    const result = engine.proposeAndStack('player1', 'attack', {
      cardUuid: attacker.uuid,
      // No targets = attack the face
    });

    expect(result.success).toBe(true);

    // Resolve
    const resolveResult = engine.resolveTopOfStack();
    expect(resolveResult.success).toBe(true);

    const roomAfter = engine.roomState;
    // Player2 should have taken 3 damage (attacker's power)
    expect(roomAfter.players['player2'].life).toBe(initialLife - 3);
  });

  it('mutual destruction: both creatures have lethal damage → both die', () => {
    // Make attacker also a 1/1 so both die
    const attacker = room.battlefield.find(c => c.state.controllerId === 'player1')!;
    (attacker.blueprint as any).power = 1;
    (attacker.blueprint as any).toughness = 1;

    const defender = room.battlefield.find(c => c.state.controllerId === 'player2')!;
    (defender.blueprint as any).power = 1;
    (defender.blueprint as any).toughness = 1;

    const result = engine.proposeAndStack('player1', 'attack', {
      cardUuid: attacker.uuid,
      targets: [{ targetType: 'permanent', cardUuid: defender.uuid }],
    });
    expect(result.success).toBe(true);

    const resolveResult = engine.resolveTopOfStack();
    expect(resolveResult.success).toBe(true);

    const roomAfter = engine.roomState;

    // Both should be in graveyards
    const attackerInYard = roomAfter.players['player1'].graveyard.find(c => c.uuid === attacker.uuid);
    const defenderInYard = roomAfter.players['player2'].graveyard.find(c => c.uuid === defender.uuid);
    expect(attackerInYard).toBeDefined();
    expect(defenderInYard).toBeDefined();

    // Both should be off the battlefield
    expect(roomAfter.battlefield.find(c => c.uuid === attacker.uuid)).toBeUndefined();
    expect(roomAfter.battlefield.find(c => c.uuid === defender.uuid)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the integration tests**

Run: `npx vitest run tests/engine/combat-integration.test.ts`
Expected: All integration tests PASS.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/engine/combat-integration.test.ts
git commit -m "test: combat integration — attack → SBA → death trigger flow"
```

---

### Task 6: Client — attack target selection UI

**Files:**
- Modify: `src/client/targeting.ts` — add `needsAttackTarget()` helper
- Modify: `src/client/hooks/useGameActions.ts` — no changes needed (already sends targets)
- Modify: `src/client/store/gameStore.ts` — add attack targeting state
- Modify: `src/client/components/` — update battlefield to support attack target selection

**Interfaces:**
- Consumes: `TargetingState` (Zustand), `useGameActions().playerAction()`, `needsTargets()`
- Produces: When a player clicks "Attack" on their creature during battle phase, the client enters targeting mode. Tapping an opponent creature or opponent player panel selects the target. Confirm sends `playerAction('attack', cardUuid, targets)`.

**Note:** The client-side UI changes depend on the existing React component structure. Since the exact component layout may vary, this task provides the core logic changes. The UI wiring should follow the existing targeting pattern used for spell casting (fire-bolt target selection).

- [ ] **Step 1: Add `needsAttackTarget()` to targeting.ts**

In `src/client/targeting.ts`, add:

```ts
/**
 * Does this attack action need a target choice?
 * Always returns true for attack — the player must choose between
 * attacking the opponent player or an opponent creature.
 * Returns a synthetic TargetingDefinition for the client targeting UI.
 */
export function needsAttackTarget(): TargetingDefinition {
  return {
    type: 'permanent',
    cardTypes: ['Creature'],
    required: false,  // optional — can also attack the player
    minTargets: 0,
    maxTargets: 1,
  };
}
```

- [ ] **Step 2: Update gameStore for attack targeting**

In `src/client/store/gameStore.ts`, the existing `TargetingState` already supports `cardUuid`, `actionId`, `targeting`, `collected`, and `toggleTarget`/`confirmTargeting`. No structural changes needed — the attack flow reuses the same targeting state.

Add an `enterAttackTargeting` action:

```ts
  enterAttackTargeting: (cardUuid: string) => void;
```

And implement it in the store:

```ts
  enterAttackTargeting: (cardUuid) => {
    set({
      targeting: {
        cardUuid,
        zone: 'battlefield',
        actionId: 'attack',
        targeting: {
          type: 'permanent',
          cardTypes: ['Creature'],
          required: false,
          minTargets: 0,
          maxTargets: 1,
        },
        collected: [],
      },
    });
  },
```

- [ ] **Step 3: Wire attack button to targeting mode**

In the battlefield component (likely `src/client/components/Battlefield.tsx` or similar), when the user clicks the "Attack" action option:

1. Call `enterAttackTargeting(cardUuid)` to enter targeting mode.
2. The targeting UI highlights opponent creatures and the opponent player panel as valid targets.
3. When the user taps an opponent creature → `toggleTarget(targetPointer)` adds it.
4. When the user taps the opponent player panel → `toggleTarget({ targetType: 'player', playerId: opponentId })`.
5. Confirm calls `playerAction('attack', cardUuid, collectedTargets)`.

The exact component code depends on the current UI structure. Follow the existing fire-bolt targeting pattern.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean (no errors).

- [ ] **Step 5: Commit**

```bash
git add src/client/targeting.ts src/client/store/gameStore.ts src/client/components/
git commit -m "feat: client attack target selection UI"
```

---

### Task 7: Update option-service for attack target flow

**Files:**
- Modify: `src/engine/option-service.ts`

**Interfaces:**
- Consumes: `ActionOption`
- Produces: Attack option no longer hidden — it's now a real choice that opens targeting.

- [ ] **Step 1: Update attack option description**

In `src/engine/option-service.ts`, update the attack option to indicate target selection:

```ts
    // Attack option (creatures only, during your combat phase)
    if (card.blueprint.cardTypes.includes('Creature')) {
      const canAttack = !card.state.isTapped && !card.state.summoningSickness
        && !card.state.attackedThisTurn
        && room.activeTurnPlayerId === playerId
        && room.currentPhase === 'stateBattlePhase';
      options.push({
        actionId: ACTION_IDS.attack,
        label: 'Attack',
        description: 'Choose a target: opponent player or creature',
        disabled: !canAttack,
        disabledReason: card.state.isTapped ? 'Already tapped'
          : card.state.summoningSickness ? 'Summoning sickness'
          : card.state.attackedThisTurn ? 'Already attacked this turn'
          : room.activeTurnPlayerId !== playerId ? 'Not your turn'
          : room.currentPhase !== 'stateBattlePhase' ? 'Not in battle phase'
          : undefined,
      });
    }
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/engine/option-service.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/engine/option-service.ts
git commit -m "feat: update attack option with target selection description and attackedThisTurn check"
```

---

## Self-Review

### 1. Spec Coverage

| Requirement | Task |
|---|---|
| Attack handler accepts target (player or creature) | Task 2 |
| Counter-attack damage (defender deals damage to attacker) | Task 2 |
| State-based actions: creatures die from lethal damage | Task 3 |
| State-based actions: players lose at life ≤ 0 | Task 3 |
| Death triggers (ON_DIE) wired in TriggerManager | Task 4 |
| Damage taken triggers (ON_DAMAGE_TAKEN) wired | Task 4 |
| "Attacked this turn" per-turn flag | Task 1 |
| Flying evasion (non-flyers can't attack flyers) | Task 2 (in validate) |
| Trample excess damage to player | Task 2 (in propose) |
| Client attack target selection UI | Task 6 |
| Option service updated for attack flow | Task 7 |
| Integration test (attack → SBA → death trigger) | Task 5 |

### 2. Placeholder Scan

No TBDs, TODOs, or "implement later" markers. All code is concrete.

### 3. Type Consistency

- `SET_ATTACKED_THIS_TURN` mutation defined in Task 1, used in Task 2 (propose) and Task 1 (state-machine).
- `checkStateBasedActions()` defined in Task 3, called in Task 3 (game-engine integration).
- `PERMANENT_DIED` event emitted in Task 4 (game-engine), consumed in Task 4 (trigger-manager).
- `DAMAGE_TAKEN` event emitted in Task 4 (game-engine), consumed in Task 4 (trigger-manager).
- `hasKeyword()` helper defined in Task 2, used for Flying and Trample checks.
- `attackedThisTurn` on CardState defined in Task 1, checked in Task 2 (validate) and Task 7 (option-service).
- All types referenced in later tasks are defined in earlier tasks.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-06-battle-mechanics.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?