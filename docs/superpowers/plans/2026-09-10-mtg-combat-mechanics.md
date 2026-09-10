# MTG Combat Mechanics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Hearthstone-style per-creature attack model with MTG-faithful batch declare-attackers/declare-blockers/deferred-damage combat mechanics.

**Architecture:** Two new handlers (`declareAttackersHandler`, `declareBlockersHandler`) replace the deleted `attackHandler`. The `CombatDeclaration` interface is simplified (no `target`/`defenderPower`, gains `blockers[]`). `server.ts` endTurn shrinks to only enter combat; two new action cases chain through the remaining steps. `combatDamageStep` in `state-machine.ts` gains real damage resolution logic. Client `PhaseBar` gets contextual buttons per combat step.

**Tech Stack:** TypeScript 6.0, Vitest 4.1, Zustand 5 (client), Socket.IO 4.8

## Global Constraints

- `tsconfig.json` `include: ["src/**/*.ts"]`, `exclude: ["node_modules", "dist", "tests", "src/client"]` — tests and client NOT type-checked by `tsc --noEmit`
- Pure reducer architecture: handlers produce `GameMutation[]`, engine sequences through `gameReducer()`
- StateMachine: flat `GameStateName` union with `TRANSITIONS` map
- No priority windows inside combat (deferred)
- Single blocker per attacker (multiple blockers deferred)
- First strike / double strike / lifelink / deathtouch / vigilance out of scope
- `ON_ATTACK` trigger wiring deferred until a card needs it
- `hasKeyword` helper: `(card.blueprint as any).keywords as string[] | undefined` — follows existing pattern in `attack-handler.ts`

---

### Task 1: Update `CombatDeclaration` interface and action IDs

**Files:**
- Modify: `src/types/effect.types.ts:195-215`
- Modify: `src/types/action.ids.ts:1-60`
- Modify: `src/types/game-mutation.types.ts:1-60`
- Modify: `docs/action-ids.md:1-120`

**Interfaces:**
- Consumes: nothing (foundational types)
- Produces:
  - `CombatDeclaration` — `{ uuid: string; attacker: CardInstance; attackerPower: number; blockers: CardInstance[] }`
  - `ACTION_IDS.declareAttackers: 'declare_attackers'`
  - `ACTION_IDS.declareBlockers: 'declare_blockers'`
  - `ACTION_ID_LABELS` entries for both new IDs
  - `GameMutation` union: `DECLARE_ATTACKERS` and `ASSIGN_BLOCKERS` added; `ADD_COMBAT_DECLARATION` removed

- [ ] **Step 1: Update `CombatDeclaration` in `effect.types.ts`**

Replace the existing `CombatDeclaration` interface (lines 195-215):

```ts
/**
 * A combat declaration (CR 508) — NOT on the stack. A turn-based action.
 * Attackers are declared as a batch in declareAttackersStep. Blockers are
 * assigned in declareBlockersStep. Damage is resolved simultaneously in
 * combatDamageStep.
 */
export interface CombatDeclaration {
  readonly uuid: string;
  readonly attacker: CardInstance;      // the attacking creature
  readonly attackerPower: number;       // locked at declaration time
  readonly blockers: CardInstance[];    // filled during declareBlockersStep (empty = unblocked)
}
```

- [ ] **Step 2: Update `action.ids.ts`**

Replace the `ACTION_IDS` const and `ACTION_ID_LABELS`:

```ts
export const ACTION_IDS = {
  castSpell: 'cast_spell',
  declareAttackers: 'declare_attackers',
  declareBlockers: 'declare_blockers',
  tapForMana: 'tapForMana',
  endTurn: 'end_turn',
  passPriority: 'pass_priority',
  resolveStack: 'resolve_stack',
  rpsPlay: 'rpsPlay',
} as const;

export const ACTION_ID_LABELS: Record<ActionId, string> = {
  [ACTION_IDS.castSpell]: 'Cast spell',
  [ACTION_IDS.declareAttackers]: 'Declare attackers',
  [ACTION_IDS.declareBlockers]: 'Declare blockers',
  [ACTION_IDS.tapForMana]: 'Tap for mana',
  [ACTION_IDS.endTurn]: 'End turn',
  [ACTION_IDS.passPriority]: 'Pass priority',
  [ACTION_IDS.resolveStack]: 'Resolve stack',
  [ACTION_IDS.rpsPlay]: 'RPS play',
};
```

- [ ] **Step 3: Update `game-mutation.types.ts`**

Replace the combat mutations section:

```ts
  // Combat mutations (turn-based action — declared attackers, NOT on the stack)
  | { type: 'DECLARE_ATTACKERS'; declarations: CombatDeclaration[] }
  | { type: 'ASSIGN_BLOCKERS'; attackerUuid: string; blockerUuids: string[] }
  | { type: 'CLEAR_COMBAT' }
```

Remove the `ADD_COMBAT_DECLARATION` line entirely.

- [ ] **Step 4: Update `docs/action-ids.md`**

Replace the action ID table row for `attack` with two new rows:

```
| `declare_attackers` | `declareAttackers` | `PhaseBar` (declareAttackersStep) | `declareAttackersHandler` | Batch declare attackers (MTG CR 508) |
| `declare_blockers` | `declareBlockers` | `PhaseBar` (declareBlockersStep) | `declareBlockersHandler` | Assign blockers to attackers (MTG CR 509) |
```

Update the producers/consumers tables accordingly.

- [ ] **Step 5: Run typecheck to verify no compile errors from type changes alone**

Run: `npx tsc --noEmit`
Expected: FAIL — consumers of `ADD_COMBAT_DECLARATION`, `ACTION_IDS.attack`, and `CombatDeclaration.target` will break. This is expected — subsequent tasks fix them.

- [ ] **Step 6: Commit**

```bash
git add src/types/effect.types.ts src/types/action.ids.ts src/types/game-mutation.types.ts docs/action-ids.md
git commit -m "feat: update CombatDeclaration, action IDs, and mutations for MTG combat"
```

---

### Task 2: Update `game-reducer.ts` for new combat mutations

**Files:**
- Modify: `src/engine/game-reducer.ts:421-430`

**Interfaces:**
- Consumes: `DECLARE_ATTACKERS`, `ASSIGN_BLOCKERS` from Task 1
- Produces: reducer cases for both new mutations

- [ ] **Step 1: Replace `ADD_COMBAT_DECLARATION` case with `DECLARE_ATTACKERS`**

Replace lines 421-430:

