# Full MTG Stack Model — Design Document (Option 3)

**Date:** 2026-09-06
**Status:** ✅ ACCEPTED (2026-09-07) — expanded with detailed implementation plan
**Context:** The battle-mechanics plan (`2026-09-06-battle-mechanics.md`, Tasks 1-7) is complete and committed. The current stack pipeline models all stack actions as a single `StackObject` discriminated by `type: 'spell' | 'activated' | 'triggered'`, and attack is shoehorned in as `type: 'activated'`. This spec separates the four MTG concepts — **cast** (CR 601), **activate** (CR 602), **trigger** (CR 603), and **declare attackers** (CR 508) — into distinct first-class data shapes and pipelines.

---

## 1. Overview

MTG has four distinct concepts that are often conflated as "the stack":

| Concept | CR | Uses stack? | Source moves? | Priority? |
|---------|----|-------------|---------------|-----------|
| **Cast a spell** | 601 | Yes | Yes (hand→stack→destination) | Yes |
| **Activate an ability** | 602 | Yes (except mana) | No | Yes |
| **Triggered ability** | 603 | Yes | No | Yes (next priority check) |
| **Declare attackers** | 508 | **No** | No | No — turn-based action |
| **Mana ability** | 605 | **No** | No | No — resolves immediately |

The current codebase conflates these into one `StackObject` type with a `type` discriminator, and attack is incorrectly modeled as an activated ability. This spec introduces:

1. A **`CombatDeclaration`** structure for attack (turn-based action, not on the stack).
2. A refined **`StackObject`** that cleanly separates spell/activated/triggered with distinct data shapes.
3. A **unified resolution pipeline** that branches on the concept type.

---

## 2. Current State (verified 2026-09-06)

| Piece | Location | Status |
|-------|----------|--------|
| `StackItemType = 'spell' \| 'activated' \| 'triggered'` | `src/types/effect.types.ts` | ✅ Defined |
| `StackObject` (single shape, `source: any`) | `src/types/effect.types.ts` | ⚠️ Overloaded — `source` is `any` |
| `StackEffect` (action/params/targets) | `src/types/effect.types.ts` | ✅ Defined |
| `room.stack: StackObject[]` | `src/types/game.room.types.ts` | ✅ Defined |
| `attackHandler` → `type: 'activated'` | `src/engine/handlers/attack-handler.ts` | ❌ Wrong concept |
| `playCardHandler` → `type: 'spell'` | `src/engine/handlers/play-card-handler.ts` | ✅ Correct |
| `TriggerManager` → `type: 'triggered'` | `src/engine/trigger-manager.ts` | ✅ Correct |
| `tapForManaHandler` → no stack | `src/engine/handlers/tap-for-mana-handler.ts` | ✅ Correct |
| `applyStructuralZoneChange()` | `src/engine/effect-resolver.ts` | ⚠️ Branches on `type` (works, but ad-hoc) |
| `resolveStackObject()` | `src/engine/effect-resolver.ts` | ⚠️ Branches on `type` (works, but ad-hoc) |
| `addToStack()` | `src/engine/state-machine.ts` | ⚠️ Assumes every stack action gives priority to controller |
| `StackDisplay.tsx` | `src/client/components/StackDisplay.tsx` | ⚠️ Renders `so.type` + `so.source.blueprint.name` |

### Gaps

1. **`source: any`.** The `StackObject.source` field is untyped (`any`), so the resolution pipeline must cast it to `CardInstance` and hope it's correct. A spell's source is a card on the stack; an activated ability's source is a card on the battlefield. These are different invariants that the type system doesn't enforce.
2. **Attack is an activated ability.** Semantically wrong — attack is a turn-based action.
3. **No `CombatDeclaration`.** There's no structure for the declare-attackers step; attack damage is modeled as stack effects.
4. **Ad-hoc resolution branching.** `applyStructuralZoneChange()` and `resolveStackObject()` branch on `type` with inline comments, but the branches aren't first-class.
5. **Priority is uniform.** `addToStack()` gives priority to the controller for every stack action, but MTG has different priority rules for triggered abilities (they wait for the next priority check).

---

## 3. Design

### 3.1 Type system — split `StackObject` into a discriminated union

**Current definition** (`src/types/effect.types.ts` §7):

```ts
export type StackItemType = 'spell' | 'activated' | 'triggered';

export interface StackObject {
  readonly uuid: string;
  readonly type: StackItemType;
  readonly controllerId: string;
  readonly source: any; // CardInstance — imported at usage sites to avoid circular deps
  readonly effects: StackEffect[];
  readonly timestamp?: number;
  countered: boolean;
  fizzled?: boolean;
}

export interface StackObjectConfig {
  type: StackItemType;
  controllerId: string;
  source: any;
  effects: StackEffect[];
}
```

**New definition** — replace the single `StackObject` interface with a discriminated union keyed on `type`, plus a new `CombatDeclaration` for attack:

```ts
// A spell being cast (CR 601). Source is a card that moved hand→stack.
export interface SpellStackObject {
  readonly uuid: string;
  readonly type: 'spell';
  readonly controllerId: string;
  readonly source: CardInstance;   // the card ON the stack
  readonly effects: StackEffect[];
  countered: boolean;
  fizzled?: boolean;
}

// An activated ability (CR 602). Source is a permanent already on the battlefield.
export interface ActivatedStackObject {
  readonly uuid: string;
  readonly type: 'activated';
  readonly controllerId: string;
  readonly source: CardInstance;   // the permanent (stays on battlefield)
  readonly ability: ActivatedAbility;  // the ability being activated
  readonly effects: StackEffect[];
  countered: boolean;
  fizzled?: boolean;
}

// A triggered ability (CR 603). Source is a permanent already on the battlefield.
export interface TriggeredStackObject {
  readonly uuid: string;
  readonly type: 'triggered';
  readonly controllerId: string;
  readonly source: CardInstance;   // the permanent (stays on battlefield)
  readonly ability: TriggeredAbility;  // the ability that triggered
  readonly effects: StackEffect[];
  countered: boolean;
  fizzled?: boolean;
}

export type StackObject = SpellStackObject | ActivatedStackObject | TriggeredStackObject;

// A combat declaration (CR 508) — NOT on the stack.
export interface CombatDeclaration {
  readonly uuid: string;
  readonly attacker: CardInstance;      // the attacking creature
  readonly target: TargetPointer;       // opponent player OR opponent creature
  readonly attackerPower: number;       // locked at declaration time
  readonly defenderPower?: number;      // locked at declaration time (creature target)
}
```

**Key changes:**
- `source` is now typed `CardInstance` (no more `any`). This requires importing `CardInstance` into `effect.types.ts`. **Circular-import check:** `card.types.ts` already imports from `effect.types.ts` (`ActionCost`, `ActionRequirements`, `ActionSpeed`, `EffectPayload`). Adding `import type { CardInstance } from './card.types'` to `effect.types.ts` creates a **type-only cycle**, which is safe in TypeScript (erased at compile time) — but must be `import type`, never a value import. `ActivatedAbility`/`TriggeredAbility` are already defined in `card.types.ts`, so they must also be imported as `import type`.
- `ActivatedStackObject` and `TriggeredStackObject` carry their `ability` (the `ActivatedAbility`/`TriggeredAbility` from the card blueprint), so the resolution pipeline can read cost/duration/effect metadata without re-looking-up.
- `CombatDeclaration` is a separate structure, **not** a `StackObject`.
- `StackObjectConfig` is **deleted** — it is unused (verified: no references in `src/` or `tests/`).
- `StackItemType` is **kept** as a convenience alias: `export type StackItemType = StackObject['type'];` (used by `play-card-handler.ts` and `StackDisplay.tsx`).

**`CombatDeclaration` placement decision:** `CombatDeclaration` references `TargetPointer` (same file) and `CardInstance` (imported). It lives in `effect.types.ts` alongside `StackObject` so `game.room.types.ts` can import both from one place. Alternative (putting it in `card.types.ts`) is rejected because `card.types.ts` is the "blueprint" domain and combat is a runtime concept like the stack.

### 3.2 Room state — separate `combat` from `stack`

**Current definition** (`src/types/game.room.types.ts`):

```ts
export interface GameRoom {
    readonly roomId: string;
    player1Id: PlayerId;
    player2Id: PlayerId | null;
    players: Record<PlayerId, PlayerState>;
    currentPhase: GameStateName;
    previousPhase: GameStateName | null;
    activeTurnPlayerId: PlayerId;
    priorityPlayerId: PlayerId | null;
    lastPassedPlayerId: PlayerId | null;
    stack: StackObject[];
    battlefield: CardInstance[];
    continuousEffectPool: ContinuousEffectEntry[];
    rpsState: { status: string; playedCards: Record<PlayerId, string> };
}
```

**New definition** — add `combat`:

```ts
export interface GameRoom {
    // ... unchanged fields ...
    stack: StackObject[];              // spells + activated + triggered abilities
    combat: CombatDeclaration[];       // declared attackers (turn-based action)
    // ...
}
```

Attack declarations go into `room.combat`, not `room.stack`. The `StackDisplay` no longer shows attacks; a new `CombatDisplay` (or the battlefield itself) shows declared attackers.