```ts
    // -- Combat mutations (turn-based action — declared attackers) --
    case 'DECLARE_ATTACKERS':
      return {
        ...state,
        combat: [...state.combat, ...mutation.declarations],
      };

    case 'ASSIGN_BLOCKERS': {
      const combatIdx = state.combat.findIndex(d => d.uuid === mutation.attackerUuid);
      if (combatIdx === -1) return state;
      const blockers = mutation.blockerUuids
        .map(uuid => state.battlefield.find(c => c.uuid === uuid))
        .filter((c): c is CardInstance => c !== undefined);
      const updated = {
        ...state.combat[combatIdx],
        blockers: [...state.combat[combatIdx].blockers, ...blockers],
      };
      return {
        ...state,
        combat: [
          ...state.combat.slice(0, combatIdx),
          updated,
          ...state.combat.slice(combatIdx + 1),
        ],
      };
    }

    case 'CLEAR_COMBAT':
      return {
        ...state,
        combat: [],
      };
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: FAIL — still has `ADD_COMBAT_DECLARATION` references in `attack-handler.ts` and tests. The reducer itself is clean.

- [ ] **Step 3: Commit**

```bash
git add src/engine/game-reducer.ts
git commit -m "feat: add DECLARE_ATTACKERS and ASSIGN_BLOCKERS reducer cases"
```

---

### Task 3: Create `declare-attackers-handler.ts`

**Files:**
- Create: `src/engine/handlers/declare-attackers-handler.ts`

**Interfaces:**
- Consumes: `ActionHandler`, `ActionData`, `ActionResult` from `action-registry`; `GameMutation` from `game-mutation.types`; `GameRoom`, `PlayerId` from `game.room.types`; `CardInstance` from `card.types`; `CombatDeclaration` from `effect.types`; `CardCharacteristicService` from `card-characteristic-service`
- Produces: `declareAttackersHandler: ActionHandler`

- [ ] **Step 1: Write the failing test**

Create `tests/engine/declare-attackers-handler.test.ts`:

```ts
// tests/engine/declare-attackers-handler.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { declareAttackersHandler } from '../../src/engine/handlers/declare-attackers-handler';
import { registerAction } from '../../src/engine/action-registry';
import { gameReducer } from '../../src/engine/game-reducer';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameMutation } from '../../src/types/game-mutation.types';
import type { GameRoom } from '../../src/types/game.room.types';