**Reducer impact:** `gameReducer` must initialize `combat: []` in `createRoom`/`room-factory.ts` (the room factory is the single construction site — verify it's the only place `GameRoom` is built). A new mutation `ADD_COMBAT_DECLARATION` / `CLEAR_COMBAT` is added to `game-mutation.types.ts` (see §3.7).

### 3.3 Attack handler — produce a `CombatDeclaration`, apply damage directly

**Current behavior** (`src/engine/handlers/attack-handler.ts`):
- `propose()` builds a `StackObject` with `type: 'activated'`, pushes it via `PUSH_STACK`.
- Damage is modeled as `StackEffect[]` with `MODIFY_STATS` (damage param) and `MODIFY_LIFE`.
- `resolve()` is dead code (engine uses `resolveStackObject()` in `effect-resolver.ts`).

**New behavior:**
`attackHandler.propose()` produces a `CombatDeclaration` (not a `StackObject`), and the damage is applied immediately via `SET_DAMAGE` and `SET_LIFE` mutations (turn-based action — no stack, no priority):

```ts
propose(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
  // ... validate (unchanged) ...

  const mutations: GameMutation[] = [];

  // COST: Tap the creature and mark as attacked
  mutations.push({ type: 'TAP_CARD', cardUuid: card.uuid });
  mutations.push({ type: 'SET_ATTACKED_THIS_TURN', cardUuid: card.uuid, value: true });

  const attackerPower = CardCharacteristicService.resolvePower(room, card);
  const targets = action.targets as TargetPointer[] | undefined;
  const targetCreature = targets && targets.length > 0 && targets[0].cardUuid
    ? findAnyCardOnBattlefield(room, targets[0].cardUuid)
    : undefined;

  const opponentId = room.player1Id === playerId ? room.player2Id! : room.player1Id;

  if (targetCreature) {
    // Creature-vs-creature combat
    const defenderPower = CardCharacteristicService.resolvePower(room, targetCreature);
    const defenderToughness = CardCharacteristicService.resolveToughness(room, targetCreature);

    // Attacker deals damage to defender (SET_DAMAGE, not MODIFY_STATS)
    mutations.push({ type: 'SET_DAMAGE', cardUuid: targetCreature.uuid,
      amount: (targetCreature.state.damageTaken || 0) + attackerPower });

    // Defender deals counter-damage to attacker
    mutations.push({ type: 'SET_DAMAGE', cardUuid: card.uuid,
      amount: (card.state.damageTaken || 0) + defenderPower });

    // Trample: excess damage to defending player
    if (hasKeyword(card, 'Trample') && attackerPower > defenderToughness) {
      const excessDamage = attackerPower - defenderToughness;
      const defenderControllerId = targetCreature.state.controllerId;
      const defenderPlayer = room.players[defenderControllerId];
      mutations.push({ type: 'SET_LIFE', playerId: defenderControllerId,
        amount: defenderPlayer.life - excessDamage });
    }
  } else {
    // Attack the face
    const opponent = room.players[opponentId];
    mutations.push({ type: 'SET_LIFE', playerId: opponentId,
      amount: opponent.life - attackerPower });
  }

  // Build CombatDeclaration for room.combat (for UI / future blocker step)
  const declaration: CombatDeclaration = {
    uuid: (action.stackUuid as string) || '',
    attacker: card,
    target: targetCreature
      ? { targetType: 'permanent', cardUuid: targetCreature.uuid }
      : { targetType: 'player', playerId: opponentId },
    attackerPower,
    defenderPower: targetCreature ? CardCharacteristicService.resolvePower(room, targetCreature) : undefined,
  };

  // Push to room.combat (new mutation)
  mutations.push({ type: 'ADD_COMBAT_DECLARATION', declaration });

  // NO stackObject — return mutations + combatDeclaration directly
  return { success: true, mutations, attackingCard: card, combatDeclaration: declaration };
}
```

**Key differences from current:**
- No `StackObject` construction. No `PUSH_STACK`.
- Damage via `SET_DAMAGE` (accumulates on `card.state.damageTaken`) instead of `MODIFY_STATS` with `damage` param. `SET_DAMAGE` is the primitive that SBA reads.
- Life loss via `SET_LIFE` (absolute) instead of `MODIFY_LIFE` (relative). The handler reads current life and computes the new value.
- `CombatDeclaration` is pushed to `room.combat` via new `ADD_COMBAT_DECLARATION` mutation.
- `resolve()` method is **deleted** (dead code — the engine never calls it for attack).

**`ActionResult` type update:** The `ActionResult` discriminated union must add `combatDeclaration`:

```ts
export type ActionResult =
  | { success: true; stackObject?: StackObject; mutations?: GameMutation[];
      attackingCard?: CardInstance; combatDeclaration?: CombatDeclaration }
  | { success: false; phase: 'validate' | 'propose' | 'resolve'; reason: string };
```

### 3.4 Resolution pipeline — branch on the discriminated union

**Current behavior** (`src/engine/effect-resolver.ts`):
- `applyStructuralZoneChange()` casts `stackObj.source as CardInstance` and branches with `if (stackObj.type === 'activated' || stackObj.type === 'triggered')`.
- `resolveStackObject()` gates `PERMANENT_ENTERED` on `stackObj.type === 'spell'`.
- `buildDynamicParams()` casts `stackObj.source as CardInstance | undefined`.

**New behavior** — exhaustive `switch` on the narrowed union:

```ts
function applyStructuralZoneChange(room: GameRoom, stackObj: StackObject): { card: CardInstance; mutations: GameMutation[] } {
  switch (stackObj.type) {
    case 'spell': {
      // source moves stack→destination (battlefield or graveyard)
      const card = stackObj.source;  // already CardInstance — no cast
      const ownerId = card.state.controllerId || card.state.ownerId;
      const mutations: GameMutation[] = [];
      if (stackObj.countered) {
        mutations.push({ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: ownerId, from: 'stack', to: 'graveyard' });
      } else if (isPermanent(card)) {
        mutations.push({ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: ownerId, from: 'stack', to: 'battlefield' });
        mutations.push({ type: 'UNTAP_CARD', cardUuid: card.uuid });
        if (card.blueprint.cardTypes.includes('Creature')) {
          mutations.push({ type: 'SET_SUMMONING_SICKNESS', cardUuid: card.uuid, value: true });
        }
      } else {
        mutations.push({ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: ownerId, from: 'stack', to: 'graveyard' });
      }
      return { card, mutations };
    }
    case 'activated':
    case 'triggered':
      // source stays on battlefield; only POP_STACK
      return { card: stackObj.source, mutations: [{ type: 'POP_STACK' }] };
  }
}
```

The `switch` is exhaustive — adding a new type forces the compiler to handle it (no `default` case, so a missing branch is a compile error).

**`resolveStackObject()` PERMANENT_ENTERED gating** — unchanged logic, but now type-narrowed:

```ts
if (!stackObj.countered && stackObj.type === 'spell' && isPermanent(stackObj.source)) {
  eventBus.emit({ eventId: 'PERMANENT_ENTERED', ... });
}
```

**`buildDynamicParams()`** — `stackObj.source` is now `CardInstance` (no cast). The `DYNAMIC:source.power` / `DYNAMIC:source.toughness` branches drop the `as CardInstance | undefined` cast.

**`resolveEffects()`** — unchanged signature (`stackObj: StackObject`), but `stackObj.source` is now typed. The `EffectRegistry` handler signature stays `(room, stackObj: StackObject, effect)` — handlers that read `stackObj.source` (e.g. `MODIFY_STATS`, `DRAW`) now get a typed `CardInstance`.

### 3.5 Priority — differentiate by concept

`addToStack()` currently gives priority to the controller for every stack action. Refine:

- **Spell / activated ability** (CR 116.3d): the player who cast/activated gets priority first.
- **Triggered ability** (CR 603.3): the triggered ability is put on the stack the next time a player would receive priority — it does **not** immediately give priority to its controller.

This is deferred per the user's "delay priority" decision, but the type split makes it representable. **No functional change in this spec** — `addToStack()` keeps its current behavior (give priority to `stackObj.controllerId`). The discriminated union just makes the future differentiation a clean `switch` on `stackObj.type`.

### 3.6 Client — `StackDisplay` + new `CombatDisplay`

**`StackDisplay.tsx`** — currently renders `so.type` + `so.source?.blueprint?.name`. With the union, `so.source` is typed `CardInstance`, so the optional chaining `so.source?.blueprint?.name` can be simplified to `so.source.blueprint.name` (still safe to keep the `?.` for defensive rendering). No functional change.

**New `CombatDisplay.tsx`** (or battlefield annotation) — renders declared attackers from `room.combat`:

```tsx
const combat = useGameStore(useShallow((s) => s.room?.combat ?? EMPTY_COMBAT));
// render each declaration: attacker name + target (player or creature)
```

**`gameStore.ts`** — the room type now includes `combat`, so the store selector `s.room?.combat` is typed automatically. No store change needed beyond the type flowing through.

### 3.7 New mutations — `ADD_COMBAT_DECLARATION` / `CLEAR_COMBAT`

Add to `src/types/game-mutation.types.ts`:

```ts
// Combat mutations
| { type: 'ADD_COMBAT_DECLARATION'; declaration: CombatDeclaration }
| { type: 'CLEAR_COMBAT' }
```

Add to `gameReducer`:

```ts
case 'ADD_COMBAT_DECLARATION':
  return { ...state, combat: [...state.combat, mutation.declaration] };

case 'CLEAR_COMBAT':
  return { ...state, combat: [] };
```

**When is `CLEAR_COMBAT` fired?** In the current single-attacker model, combat resolves immediately (damage applied in `propose()`), so `room.combat` is a transient record. `CLEAR_COMBAT` is fired at `endCombat` phase transition (in `state-machine.ts` `transition()`), mirroring how `attackedThisTurn` is cleared at `stateTurnStart`. This keeps `room.combat` from accumulating stale declarations across turns. (In a future declare-blockers step, `CLEAR_COMBAT` would fire at the end of the combat damage step instead.)

### 3.8 `game-engine.ts` — route `CombatDeclaration` separately

**Current `proposeAndStack()`** (relevant excerpt):

```ts
if (result.stackObject) {
  const smMutations = this.stateMachine.addToStack(this.room, result.stackObject);
  ...
}
if (result.attackingCard) {
  // emit ATTACK_DECLARED + drain triggers
}
```

**New behavior:**
- The `if (result.stackObject)` guard already skips `addToStack()` when attack returns no `stackObject` — **no change needed**.
- The `if (result.attackingCard)` block still emits `ATTACK_DECLARED` for `ON_ATTACK` triggers — **keep it**. The `attackingCard` field is retained on `ActionResult`.
- The `ATTACK_DECLARED` payload's `target` should now reflect the actual `CombatDeclaration.target` (creature or player), not always the opponent player. Change:

```ts
if (result.attackingCard) {
  this.eventBus.emit({
    eventId: 'ATTACK_DECLARED',
    roomId: this.room.roomId,
    payload: {
      card: result.attackingCard,
      controllerId: playerId,
      target: result.combatDeclaration?.target ?? { targetType: 'player', playerId: opponentId },
    },
  });
  // drain triggers (unchanged)
}
```

### 3.9 `play-card-handler.ts` — produce `SpellStackObject`

**Current:** builds `StackObject` with `type: 'spell'` and `source: stackCard` (a zone-updated copy). This is already correct — the only change is the type annotation becomes `SpellStackObject` (or just `StackObject`, which narrows to `SpellStackObject` via the `type: 'spell'` literal). No functional change. The `stackCard` copy already sets `state.zone = 'stack'`, satisfying the "source is on the stack" invariant.

### 3.10 `trigger-manager.ts` — produce `TriggeredStackObject` (carry `ability`)

**Current:** builds `StackObject` with `type: 'triggered'`, `source: card`, `effects`. It does **not** carry the `TriggeredAbility`.

**New:** the `getMatchingTriggers()` helper currently returns `StackEffect[]` and loses the `ability` reference. Change it to return `{ ability, effects }[]` so the `TriggeredStackObject` can carry `ability`:

```ts
function getMatchingTriggers(card, event, controllerId): Array<{ ability: TriggeredAbility; effects: StackEffect[] }> {
  const matches = [];
  for (const ability of card.blueprint.abilities) {
    if (ability.type === 'triggered' && ability.triggerCondition === event) {
      matches.push({ ability, effects: buildTriggeredEffects(ability, controllerId) });
    }
  }
  return matches;
}
```

Then in the listener, build one `TriggeredStackObject` per matching ability:

```ts
for (const { ability, effects } of matches) {
  const stackObj: TriggeredStackObject = {
    uuid: this.generateUuid(),
    type: 'triggered',
    controllerId,
    source: card,
    ability,
    effects,
    countered: false,
  };
  this.collector.push({ type: 'PUSH_STACK', stackObject: stackObj });
}
```

**Note:** the legacy `onEnterEffects` path (for `PERMANENT_ENTERED`) has no `TriggeredAbility` — it's a `CardBlueprint.onEnterEffects` array. For that path, either (a) synthesize a minimal `TriggeredAbility` wrapper, or (b) keep `ability` optional on `TriggeredStackObject`. **Decision:** make `ability` optional (`ability?: TriggeredAbility`) to avoid fabricating a fake ability for the legacy path. The resolution pipeline doesn't read `ability` yet — it's carried for future use. This is the pragmatic choice; revisit when the pipeline actually consumes `ability`.

### 3.11 `CombatDisplay.tsx` — UI design

**Mount point:** `GameScreen.tsx` currently has a 3-column grid layout:

```
┌──────────────────────────────────────────────┐
│ room-banner (full width)                     │
├──────────┬────────────────────┬──────────────┤
│ left     │ center             │ right        │
│ Opponent │ StackDisplay       │ GameLog      │
│ Player   │ Battlefield        │              │
│ PhaseBar │ Hand               │              │
└──────────┴────────────────────┴──────────────┘
```

`CombatDisplay` mounts in the **center column**, between `StackDisplay` and `Battlefield`. This is the natural "action zone" — the stack shows above, combat declarations show next, then the battlefield below.

**Component design:**

```tsx
// src/client/components/CombatDisplay.tsx
import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '../store/gameStore';
import type { CombatDeclaration } from '../../types/effect.types';

const EMPTY_COMBAT: never[] = [];

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
            {' → '}
            <span className="combat-target">
              {decl.target.targetType === 'player'
                ? 'Opponent'
                : decl.target.cardUuid ?? 'unknown'}
            </span>
            <span className="combat-damage">
              ({decl.attackerPower}/{decl.defenderPower ?? '—'})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

**CSS additions** (in `style.css`):

```css
/* Combat Display */
.combat-display {
  background: #16213e;
  border-radius: 8px;
  padding: 1rem;
  width: 100%;
  border-left: 3px solid #e94560;  /* red accent — combat indicator */
}

.combat-display ul {
  padding-left: 1.5rem;
  list-style: none;
}

.combat-display li {
  padding: 0.25rem 0;
  font-size: 0.85rem;
}

.combat-attacker {
  color: #e94560;
  font-weight: bold;
}

.combat-target {
  color: #ffd700;
}

.combat-damage {
  color: #888;
  font-size: 0.75rem;
  margin-left: 0.5rem;
}
```

**Visual behavior:**
- Appears only when `room.combat.length > 0` (i.e., during/after an attack declaration).
- Shows attacker name (red), arrow, target (gold), and power/toughness snapshot (grey).
- In the current single-attacker model, combat resolves immediately, so `CombatDisplay` is a **transient flash** — it appears briefly then disappears when `CLEAR_COMBAT` fires at `endCombat`. This is acceptable for now; in the future declare-blockers step, combat declarations will persist until the combat damage step.
- The red left-border visually distinguishes combat from the stack (which has no border accent).

**`GameScreen.tsx` change:**

```tsx
import CombatDisplay from './CombatDisplay';

// In the center column:
<div className="column column-center">
  <StackDisplay />
  <CombatDisplay />   {/* NEW — between stack and battlefield */}
  <Battlefield />
  <Hand />
</div>
```

**Alternative considered:** Annotating the battlefield cards directly (e.g., a "swords crossed" icon on attacking creatures). Rejected because:
1. The battlefield already has targeting highlights (gold pulse outline) — adding combat annotations would conflict visually.
2. A separate `CombatDisplay` mirrors `StackDisplay` and keeps the "action zone" metaphor consistent.
3. When declare-blockers is added, the combat display will grow to show attacker→blocker pairs, which needs its own space.

### 3.12 Legacy `onEnterEffects` migration plan

**Current state:**
- `CardBlueprint.onEnterEffects` is an `EffectDefinition[]` — a flat list of effects that fire when the permanent enters the battlefield.
- `TriggerManager` checks `card.blueprint.onEnterEffects` in the `PERMANENT_ENTERED` listener and converts them to `StackEffect[]` via `buildStackEffects()`.
- No card in `card_data.json` currently uses `onEnterEffects` (verified: zero matches). The field exists in the type system and parser but is **unused in production data**.
- The RPS cards (rock/paper/scissors) use `onCastEffects` (not `onEnterEffects`).

**Why it's legacy:**
- `onEnterEffects` predates the `abilities` array model. Modern cards express ETB effects as `TriggeredAbility` with `triggerCondition: 'ON_ENTER_BATTLEFIELD'`.
- The `onEnterEffects` path bypasses the `TriggeredAbility` type — it has no `castSpeed`, no `triggerCondition` (it's hardcoded to `PERMANENT_ENTERED`), and no `ability` reference to carry on the `TriggeredStackObject`.

**Migration timeline:**

| Phase | Action | Trigger |
|--------|--------|---------|
| **Now (this spec)** | Keep `ability` optional on `TriggeredStackObject`. The `onEnterEffects` path continues to work. | No production cards use `onEnterEffects` — zero risk. |
| **Next card design pass** | When the first card with an ETB effect is designed, use the `abilities` array with `type: 'triggered'` + `triggerCondition: 'ON_ENTER_BATTLEFIELD'` instead of `onEnterEffects`. | First ETB card triggers the migration. |
| **Migration complete** | Once all cards use the `abilities` model for ETB, remove the `onEnterEffects` field from `CardBlueprint`, `card-parser.ts`, and `trigger-manager.ts`. Make `ability` required on `TriggeredStackObject`. | No remaining `onEnterEffects` consumers. |

**Estimated timeline:** The next card design pass is not yet scheduled. Since no production cards use `onEnterEffects`, the migration is **zero-cost to defer**. The `ability?: TriggeredAbility` optional field is a clean marker — grep for `ability?` finds all sites that need updating when migration happens.

**What the migration looks like** (for reference):

Before (legacy):
```json
{
  "id": "some-etb-creature",
  "onEnterEffects": [{ "action": "DRAW", "params": { "amount": 1 }, "targeting": { "type": "self", "required": false } }]
}
```

After (migrated):
```json
{
  "id": "some-etb-creature",
  "abilities": [
    {
      "type": "triggered",
      "triggerCondition": "ON_ENTER_BATTLEFIELD",
      "effectId": "DRAW",
      "params": { "amount": 1 },
      "castSpeed": "instant"
    }
  ]
}
```

### 3.13 `CLEAR_COMBAT` timing and declare-blockers roadmap

**Current timing:** `CLEAR_COMBAT` fires at the `endCombat` phase transition in `state-machine.ts`:

```ts
if (to === 'endCombat') {
  mutations.push({ type: 'CLEAR_COMBAT' });
}
```

This is a **placeholder** — in the current single-attacker model, damage is applied immediately in `propose()`, so `room.combat` is a transient record. Clearing at `endCombat` prevents stale declarations from leaking across turns.

**Target timing (post-blockers):** `CLEAR_COMBAT` should fire at the **end of the combat damage step**, not at `endCombat`. The MTG combat phase is:

```
stateBattlePhase
  → declareAttackersStep   (attack declarations go into room.combat)
  → declareBlockersStep    (blocker assignments added to CombatDeclaration)
  → combatDamageStep       (damage applied; CLEAR_COMBAT fires here)
  → endCombat              (cleanup — no combat declarations remain)
```

**Abstraction strategy:**

The `CLEAR_COMBAT` mutation is already a single point of change — it's one case in `gameReducer` and one emission site in `state-machine.ts`. When the declare-blockers step is implemented:

1. Move the `CLEAR_COMBAT` emission from `endCombat` to a new `combatDamageStep` phase (or inline it after damage application).
2. The `CombatDeclaration` structure gains a `blockers?: CardInstance[]` field.
3. `CombatDisplay` renders attacker→blocker pairs.

**No abstraction overhead:** The current `endCombat` timing is a one-line change to move. No wrapper functions, no indirection — just move the `mutations.push({ type: 'CLEAR_COMBAT' })` line to the new location.

**Declare-blockers implementation schedule:** Not yet planned. The blocker mechanics depend on:
- Multi-creature combat (multiple attackers per turn)
- Blocking restrictions (e.g., Flying evasion already implemented in `attackHandler.validate()`)
- Combat damage assignment ordering (attacker chooses how to distribute damage among blockers)

These are post-MVP features. The current `CLEAR_COMBAT` at `endCombat` is sufficient until then.

### 3.14 Consumption of `ability` metadata — future use cases

The `ActivatedStackObject.ability` and `TriggeredStackObject.ability` fields are carried on the stack object but **not yet consumed** by the resolution pipeline. Here is what will consume them:

| Consumer | What it reads | When |
|----------|--------------|------|
| **`effect-resolver.ts` — cost verification** | `ability.cost` — verify the cost was actually paid (e.g., tap cost on an activated ability that was responded to by tapping the source). Currently costs are paid in `propose()` and never re-verified. | When instant-speed interaction is added (opponent can respond to an activated ability by tapping/bouncing the source). |
| **`effect-resolver.ts` — duration tracking** | `ability.duration` — for `END_OF_TURN` effects, the resolution pipeline needs to know the duration to create the correct `ContinuousEffectEntry`. Currently `GRANT_STATS` hardcodes `END_OF_TURN` in `effect-registry.ts`. | When activated abilities with different durations exist (e.g., `WHILE_TAPPED`, `PERMANENT`). |
| **`effect-resolver.ts` — fizzle on illegal source** | `ability` — if the source permanent left the battlefield before the ability resolved, the ability should fizzle. Currently the pipeline doesn't check this (the source is assumed to still be there). | When instant-speed removal exists (opponent can kill the source in response). |
| **`StackDisplay.tsx` — ability name** | `ability.effect.effectId` — render "Crimson Hellkite — GRANT_STATS" instead of just "activated — Crimson Hellkite". | UI polish pass. |
| **`game-engine.ts` — counter logic** | `ability` — counter spells that target "activated ability" vs "spell" need to distinguish. Currently `SET_COUNTERED` works on any `StackObject`. | When counter spells with type restrictions exist (e.g., "Counter target activated ability"). |
| **`trigger-manager.ts` — ON_ABILITY_ACTIVATED event** | `ability` — emit an event when an activated ability is put on the stack, so other cards can trigger off it. | When "whenever you activate an ability" triggers exist. |

**Priority order:**
1. **Duration tracking** — needed as soon as a second activated ability with a different duration exists. Currently only `GRANT_STATS` with `END_OF_TURN` exists, so this is the first consumer.
2. **Fizzle on illegal source** — needed when instant-speed removal exists. This is the next major mechanic after blockers.
3. **Cost verification** — needed when instant-speed tapping exists (opponent taps your creature in response to its ability).
4. **UI / counter / event** — polish and niche mechanics.

**Design principle:** The `ability` field is carried on the stack object so these consumers can read it without re-scanning the card blueprint. This is the same pattern as `StackEffect.targeting` — the data is locked at propose time and available at resolve time.

---

## 4. Impact on existing behavior

| Behavior | Before | After |
|----------|--------|-------|
| Attack on stack | Yes (`type: 'activated'`) | No — `room.combat` |
| `source` typing | `any` | `CardInstance` (narrowed) |
| Ability metadata | Re-looked-up at resolve | Carried on the StackObject |
| Resolution branching | Ad-hoc `if` on `type` | Exhaustive `switch` |
| Priority | Uniform | Differentiated (deferred) |
| Client stack display | Shows attack | Shows only spells/abilities |

---

## 5. Files to change

### Type system (3 files)

| File | Change | Risk |
|------|--------|------|
| `src/types/effect.types.ts` | Split `StackObject` into discriminated union; add `CombatDeclaration`; add `import type { CardInstance, ActivatedAbility, TriggeredAbility } from './card.types'`; delete `StackObjectConfig`; keep `StackItemType` as alias | Medium — type-only cycle with `card.types.ts` |
| `src/types/game.room.types.ts` | Add `combat: CombatDeclaration[]`; add `import type { CombatDeclaration } from './effect.types'` | Low |
| `src/types/game-mutation.types.ts` | Add `ADD_COMBAT_DECLARATION` and `CLEAR_COMBAT` mutations; add `import type { CombatDeclaration } from './effect.types'` | Low |

### Engine core (5 files)

| File | Change | Risk |
|------|--------|------|
| `src/engine/handlers/attack-handler.ts` | Rewrite `propose()` — no `StackObject`, apply `SET_DAMAGE`/`SET_LIFE` directly, push `CombatDeclaration`; delete `resolve()`; remove `StackObject`/`StackEffect` imports | Medium — core combat logic |
| `src/engine/handlers/play-card-handler.ts` | No functional change — `StackObject` type narrows to `SpellStackObject` via `type: 'spell'` literal | Low |
| `src/engine/trigger-manager.ts` | `getMatchingTriggers()` returns `{ ability, effects }[]`; build `TriggeredStackObject` with `ability` field; `ability` is optional (for legacy `onEnterEffects` path) | Low |
| `src/engine/effect-resolver.ts` | `applyStructuralZoneChange()` — exhaustive `switch` on `stackObj.type`; `buildDynamicParams()` — drop `as CardInstance` casts; `resolveStackObject()` — type-narrowed `PERMANENT_ENTERED` gate | Medium — resolution pipeline |
| `src/engine/game-engine.ts` | `ATTACK_DECLARED` payload uses `result.combatDeclaration?.target`; `ActionResult` type gains `combatDeclaration` | Low |

### Engine support (3 files)

| File | Change | Risk |
|------|--------|------|
| `src/engine/action-registry.ts` | `ActionResult` type gains `combatDeclaration?: CombatDeclaration` | Low |
| `src/engine/game-reducer.ts` | Add `ADD_COMBAT_DECLARATION` and `CLEAR_COMBAT` cases; `findCard()` in stack now uses typed `so.source` (no cast needed) | Low |
| `src/engine/state-machine.ts` | `transition()` to `endCombat` fires `CLEAR_COMBAT`; `addToStack()` unchanged (deferred priority differentiation) | Low |

### Client (3 files)

| File | Change | Risk |
|------|--------|------|
| `src/client/components/StackDisplay.tsx` | `so.source` is now typed `CardInstance` — optional chaining still works but can be simplified | Low |
| `src/client/components/CombatDisplay.tsx` | **New file** — renders `room.combat` declarations with attacker→target arrows and P/T snapshot. Mounts in center column between `StackDisplay` and `Battlefield`. | Low |
| `src/client/components/GameScreen.tsx` | Import and mount `<CombatDisplay />` in center column | Low |
| `src/client/style.css` | Add `.combat-display`, `.combat-attacker`, `.combat-target`, `.combat-damage` styles | Low |

### Room factory (1 file)

| File | Change | Risk |
|------|--------|------|
| `src/engine/room-factory.ts` | Initialize `combat: []` in `createRoom()` | Low |

### Tests (12 files — all files touching `StackObject` or attack)

| File | Change | Risk |
|------|--------|------|
| `tests/engine/attack-handler.test.ts` | Assert no `stackObject`; assert `SET_DAMAGE`/`SET_LIFE` mutations directly; assert `combatDeclaration` exists; remove `PUSH_STACK` assertions | Medium |
| `tests/engine/combat-integration.test.ts` | Assert no stack item for attack; assert damage applied directly; assert `room.combat` has declaration | Medium |
| `tests/engine/play-card-handler.test.ts` | `stackObject.type` is still `'spell'` — no change needed (type narrows automatically) | Low |
| `tests/engine/trigger-manager.test.ts` | Assert `TriggeredStackObject` has `ability` field; `PUSH_STACK` mutation unchanged | Low |
| `tests/engine/effect-resolver.test.ts` | `makeStackObj()` helper — `type: 'spell'` still works; `source` is now typed `CardInstance` | Low |
| `tests/engine/effect-registry.test.ts` | `makeStackObj()` helper — same as above | Low |
| `tests/engine/game-engine.test.ts` | Assert `result.stackObject` is `undefined` for attack; assert `result.combatDeclaration` exists | Low |
| `tests/engine/game-reducer.test.ts` | `makeStackObj()` helper — same; add `ADD_COMBAT_DECLARATION` / `CLEAR_COMBAT` tests | Low |
| `tests/engine/state-machine.test.ts` | `PUSH_STACK` with `type: 'spell'` still works; add `CLEAR_COMBAT` on `endCombat` test | Low |
| `tests/engine/action-service.test.ts` | `PUSH_STACK` assertion unchanged (spell path) | Low |
| `tests/engine/end-turn-handler.test.ts` | `StackObject` construction — `type: 'spell'` still works | Low |
| `tests/engine/option-service.test.ts` | No `StackObject` change — only `ActivatedAbility` in card blueprint | Low |

### Spec documents (1 file)

| File | Change | Risk |
|------|--------|------|
| `docs/superpowers/specs/2026-09-06-attack-turn-based-action-design.md` | Marked REJECTED | N/A |

---

## 6. Out of scope

- Full combat phase steps (declare blockers, combat damage step ordering).
- Blocking mechanics.
- First-strike / double-strike / lifelink / deathtouch.
- Priority windows (deferred by user).
- Mana abilities on the stack (stays off-stack, CR 605).
- `ability` consumption in the resolution pipeline (carried on the StackObject but not yet read).

---

## 7. Implementation order

The change is a single coherent refactor, but it can be sequenced to keep the build green at each step:

1. **Types first** — `effect.types.ts` (union + `CombatDeclaration`), `game.room.types.ts` (`combat`), `game-mutation.types.ts` (2 new mutations). This breaks compilation until consumers are updated, so do steps 1-3 together.
2. **Reducer + room factory** — `game-reducer.ts` (2 new cases), `room-factory.ts` (`combat: []`).
3. **Resolution pipeline** — `effect-resolver.ts` (exhaustive `switch`, drop casts).
4. **Handlers** — `attack-handler.ts` (rewrite), `play-card-handler.ts` (no-op), `trigger-manager.ts` (carry `ability`).
5. **Engine + registry** — `game-engine.ts` (`ATTACK_DECLARED` target), `action-registry.ts` (`ActionResult`).
6. **State machine** — `state-machine.ts` (`CLEAR_COMBAT` on `endCombat`).
7. **Client** — `StackDisplay.tsx` (type-safe), `CombatDisplay.tsx` (new).
8. **Tests** — update the 12 test files; add new coverage for `ADD_COMBAT_DECLARATION`/`CLEAR_COMBAT` and the `CombatDeclaration` flow.

**Recommended commit granularity:** one commit per step (or grouped 1-3, 4-6, 7-8) so each commit compiles and passes tests.

---

## 8. Verification

- `npx vitest run` — all tests pass (currently 278 tests / 21 files; expect the same or more after adding combat-declaration coverage).
- `npx tsc --noEmit` — clean (the discriminated union catches `source` misuse at compile time).
- Integration test asserts: attack applies damage immediately, no stack item, SBA kills defender, `ON_DIE` fires.
- Type-level test: `StackObject` union is exhaustive (no `any` casts remain in `effect-resolver.ts`).
- Manual smoke: attack a creature → `StackDisplay` shows nothing, `CombatDisplay` shows the declaration, defender takes damage and dies via SBA.

### Specific assertions to add

1. **`attack-handler.test.ts`**: `result.stackObject` is `undefined`; `result.combatDeclaration` is defined with `attackerPower` and `target`; `result.mutations` contains `SET_DAMAGE` (not `MODIFY_STATS`) and `ADD_COMBAT_DECLARATION`.
2. **`game-reducer.test.ts`**: `ADD_COMBAT_DECLARATION` appends to `room.combat`; `CLEAR_COMBAT` empties it.
3. **`state-machine.test.ts`**: transitioning to `endCombat` emits `CLEAR_COMBAT`.
4. **`trigger-manager.test.ts`**: `TriggeredStackObject.ability` is populated for `ON_ATTACK`/`ON_DIE` triggers.
5. **`combat-integration.test.ts`**: full attack → damage → SBA → `ON_DIE` flow with no stack item.