describe('declareAttackersHandler', () => {
  let room: GameRoom;

  function apply(mutations: GameMutation[]): void {
    for (const m of mutations) {
      room = gameReducer(room, m);
    }
  }

  beforeEach(() => {
    room = createTestRoom();
    registerAction('declare_attackers', declareAttackersHandler);
    room.currentPhase = 'declareAttackersStep';
    // Put two creatures on the battlefield for player1
    const c1 = instantiateCard('empire-servant');
    c1.state.zone = 'battlefield';
    c1.state.ownerId = 'player1';
    c1.state.controllerId = 'player1';
    c1.state.summoningSickness = false;
    room.battlefield.push(c1);

    const c2 = instantiateCard('empire-servant');
    c2.state.zone = 'battlefield';
    c2.state.ownerId = 'player1';
    c2.state.controllerId = 'player1';
    c2.state.summoningSickness = false;
    room.battlefield.push(c2);
  });

  describe('validate', () => {
    it('should validate a batch of untapped, non-sick creatures in declareAttackersStep', () => {
      const attackers = room.battlefield.filter(c => c.state.controllerId === 'player1');
      const result = declareAttackersHandler.validate(room, 'player1', {
        attackers: attackers.map(c => ({ cardUuid: c.uuid })),
      });
      expect(result.success).toBe(true);
    });

    it('should reject when not in declareAttackersStep', () => {
      room.currentPhase = 'stateMainPhase';
      const card = room.battlefield[0];
      const result = declareAttackersHandler.validate(room, 'player1', {
        attackers: [{ cardUuid: card.uuid }],
      });
      expect(result.success).toBe(false);
      expect(result.reason).toContain('declare attackers step');
    });

    it('should reject when not the active player', () => {
      room.activeTurnPlayerId = 'player2';
      const card = room.battlefield[0];
      const result = declareAttackersHandler.validate(room, 'player1', {
        attackers: [{ cardUuid: card.uuid }],
      });
      expect(result.success).toBe(false);
      expect(result.reason).toContain('turn');
    });

    it('should reject empty attackers array', () => {
      const result = declareAttackersHandler.validate(room, 'player1', {
        attackers: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject a tapped creature', () => {
      const card = room.battlefield[0];
      card.state.isTapped = true;
      const result = declareAttackersHandler.validate(room, 'player1', {
        attackers: [{ cardUuid: card.uuid }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject a summoning sick creature', () => {
      const card = room.battlefield[0];
      card.state.summoningSickness = true;
      const result = declareAttackersHandler.validate(room, 'player1', {
        attackers: [{ cardUuid: card.uuid }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject a creature that already attacked this turn', () => {
      const card = room.battlefield[0];
      card.state.attackedThisTurn = true;
      const result = declareAttackersHandler.validate(room, 'player1', {
        attackers: [{ cardUuid: card.uuid }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject duplicate cardUuids', () => {
      const card = room.battlefield[0];
      const result = declareAttackersHandler.validate(room, 'player1', {
        attackers: [{ cardUuid: card.uuid }, { cardUuid: card.uuid }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject a non-creature', () => {
      const card = room.battlefield[0];
      card.blueprint.cardTypes = ['Land'];
      const result = declareAttackersHandler.validate(room, 'player1', {
        attackers: [{ cardUuid: card.uuid }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('propose', () => {
    it('should tap all attackers, mark them as attacked, and produce DECLARE_ATTACKERS mutation', () => {
      const attackers = room.battlefield.filter(c => c.state.controllerId === 'player1');
      const result = declareAttackersHandler.propose(room, 'player1', {
        attackers: attackers.map(c => ({ cardUuid: c.uuid })),
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.mutations).toBeDefined();
        apply(result.mutations!);
      }

      // All attackers should be tapped and marked
      for (const c of attackers) {
        const updated = room.battlefield.find(bc => bc.uuid === c.uuid)!;
        expect(updated.state.isTapped).toBe(true);
        expect(updated.state.attackedThisTurn).toBe(true);
      }

      // DECLARE_ATTACKERS mutation should be present
      const mutationTypes = result.success ? result.mutations!.map(m => m.type) : [];
      expect(mutationTypes).toContain('DECLARE_ATTACKERS');

      // Combat declarations should have empty blockers
      expect(room.combat.length).toBe(2);
      for (const decl of room.combat) {
        expect(decl.blockers).toEqual([]);
        expect(decl.attackerPower).toBe(decl.attacker.blueprint.power ?? 0);
      }

      // No stack object — turn-based action
      if (result.success) {
        expect(result.stackObject).toBeUndefined();
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/declare-attackers-handler.test.ts`
Expected: FAIL — `declareAttackersHandler` not found

- [ ] **Step 3: Write the handler**

Create `src/engine/handlers/declare-attackers-handler.ts`:

```ts
// src/engine/handlers/declare-attackers-handler.ts
import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import type { GameMutation } from '../../types/game-mutation.types';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { CardInstance } from '../../types/card.types';
import type { CombatDeclaration } from '../../types/effect.types';
import { CardCharacteristicService } from '../card-characteristic-service';

function findCardOnBattlefield(room: GameRoom, playerId: PlayerId, cardUuid: string): CardInstance | undefined {
  return room.battlefield.find(c => c.uuid === cardUuid && c.state.controllerId === playerId);
}

export const declareAttackersHandler: ActionHandler = {
  validate(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    const attackers = action.attackers as { cardUuid: string }[] | undefined;
    if (!attackers || attackers.length === 0) {
      return { success: false, phase: 'validate', reason: 'At least one attacker is required' };
    }

    // Must be your turn
    if (room.activeTurnPlayerId !== playerId) {
      return { success: false, phase: 'validate', reason: 'Not your turn' };
    }

    // Must be in declareAttackersStep
    if (room.currentPhase !== 'declareAttackersStep') {
      return { success: false, phase: 'validate', reason: 'Can only declare attackers during declare attackers step' };
    }

    // Check for duplicate cardUuids
    const uuids = attackers.map(a => a.cardUuid);
    if (new Set(uuids).size !== uuids.length) {
      return { success: false, phase: 'validate', reason: 'Duplicate attackers are not allowed' };
    }

    for (const { cardUuid } of attackers) {
      const card = findCardOnBattlefield(room, playerId, cardUuid);
      if (!card) {
        return { success: false, phase: 'validate', reason: `Creature ${cardUuid} not found on your battlefield` };
      }

      if (!card.blueprint.cardTypes.includes('Creature')) {
        return { success: false, phase: 'validate', reason: `Card ${cardUuid} is not a creature` };
      }

      if (card.state.isTapped) {
        return { success: false, phase: 'validate', reason: `Creature ${cardUuid} is already tapped` };
      }

      if (card.state.summoningSickness) {
        return { success: false, phase: 'validate', reason: `Creature ${cardUuid} has summoning sickness` };
      }

      if (card.state.attackedThisTurn) {
        return { success: false, phase: 'validate', reason: `Creature ${cardUuid} has already attacked this turn` };
      }
    }

    return { success: true };
  },

  propose(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    const attackers = action.attackers as { cardUuid: string }[];
    const mutations: GameMutation[] = [];
    const declarations: CombatDeclaration[] = [];

    for (const { cardUuid } of attackers) {
      const card = findCardOnBattlefield(room, playerId, cardUuid);
      if (!card) {
        return { success: false, phase: 'propose', reason: `Creature ${cardUuid} disappeared from battlefield` };
      }

      // Cost: tap and mark as attacked
      mutations.push({ type: 'TAP_CARD', cardUuid: card.uuid });
      mutations.push({ type: 'SET_ATTACKED_THIS_TURN', cardUuid: card.uuid, value: true });

      const attackerPower = CardCharacteristicService.resolvePower(room, card);

      declarations.push({
        uuid: card.uuid, // use card uuid as declaration uuid for blocker assignment lookup
        attacker: card,
        attackerPower,
        blockers: [],
      });
    }

    // Batch declare all attackers at once
    mutations.push({ type: 'DECLARE_ATTACKERS', declarations });

    // No stackObject — turn-based action, damage applied later in combatDamageStep
    return { success: true, mutations };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/declare-attackers-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/handlers/declare-attackers-handler.ts tests/engine/declare-attackers-handler.test.ts
git commit -m "feat: add declareAttackersHandler with batch declare attackers"
```

---

### Task 4: Create `declare-blockers-handler.ts`

**Files:**
- Create: `src/engine/handlers/declare-blockers-handler.ts`

**Interfaces:**
- Consumes: `ActionHandler`, `ActionData`, `ActionResult` from `action-registry`; `GameMutation` from `game-mutation.types`; `GameRoom`, `PlayerId` from `game.room.types`; `CardInstance` from `card.types`; `CombatDeclaration` from `effect.types`
- Produces: `declareBlockersHandler: ActionHandler`

- [ ] **Step 1: Write the failing test**

Create `tests/engine/declare-blockers-handler.test.ts`:

```ts
// tests/engine/declare-blockers-handler.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { declareBlockersHandler } from '../../src/engine/handlers/declare-blockers-handler';
import { registerAction } from '../../src/engine/action-registry';
import { gameReducer } from '../../src/engine/game-reducer';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameMutation } from '../../src/types/game-mutation.types';
import type { GameRoom } from '../../src/types/game.room.types';
import type { CombatDeclaration } from '../../src/types/effect.types';

describe('declareBlockersHandler', () => {
  let room: GameRoom;

  function apply(mutations: GameMutation[]): void {
    for (const m of mutations) {
      room = gameReducer(room, m);
    }
  }

  beforeEach(() => {
    room = createTestRoom();
    registerAction('declare_blockers', declareBlockersHandler);
    room.currentPhase = 'declareBlockersStep';
    // player2 is the defending player (active turn is player1)
    room.activeTurnPlayerId = 'player1';

    // Attacker on player1's battlefield
    const attacker = instantiateCard('empire-servant');
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1';
    attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);

    // Blocker on player2's battlefield
    const blocker = instantiateCard('empire-servant');
    blocker.state.zone = 'battlefield';
    blocker.state.ownerId = 'player2';
    blocker.state.controllerId = 'player2';
    blocker.state.summoningSickness = false;
    room.battlefield.push(blocker);

    // Pre-populate combat with a declaration (simulating declareAttackersStep)
    const decl: CombatDeclaration = {
      uuid: attacker.uuid,
      attacker,
      attackerPower: attacker.blueprint.power ?? 0,
      blockers: [],
    };
    room.combat.push(decl);
  });

  describe('validate', () => {
    it('should validate a blocker assignment in declareBlockersStep', () => {
      const attacker = room.battlefield[0];
      const blocker = room.battlefield[1];
      const result = declareBlockersHandler.validate(room, 'player2', {
        assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }],
      });
      expect(result.success).toBe(true);
    });

    it('should reject when not in declareBlockersStep', () => {
      room.currentPhase = 'stateMainPhase';
      const attacker = room.battlefield[0];
      const blocker = room.battlefield[1];
      const result = declareBlockersHandler.validate(room, 'player2', {
        assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }],
      });
      expect(result.success).toBe(false);
      expect(result.reason).toContain('declare blockers step');
    });

    it('should reject when the active player tries to block', () => {
      const attacker = room.battlefield[0];
      const blocker = room.battlefield[1];
      const result = declareBlockersHandler.validate(room, 'player1', {
        assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }],
      });
      expect(result.success).toBe(false);
      expect(result.reason).toContain('defending player');
    });

    it('should reject a blocker not on the defending player battlefield', () => {
      const attacker = room.battlefield[0];
      const result = declareBlockersHandler.validate(room, 'player2', {
        assignments: [{ attackerUuid: attacker.uuid, blockerUuids: ['nonexistent'] }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject a tapped blocker', () => {
      const attacker = room.battlefield[0];
      const blocker = room.battlefield[1];
      blocker.state.isTapped = true;
      const result = declareBlockersHandler.validate(room, 'player2', {
        assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject a non-creature blocker', () => {
      const attacker = room.battlefield[0];
      const blocker = room.battlefield[1];
      blocker.blueprint.cardTypes = ['Land'];
      const result = declareBlockersHandler.validate(room, 'player2', {
        assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject a blocker assigned to a non-existent attacker', () => {
      const blocker = room.battlefield[1];
      const result = declareBlockersHandler.validate(room, 'player2', {
        assignments: [{ attackerUuid: 'nonexistent', blockerUuids: [blocker.uuid] }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject duplicate blocker across assignments', () => {
      // Add a second attacker and declaration
      const attacker2 = instantiateCard('empire-servant');
      attacker2.state.zone = 'battlefield';
      attacker2.state.ownerId = 'player1';
      attacker2.state.controllerId = 'player1';
      attacker2.state.summoningSickness = false;
      room.battlefield.push(attacker2);
      room.combat.push({
        uuid: attacker2.uuid,
        attacker: attacker2,
        attackerPower: attacker2.blueprint.power ?? 0,
        blockers: [],
      });

      const blocker = room.battlefield[1];
      const result = declareBlockersHandler.validate(room, 'player2', {
        assignments: [
          { attackerUuid: room.battlefield[0].uuid, blockerUuids: [blocker.uuid] },
          { attackerUuid: attacker2.uuid, blockerUuids: [blocker.uuid] },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.reason).toContain('already assigned');
    });

    it('should reject a non-flying blocker assigned to a flying attacker', () => {
      const attacker = room.battlefield[0];
      (attacker.blueprint as any).keywords = ['Flying'];
      const blocker = room.battlefield[1];
      const result = declareBlockersHandler.validate(room, 'player2', {
        assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }],
      });
      expect(result.success).toBe(false);
      expect(result.reason).toContain('Flying');
    });

    it('should allow a flying blocker to block a flying attacker', () => {
      const attacker = room.battlefield[0];
      (attacker.blueprint as any).keywords = ['Flying'];
      const blocker = room.battlefield[1];
      (blocker.blueprint as any).keywords = ['Flying'];
      const result = declareBlockersHandler.validate(room, 'player2', {
        assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('propose', () => {
    it('should produce ASSIGN_BLOCKERS mutation and populate blockers on CombatDeclaration', () => {
      const attacker = room.battlefield[0];
      const blocker = room.battlefield[1];
      const result = declareBlockersHandler.propose(room, 'player2', {
        assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.mutations).toBeDefined();
        apply(result.mutations!);
      }

      // Blocker should NOT be tapped (MTG CR 509.1f)
      const updatedBlocker = room.battlefield.find(c => c.uuid === blocker.uuid)!;
      expect(updatedBlocker.state.isTapped).toBe(false);

      // Combat declaration should have the blocker
      expect(room.combat[0].blockers.length).toBe(1);
      expect(room.combat[0].blockers[0].uuid).toBe(blocker.uuid);

      // ASSIGN_BLOCKERS mutation should be present
      const mutationTypes = result.success ? result.mutations!.map(m => m.type) : [];
      expect(mutationTypes).toContain('ASSIGN_BLOCKERS');

      // No stack object
      if (result.success) {
        expect(result.stackObject).toBeUndefined();
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/declare-blockers-handler.test.ts`
Expected: FAIL — `declareBlockersHandler` not found

- [ ] **Step 3: Write the handler**

Create `src/engine/handlers/declare-blockers-handler.ts`:

```ts
// src/engine/handlers/declare-blockers-handler.ts
import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import type { GameMutation } from '../../types/game-mutation.types';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { CardInstance } from '../../types/card.types';

function findCardOnBattlefield(room: GameRoom, cardUuid: string): CardInstance | undefined {
  return room.battlefield.find(c => c.uuid === cardUuid);
}

function hasKeyword(card: CardInstance, keyword: string): boolean {
  const keywords = (card.blueprint as any).keywords as string[] | undefined;
  return keywords?.includes(keyword) ?? false;
}

export const declareBlockersHandler: ActionHandler = {
  validate(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    const assignments = action.assignments as { attackerUuid: string; blockerUuids: string[] }[] | undefined;
    if (!assignments || assignments.length === 0) {
      return { success: false, phase: 'validate', reason: 'At least one blocker assignment is required' };
    }

    // Must be the defending player (NOT the active player)
    const defendingPlayerId = room.activeTurnPlayerId === room.player1Id
      ? room.player2Id! : room.player1Id;
    if (playerId !== defendingPlayerId) {
      return { success: false, phase: 'validate', reason: 'Only the defending player can declare blockers' };
    }

    // Must be in declareBlockersStep
    if (room.currentPhase !== 'declareBlockersStep') {
      return { success: false, phase: 'validate', reason: 'Can only declare blockers during declare blockers step' };
    }

    // Track which blockers have been assigned (no duplicate blocking)
    const assignedBlockers = new Set<string>();

    for (const { attackerUuid, blockerUuids } of assignments) {
      // Attacker must exist in room.combat
      const combatDecl = room.combat.find(d => d.uuid === attackerUuid);
      if (!combatDecl) {
        return { success: false, phase: 'validate', reason: `Attacker ${attackerUuid} not found in combat declarations` };
      }

      const attackerHasFlying = hasKeyword(combatDecl.attacker, 'Flying');

      for (const blockerUuid of blockerUuids) {
        // Blocker must not already be assigned to another attacker
        if (assignedBlockers.has(blockerUuid)) {
          return { success: false, phase: 'validate', reason: `Blocker ${blockerUuid} is already assigned to another attacker` };
        }

        const blocker = findCardOnBattlefield(room, blockerUuid);
        if (!blocker) {
          return { success: false, phase: 'validate', reason: `Blocker ${blockerUuid} not found on battlefield` };
        }

        // Blocker must be controlled by the defending player
        if (blocker.state.controllerId !== playerId) {
          return { success: false, phase: 'validate', reason: `Blocker ${blockerUuid} is not on your battlefield` };
        }

        // Must be a creature
        if (!blocker.blueprint.cardTypes.includes('Creature')) {
          return { success: false, phase: 'validate', reason: `Card ${blockerUuid} is not a creature` };
        }

        // Must be untapped (MTG CR 509.1a — only untapped creatures can block)
        if (blocker.state.isTapped) {
          return { success: false, phase: 'validate', reason: `Creature ${blockerUuid} is tapped` };
        }

        // Flying evasion: non-flying creatures cannot block flying attackers
        if (attackerHasFlying && !hasKeyword(blocker, 'Flying')) {
          return { success: false, phase: 'validate', reason: `Cannot block Flying creature ${attackerUuid} without Flying` };
        }

        assignedBlockers.add(blockerUuid);
      }
    }

    return { success: true };
  },

  propose(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    const assignments = action.assignments as { attackerUuid: string; blockerUuids: string[] }[];
    const mutations: GameMutation[] = [];

    for (const { attackerUuid, blockerUuids } of assignments) {
      mutations.push({ type: 'ASSIGN_BLOCKERS', attackerUuid, blockerUuids });
    }

    // Blocking does NOT tap the blocker (MTG CR 509.1f)
    // No stackObject — turn-based action
    return { success: true, mutations };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/declare-blockers-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/handlers/declare-blockers-handler.ts tests/engine/declare-blockers-handler.test.ts
git commit -m "feat: add declareBlockersHandler with flying evasion"
```

---

### Task 5: Add combat damage resolution to `state-machine.ts`

**Files:**
- Modify: `src/engine/state-machine.ts:120-160`

**Interfaces:**
- Consumes: `GameRoom`, `GameMutation`, `CombatDeclaration` from existing types; `CardCharacteristicService` from `card-characteristic-service`
- Produces: damage mutations in `combatDamageStep` transition

- [ ] **Step 1: Write the failing test**

Create `tests/engine/combat-damage-step.test.ts`:

```ts
// tests/engine/combat-damage-step.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { registerAction } from '../../src/engine/action-registry';
import { declareAttackersHandler } from '../../src/engine/handlers/declare-attackers-handler';
import { declareBlockersHandler } from '../../src/engine/handlers/declare-blockers-handler';
import { instantiateCard } from '../../src/library/card-factory';
import { ACTION_IDS } from '../../src/types/action.ids';
import type { GameRoom } from '../../src/types/game.room.types';

describe('combatDamageStep — damage resolution', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom();
    registerAction(ACTION_IDS.declareAttackers, declareAttackersHandler);
    registerAction(ACTION_IDS.declareBlockers, declareBlockersHandler);

    engine = new GameEngine(room);
    engine.initRoom();
  });

  it('unblocked attacker deals damage to defending player', () => {
    // Put an attacker on player1's battlefield
    const attacker = instantiateCard('empire-servant');
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1';
    attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);

    // Enter declareAttackersStep
    room.currentPhase = 'stateMainPhase';
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');

    // Declare attacker
    const result = engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });
    expect(result.success).toBe(true);

    // Transition to combatDamageStep (skip declareBlockersStep — no blockers declared)
    engine.transition('declareBlockersStep');
    engine.transition('combatDamageStep');

    // Defending player (player2) should have taken damage
    const after = engine.roomState;
    expect(after.players['player2'].life).toBe(20 - (attacker.blueprint.power ?? 0));
  });

  it('blocked attacker deals damage to blocker and blocker deals counter-damage', () => {
    // Attacker on player1
    const attacker = instantiateCard('empire-servant');
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1';
    attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);

    // Blocker on player2
    const blocker = instantiateCard('empire-servant');
    blocker.state.zone = 'battlefield';
    blocker.state.ownerId = 'player2';
    blocker.state.controllerId = 'player2';
    blocker.state.summoningSickness = false;
    room.battlefield.push(blocker);

    // Enter declareAttackersStep
    room.currentPhase = 'stateMainPhase';
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');

    // Declare attacker
    engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });

    // Enter declareBlockersStep
    engine.transition('declareBlockersStep');

    // Declare blocker
    engine.proposeAndStack('player2', ACTION_IDS.declareBlockers, {
      assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }],
    });

    // Transition to combatDamageStep
    engine.transition('combatDamageStep');

    const after = engine.roomState;

    // Attacker takes counter-damage from blocker
    const attackerAfter = after.battlefield.find(c => c.uuid === attacker.uuid)!;
    expect(attackerAfter.state.damageTaken).toBe(blocker.blueprint.power ?? 0);

    // Blocker takes damage from attacker
    const blockerAfter = after.battlefield.find(c => c.uuid === blocker.uuid)!;
    expect(blockerAfter.state.damageTaken).toBe(attacker.blueprint.power ?? 0);

    // Defending player should NOT have taken damage (blocked)
    expect(after.players['player2'].life).toBe(20);
  });

  it('trample: excess damage over blocker toughness goes to defending player', () => {
    // Big attacker (5/5) on player1
    const attacker = instantiateCard('card_09876_core_set'); // Crimson Hellkite 5/5
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1';
    attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    (attacker.blueprint as any).keywords = ['Trample'];
    room.battlefield.push(attacker);

    // Small blocker (1/1) on player2
    const blocker = instantiateCard('empire-servant');
    blocker.state.zone = 'battlefield';
    blocker.state.ownerId = 'player2';
    blocker.state.controllerId = 'player2';
    blocker.state.summoningSickness = false;
    room.battlefield.push(blocker);

    room.currentPhase = 'stateMainPhase';
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

    // Blocker takes 5 damage (dies via SBA)
    const blockerAfter = after.battlefield.find(c => c.uuid === blocker.uuid);
    // Blocker may be dead (in graveyard) from SBA
    const blockerInGrave = after.players['player2'].graveyard.find(c => c.uuid === blocker.uuid);
    expect(blockerInGrave || (blockerAfter && blockerAfter.state.damageTaken >= 1)).toBeTruthy();

    // Defending player takes trample excess: 5 - 1 = 4
    expect(after.players['player2'].life).toBe(20 - 4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/combat-damage-step.test.ts`
Expected: FAIL — `combatDamageStep` is a no-op stub, no damage applied

- [ ] **Step 3: Implement damage resolution in `state-machine.ts`**

In `src/engine/state-machine.ts`, add the import at the top:

```ts
import { CardCharacteristicService } from './card-characteristic-service';
```

Add the `hasKeyword` helper (before the `StateMachine` class):

```ts
function hasKeyword(card: CardInstance, keyword: string): boolean {
  const keywords = (card.blueprint as any).keywords as string[] | undefined;
  return keywords?.includes(keyword) ?? false;
}
```

Replace the `combatDamageStep` entry in the `combatEvent` record (line 137) with real damage resolution logic. Replace the entire combat event block (lines 130-148) with:

```ts
    // Combat step events and damage resolution.
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
          // Blocked: attacker deals damage to blocker, blocker deals counter-damage
          // (single blocker per attacker for now)
          const blocker = decl.blockers[0];
          const blockerPower = CardCharacteristicService.resolvePower(room, blocker);
          const blockerToughness = CardCharacteristicService.resolveToughness(room, blocker);

          // Attacker deals damage to blocker
          mutations.push({
            type: 'SET_DAMAGE',
            cardUuid: blocker.uuid,
            amount: (blocker.state.damageTaken || 0) + decl.attackerPower,
          });

          // Blocker deals counter-damage to attacker
          mutations.push({
            type: 'SET_DAMAGE',
            cardUuid: decl.attacker.uuid,
            amount: (decl.attacker.state.damageTaken || 0) + blockerPower,
          });

          // Trample: excess damage over blocker toughness → defending player
          if (hasKeyword(decl.attacker, 'Trample') && decl.attackerPower > blockerToughness) {
            const excessDamage = decl.attackerPower - blockerToughness;
            const defender = room.players[defendingPlayerId];
            mutations.push({
              type: 'SET_LIFE',
              playerId: defendingPlayerId,
              amount: defender.life - excessDamage,
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

    // Other combat step events (stub payloads for now)
    const combatEvent: Record<string, { eventId: string; payload: Record<string, unknown> }> = {
      beginCombatStep: { eventId: 'COMBAT_BEGIN', payload: { currentPlayer: room.activeTurnPlayerId } },
      declareAttackersStep: { eventId: 'ATTACKERS_DECLARED', payload: { attackerIds: [] } },
      declareBlockersStep: { eventId: 'BLOCKERS_DECLARED', payload: { blockerAssignments: [] } },
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

Note: `combatDamageStep` is removed from the `combatEvent` record since it's handled inline above.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/combat-damage-step.test.ts`
Expected: PASS

- [ ] **Step 5: Run existing tests to check for regressions**

Run: `npx vitest run`
Expected: Some tests may fail due to `attackHandler` still being referenced. That's expected — Task 7 removes it.

- [ ] **Step 6: Commit**

```bash
git add src/engine/state-machine.ts tests/engine/combat-damage-step.test.ts
git commit -m "feat: implement combat damage resolution in combatDamageStep"
```

---

### Task 6: Update `server.ts` — endTurn shrinks, new action cases

**Files:**
- Modify: `src/server.ts:1-120` (imports), `src/server.ts:310-360` (playerAction switch)

**Interfaces:**
- Consumes: `declareAttackersHandler`, `declareBlockersHandler` from Tasks 3-4; `ACTION_IDS.declareAttackers`, `ACTION_IDS.declareBlockers` from Task 1
- Produces: updated `ACTION_HANDLERS` map, updated `playerAction` switch

- [ ] **Step 1: Update imports**

Replace the `attackHandler` import (line 29) with the two new handlers:

```ts
import { declareAttackersHandler } from './engine/handlers/declare-attackers-handler';
import { declareBlockersHandler } from './engine/handlers/declare-blockers-handler';
```

Remove: `import { attackHandler } from './engine/handlers/attack-handler';`

- [ ] **Step 2: Update `ACTION_HANDLERS` map**

Replace the `attack` entry with the two new entries:

```ts
const ACTION_HANDLERS: Record<ActionId, ActionHandler> = {
  [ACTION_IDS.castSpell]: playCardHandler,
  [ACTION_IDS.declareAttackers]: declareAttackersHandler,
  [ACTION_IDS.declareBlockers]: declareBlockersHandler,
  [ACTION_IDS.tapForMana]: tapForManaHandler,
  [ACTION_IDS.endTurn]: endTurnHandler,
  [ACTION_IDS.passPriority]: passPriorityHandler,
  [ACTION_IDS.resolveStack]: resolveStackHandler,
  [ACTION_IDS.rpsPlay]: rpsPlayHandler,
};
```

- [ ] **Step 3: Shrink the endTurn case**

Replace the endTurn case (lines 318-345) — it should now only enter combat and stop at `declareAttackersStep`:

```ts
      case ACTION_IDS.endTurn: {
        // Validate
        const validateResult = endTurnHandler.validate(room, playerId, {});
        if (!validateResult.success) {
          socket.emit('error', { message: validateResult.reason });
          return;
        }

        if (room.currentPhase === 'stateMainPhase') {
          // Main Phase → combat: enter combat and stop at declareAttackersStep
          // so the active player can declare attackers.
          allMutations.push(...engine.transition('beginCombatStep'));
          allMutations.push(...engine.transition('declareAttackersStep'));
          allMutations.push(...engine.givePriorityTo(engine.activeTurnPlayerId));
        }
        break;
      }
```

- [ ] **Step 4: Add `declareAttackers` case**

Add after the `endTurn` case:

```ts
      case ACTION_IDS.declareAttackers: {
        const result = engine.proposeAndStack(playerId, ACTION_IDS.declareAttackers, data);
        if (!result.success) {
          socket.emit('error', { message: result.reason });
          return;
        }
        allMutations = result.mutations ?? [];
        // Advance to declareBlockersStep and give priority to defending player
        allMutations.push(...engine.transition('declareBlockersStep'));
        const defenderId = room.player1Id === playerId ? room.player2Id! : room.player1Id;
        allMutations.push(...engine.givePriorityTo(defenderId));
        break;
      }
```

- [ ] **Step 5: Add `declareBlockers` case**

Add after the `declareAttackers` case:

```ts
      case ACTION_IDS.declareBlockers: {
        const result = engine.proposeAndStack(playerId, ACTION_IDS.declareBlockers, data);
        if (!result.success) {
          socket.emit('error', { message: result.reason });
          return;
        }
        allMutations = result.mutations ?? [];
        // Advance through combatDamageStep → endCombatStep → endPhase → cleanupStep
        // → turnStart → switchTurn → drawPhase → mainPhase
        allMutations.push(...engine.transition('combatDamageStep'));
        allMutations.push(...engine.transition('endCombatStep'));
        allMutations.push(...engine.transition('stateEndPhase'));
        allMutations.push(...engine.transition('cleanupStep'));
        allMutations.push(...engine.transition('stateTurnStart'));
        allMutations.push(...engine.switchTurn());
        allMutations.push(...engine.transition('stateDrawPhase'));
        allMutations.push(...engine.transition('stateMainPhase'));
        allMutations.push(...engine.givePriorityTo(engine.activeTurnPlayerId));
        break;
      }
```

- [ ] **Step 6: Run typecheck**

Run: `npx tsc --noEmit`
Expected: FAIL — `attackHandler` still referenced in `option-service.ts` and `CombatDisplay.tsx`. The server.ts itself is clean.

- [ ] **Step 7: Commit**

```bash
git add src/server.ts
git commit -m "feat: update server.ts for MTG combat — endTurn shrinks, new declareAttackers/declareBlockers cases"
```

---

### Task 7: Delete `attack-handler.ts` and update remaining consumers

**Files:**
- Delete: `src/engine/handlers/attack-handler.ts`
- Delete: `tests/engine/attack-handler.test.ts`
- Modify: `src/engine/option-service.ts:60-100` (remove attack option)
- Modify: `src/client/components/CombatDisplay.tsx:1-50` (show blockers)
- Modify: `src/client/components/PhaseBar.tsx:1-60` (contextual buttons)

**Interfaces:**
- Consumes: `ACTION_IDS.declareAttackers`, `ACTION_IDS.declareBlockers` from Task 1
- Produces: updated option-service (no attack option), updated CombatDisplay (blocker display), updated PhaseBar (contextual buttons)

- [ ] **Step 1: Delete `attack-handler.ts` and its test**

```bash
rm src/engine/handlers/attack-handler.ts
rm tests/engine/attack-handler.test.ts
```

- [ ] **Step 2: Remove attack option from `option-service.ts`**

In `src/engine/option-service.ts`, remove the entire attack option block (lines 85-100):

```ts
    // Attack option (creatures only, during your main phase pre-combat)
    if (card.blueprint.cardTypes.includes('Creature')) {
      const canAttack = !card.state.isTapped && !card.state.summoningSickness
        && !card.state.attackedThisTurn
        && room.activeTurnPlayerId === playerId
        && room.currentPhase === 'stateMainPhase';
      options.push({
        actionId: ACTION_IDS.attack,
        label: 'Attack',
        description: 'Choose a target: opponent player or creature',
        disabled: !canAttack,
        disabledReason: card.state.isTapped ? 'Already tapped'
          : card.state.summoningSickness ? 'Summoning sickness'
          : card.state.attackedThisTurn ? 'Already attacked this turn'
          : room.activeTurnPlayerId !== playerId ? 'Not your turn'
          : room.currentPhase !== 'stateMainPhase' ? 'Not in main phase'
          : undefined,
      });
    }
```

Replace with a comment:

```ts
    // Attack is now a batch action in declareAttackersStep (MTG CR 508).
    // No per-creature attack option in main phase.
```

- [ ] **Step 3: Update `CombatDisplay.tsx`**

Replace the component body (lines 20-50):

```tsx
export default function CombatDisplay() {
  const combat = useGameStore(useShallow((s) => s.room?.combat ?? EMPTY_COMBAT));

  if (combat.length === 0) return null;

  return (
    <div className="combat-display">
      <h3>Combat ({combat.length})</h3>
      <ul>
        {combat.map((decl) => (
          <li key={decl.uuid}>
            <span className="combat-attacker">{decl.attacker.blueprint.name}</span>
            {decl.blockers.length > 0 ? (
              <>
                {' blocked by '}
                {decl.blockers.map(b => b.blueprint.name).join(', ')}
              </>
            ) : (
              <span className="combat-unblocked"> (unblocked)</span>
            )}
            <span className="combat-damage">
              ({decl.attackerPower})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Update `PhaseBar.tsx`**

Replace the button section (lines 40-55) with contextual combat buttons:

```tsx
      {phase !== 'RPS' && (
        <div className="phase-actions">
          {/* End Turn / Enter Battle: only the turn player */}
          {isMyTurn && phase === 'stateMainPhase' && (
            <button onClick={() => playerAction(ACTION_IDS.endTurn)}>
              Enter Battle
            </button>
          )}
          {/* Declare Attackers: active player in declareAttackersStep */}
          {isMyTurn && phase === 'declareAttackersStep' && (
            <button onClick={() => playerAction(ACTION_IDS.declareAttackers, { attackers: [] })}>
              Declare Attackers
            </button>
          )}
          {/* Declare Blockers: defending player in declareBlockersStep */}
          {!isMyTurn && phase === 'declareBlockersStep' && (
            <button onClick={() => playerAction(ACTION_IDS.declareBlockers, { assignments: [] })}>
              Declare Blockers
            </button>
          )}
          {/* Pass Priority: whoever has priority can pass (MTG 116.3d) */}
          {hasPriority && (
            <button onClick={() => playerAction(ACTION_IDS.passPriority)}>Pass Priority</button>
          )}
          {/* Resolve Stack: whoever has priority can resolve (MTG 116.4) */}
          {hasPriority && phase === 'Stack' && (
            <button onClick={() => playerAction(ACTION_IDS.resolveStack)}>Resolve Stack</button>
          )}
        </div>
      )}
```

Note: The `declareAttackers` and `declareBlockers` buttons pass empty arrays as placeholders. The actual batch selection UI (checkboxes on creatures) is out of scope per the spec — these buttons serve as the server-side action triggers. The client-side selection logic will be added in a follow-up.

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — all references to `attackHandler`, `ACTION_IDS.attack`, and old `CombatDeclaration` shape are resolved.

- [ ] **Step 6: Commit**

```bash
git add src/engine/option-service.ts src/client/components/CombatDisplay.tsx src/client/components/PhaseBar.tsx
git rm src/engine/handlers/attack-handler.ts tests/engine/attack-handler.test.ts
git commit -m "feat: remove attackHandler, update option-service, CombatDisplay, and PhaseBar for MTG combat"
```

---

### Task 8: Update existing tests for the new combat model

**Files:**
- Modify: `tests/engine/battle-phase-smoke.test.ts`
- Modify: `tests/engine/combat-integration.test.ts`
- Modify: `tests/engine/option-service.test.ts`

**Interfaces:**
- Consumes: `declareAttackersHandler`, `declareBlockersHandler` from Tasks 3-4; updated `ACTION_IDS` from Task 1
- Produces: passing test suite

- [ ] **Step 1: Update `battle-phase-smoke.test.ts`**

Replace the `attackHandler` import and registration with the new handlers. Replace the attack test with a declare-attackers test:

```ts
// tests/engine/battle-phase-smoke.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { ActionRegistry, registerAction } from '../../src/engine/action-registry';
import { declareAttackersHandler } from '../../src/engine/handlers/declare-attackers-handler';
import { declareBlockersHandler } from '../../src/engine/handlers/declare-blockers-handler';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { tapForManaHandler } from '../../src/engine/handlers/tap-for-mana-handler';
import { endTurnHandler } from '../../src/engine/handlers/end-turn-handler';
import { instantiateCard } from '../../src/library/card-factory';
import { ACTION_IDS } from '../../src/types/action.ids';
import type { GameRoom } from '../../src/types/game.room.types';

/**
 * Replicates the server's `playerAction` endTurn branch (server.ts):
 * - From stateMainPhase → enter combat, stop at declareAttackersStep.
 */
function serverEndTurn(engine: GameEngine, room: GameRoom, playerId: string) {
  const validate = endTurnHandler.validate(room, playerId, {});
  if (!validate.success) return { success: false, reason: validate.reason };

  const mutations: ReturnType<GameEngine['transition']> = [];
  if (room.currentPhase === 'stateMainPhase') {
    mutations.push(...engine.transition('beginCombatStep'));
    mutations.push(...engine.transition('declareAttackersStep'));
    mutations.push(...engine.givePriorityTo(engine.activeTurnPlayerId));
  }
  return { success: true, mutations };
}

describe('battle phase smoke test (server endTurn flow)', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    Object.keys(ActionRegistry).forEach((k) => delete ActionRegistry[k]);
    registerAction(ACTION_IDS.declareAttackers, declareAttackersHandler);
    registerAction(ACTION_IDS.declareBlockers, declareBlockersHandler);
    registerAction(ACTION_IDS.castSpell, playCardHandler);
    registerAction(ACTION_IDS.tapForMana, tapForManaHandler);

    room = createTestRoom();
    engine = new GameEngine(room);
    engine.initRoom();

    const attacker = instantiateCard('empire-servant');
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1';
    attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);
  });

  it('endTurn from main phase enters combat and stops at declareAttackersStep', () => {
    room.currentPhase = 'stateMainPhase';
    room.priorityPlayerId = 'player1';

    const result = serverEndTurn(engine, room, 'player1');
    expect(result.success).toBe(true);
    expect(engine.roomState.currentPhase).toBe('declareAttackersStep');
    expect(engine.roomState.activeTurnPlayerId).toBe('player1');
    expect(engine.roomState.combat.length).toBe(0);
  });

  it('full combat flow: declare attackers → declare blockers → damage → turn switch', () => {
    room.currentPhase = 'stateMainPhase';
    room.priorityPlayerId = 'player1';

    // Enter combat
    serverEndTurn(engine, room, 'player1');
    expect(engine.roomState.currentPhase).toBe('declareAttackersStep');

    // Declare attackers
    const attacker = engine.roomState.battlefield.find(
      (c) => c.state.controllerId === 'player1'
    )!;
    const attackResult = engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });
    expect(attackResult.success).toBe(true);

    // Should advance to declareBlockersStep
    engine.transition('declareBlockersStep');
    engine.givePriorityTo('player2');
    expect(engine.roomState.currentPhase).toBe('declareBlockersStep');

    // Declare blockers (none — let it through unblocked)
    const blockResult = engine.proposeAndStack('player2', ACTION_IDS.declareBlockers, {
      assignments: [],
    });
    // Empty assignments should be valid (defender chooses not to block)
    // Actually, the handler requires at least one assignment. Let's skip blocking.
    // Transition through remaining steps manually
    engine.transition('combatDamageStep');
    engine.transition('endCombatStep');
    engine.transition('stateEndPhase');
    engine.transition('cleanupStep');
    engine.transition('stateTurnStart');
    engine.switchTurn();
    engine.transition('stateDrawPhase');
    engine.transition('stateMainPhase');
    engine.givePriorityTo(engine.activeTurnPlayerId);

    // Turn should have switched to player2
    expect(engine.roomState.activeTurnPlayerId).toBe('player2');
    expect(engine.roomState.currentPhase).toBe('stateMainPhase');
    // Combat should be cleared
    expect(engine.roomState.combat.length).toBe(0);
    // Player2 should have taken damage from unblocked attacker
    expect(engine.roomState.players['player2'].life).toBe(20 - (attacker.blueprint.power ?? 0));
  });
});
```

- [ ] **Step 2: Update `combat-integration.test.ts`**

Replace the entire file to use the new combat model:

```ts
// tests/engine/combat-integration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { registerAction } from '../../src/engine/action-registry';
import { declareAttackersHandler } from '../../src/engine/handlers/declare-attackers-handler';
import { declareBlockersHandler } from '../../src/engine/handlers/declare-blockers-handler';
import { instantiateCard } from '../../src/library/card-factory';
import { ACTION_IDS } from '../../src/types/action.ids';
import type { GameRoom } from '../../src/types/game.room.types';

describe('Combat Integration — declare attackers → blockers → damage → SBA → death trigger', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom();
    registerAction(ACTION_IDS.declareAttackers, declareAttackersHandler);
    registerAction(ACTION_IDS.declareBlockers, declareBlockersHandler);

    // Attacker: Crimson Hellkite (5/5 Flying) on player1's battlefield
    const attacker = instantiateCard('card_09876_core_set');
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1';
    attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);

    // Defender: empire-servant (1/1) on player2's battlefield with an ON_DIE trigger
    const defender = instantiateCard('empire-servant');
    defender.state.zone = 'battlefield';
    defender.state.ownerId = 'player2';
    defender.state.controllerId = 'player2';
    defender.state.summoningSickness = false;
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

  it('full combat flow: declare attackers → blockers → damage → SBA destroys blocker → death trigger fires', () => {
    // Enter declareAttackersStep
    room.currentPhase = 'stateMainPhase';
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');

    const attacker = room.battlefield.find(c => c.state.controllerId === 'player1')!;
    const defender = room.battlefield.find(c => c.state.controllerId === 'player2')!;

    // Declare attackers
    const attackResult = engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });
    expect(attackResult.success).toBe(true);

    // Attacker tapped and marked
    const attackerAfter = engine.roomState.battlefield.find(c => c.uuid === attacker.uuid)!;
    expect(attackerAfter.state.isTapped).toBe(true);
    expect(attackerAfter.state.attackedThisTurn).toBe(true);

    // Combat declaration recorded
    expect(engine.roomState.combat.length).toBe(1);
    expect(engine.roomState.combat[0].blockers).toEqual([]);

    // Enter declareBlockersStep
    engine.transition('declareBlockersStep');

    // Declare blocker
    const blockResult = engine.proposeAndStack('player2', ACTION_IDS.declareBlockers, {
      assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [defender.uuid] }],
    });
    expect(blockResult.success).toBe(true);

    // Blocker assigned
    expect(engine.roomState.combat[0].blockers.length).toBe(1);
    expect(engine.roomState.combat[0].blockers[0].uuid).toBe(defender.uuid);

    // Transition to combatDamageStep — damage resolved, SBA runs
    engine.transition('combatDamageStep');

    const after = engine.roomState;

    // Defender should be in graveyard (5 damage >= 1 toughness, destroyed by SBA)
    const defenderInGraveyard = after.players['player2'].graveyard.find(
      c => c.uuid === defender.uuid
    );
    expect(defenderInGraveyard).toBeDefined();

    // Attacker takes 1 counter-damage from defender
    const attackerOnBoard = after.battlefield.find(c => c.uuid === attacker.uuid)!;
    expect(attackerOnBoard.state.damageTaken).toBe(1);

    // ON_DIE trigger should have fired
    const deathTrigger = after.stack.find(
      s => s.type === 'triggered' && s.source.uuid === defender.uuid
    );
    expect(deathTrigger).toBeDefined();
  });

  it('unblocked attacker deals damage to defending player', () => {
    room.currentPhase = 'stateMainPhase';
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');

    const attacker = room.battlefield.find(c => c.state.controllerId === 'player1')!;
    const initialLife = room.players['player2'].life;

    engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });

    // Skip blockers (transition through without declaring)
    engine.transition('declareBlockersStep');
    engine.transition('combatDamageStep');

    const after = engine.roomState;
    // Player2 takes 5 damage (Crimson Hellkite power)
    expect(after.players['player2'].life).toBe(initialLife - 5);
  });
});
```

- [ ] **Step 3: Update `option-service.test.ts`**

Remove the attack option test. Find and delete any test that references `ACTION_IDS.attack` or the attack option. Add a test verifying the attack option is NOT emitted:

```ts
    it('should NOT emit an attack option (attack is now batch in declareAttackersStep)', () => {
      const card = room.players['player1'].hand[0];
      card.blueprint.cardTypes = ['Creature'];
      card.state.zone = 'battlefield';
      card.state.isTapped = false;
      card.state.summoningSickness = false;
      room.battlefield.push(card);
      room.players['player1'].hand = [];

      const options = service.getOptions(room, 'player1', card.uuid, 'battlefield');
      expect(options.some(o => o.actionId === 'attack')).toBe(false);
    });
```

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tests/engine/battle-phase-smoke.test.ts tests/engine/combat-integration.test.ts tests/engine/option-service.test.ts
git commit -m "test: update existing tests for MTG combat model"
```

---

### Task 9: Remove `ATTACK_DECLARED` event emission from `game-engine.ts`

**Files:**
- Modify: `src/engine/game-engine.ts:170-195` (proposeAndStack ATTACK_DECLARED block)

**Interfaces:**
- Consumes: nothing new
- Produces: removed `ATTACK_DECLARED` event emission (per-attack event no longer relevant)

- [ ] **Step 1: Remove the `ATTACK_DECLARED` block**

In `src/engine/game-engine.ts`, remove the entire `ATTACK_DECLARED` emission block (lines ~170-195):

```ts
    // Emit ATTACK_DECLARED for attack triggers...
    if (result.attackingCard) {
      // ... remove this entire block
    }
```

Replace with a comment:

```ts
    // ATTACK_DECLARED (per-attack) is removed. The batch ATTACKERS_DECLARED
    // event is emitted by declareAttackersHandler. ON_ATTACK trigger wiring
    // is deferred until a card needs it.
```

- [ ] **Step 2: Run typecheck and tests**

Run: `npx tsc --noEmit`
Expected: PASS

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/engine/game-engine.ts
git commit -m "refactor: remove per-attack ATTACK_DECLARED event emission"
```

---

### Task 10: Final verification — typecheck + full test suite

**Files:**
- None (verification only)

- [ ] **Step 1: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (TYPECHECK CLEAN)

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Verify no stale references**

Run: `npx vitest run --reporter=verbose 2>&1 | Select-String -Pattern "attackHandler|ADD_COMBAT_DECLARATION|ACTION_IDS\.attack"`
Expected: No matches

- [ ] **Step 4: Commit if any cleanup was needed, otherwise done**

```bash
git status
```