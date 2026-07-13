
# Code Review: TypeScript Card Game Engine

## Strengths

1. **Clean type hierarchy** — The separation of `CardBlueprint` (immutable definition) vs `CardInstance` (runtime state) vs `CardState` (mutable flags) is well-architected and follows the Flyweight-like pattern correctly.

2. **Discriminated unions for abilities** — `ActivatedAbility | TriggeredAbility` with a `type` discriminant is the right pattern for type-safe ability handling.

3. **Effect registry pattern** — Using a `Record<string, EffectHandler>` lookup table is a solid foundation for extensibility. New effects are just new entries.

4. **ActionValidator as pure static methods** — No side effects, takes room snapshot, returns validation result. This is testable and correct.

5. **TargetPointer abstraction** — The flexible pointer with `targetType`, optional IDs, and `metadata` bag is forward-thinking for complex targeting scenarios.

6. **Blueprint cache in card-factory** — Caching parsed blueprints avoids re-parsing JSON on every `instantiateCard` call.

---

## Issues

### Critical (Must Fix)

**1. `EffectPayload` is a closed discriminated union — blocks all new effects**
- **File:** effect.types.ts, lines ~65-70
- **What's wrong:** `EffectPayload` is a hardcoded union of exactly 5 effect types. Every new card effect requires editing this central type. This is the single biggest extensibility bottleneck. With 50+ unique effects, this type becomes unmaintainable and causes massive merge conflicts.
- **Why it matters:** The user's explicit requirement is "very extendable to fit many unique effects." A closed union is the opposite of that.
- **How to fix:** Convert to an open interface with a string discriminant:
  ```typescript
  export interface EffectPayload {
    effectId: string;  // open string, not closed union
    params?: Record<string, unknown>;  // flexible params bag
  }
  ```
  Then use narrowing in handlers that need specific params. This lets new effects be added purely by registering a handler + adding card data — zero type changes.

**2. `CardType` and `CardSubType` are closed unions — can't add new types**
- **File:** card.types.ts, lines ~13-15
- **What's wrong:** `CardType = 'Creature' | 'Spell' | 'Land'` and `CardSubType = 'Minion' | 'Servant' | 'Equipment'` are hardcoded. Adding "Artifact", "Enchantment", "Planeswalker", or custom subtypes requires editing the core type file.
- **Why it matters:** Card games evolve. New card types are the most common expansion vector. The effect-registry.ts already references `'Artifact'` and `'Enchantment'` in its `isPermanent` check (line 21), which would fail type-checking.
- **How to fix:** Either widen to `string` with runtime validation, or use a const array pattern:
  ```typescript
  export const CARD_TYPES = ['Creature', 'Spell', 'Land', 'Artifact', 'Enchantment'] as const;
  export type CardType = typeof CARD_TYPES[number];
  ```

**3. `TriggeredAbility.triggerCondition` is a plain string — no type safety**
- **File:** card.types.ts, line ~55
- **What's wrong:** `triggerCondition: string` with a comment listing examples. This means typos like `'ON_ENTB'` vs `'ON_ETB'` won't be caught. The engine can't know what triggers are valid.
- **Why it matters:** Triggered abilities are the most complex part of any card game engine. Without typed triggers, the engine can't efficiently poll for trigger conditions — it would need to check every card against every possible trigger string.
- **How to fix:** Define a trigger event enum/union and a trigger event bus:
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
    | 'ON_LIFE_GAIN';
  ```
  Then the engine can dispatch events to a trigger system that matches cards with the right condition.

**4. `CardInstance extends CardBlueprint` causes deep-clone bugs**
- **File:** card-factory.ts, lines ~40-60
- **What's wrong:** `CardInstance extends CardBlueprint` means the instance inherits all blueprint properties directly. The `instantiateCard` function does manual deep cloning of `abilities`, `castRequirements`, and `condition`, but uses `as unknown as CardInstance` to force the type. If a new nested property is added to `CardBlueprint`, it won't be deep-cloned automatically — two instances could share the same reference.
- **Why it matters:** This is a ticking time bomb. If two `CardInstance` objects share a reference to the same `abilities[0].cost` object, mutating one card's cost mutates the other's. This causes impossible-to-debug game state corruption.
- **How to fix:** Don't use inheritance. Use composition:
  ```typescript
  export interface CardInstance {
    readonly uuid: string;
    readonly blueprint: CardBlueprint;  // shared, immutable reference
    state: CardState;
    // Runtime overrides if needed
    modifiedPower?: number;
    modifiedToughness?: number;
  }
  ```
  All rules lookups go through `card.blueprint.power`, and the engine applies modifications from `card.state.counters` or active effects. This eliminates all deep-cloning.

### Important (Should Fix)

**5. `EffectRegistry` handlers mutate room directly — no event sourcing or undo**
- **File:** effect-registry.ts
- **What's wrong:** Every handler mutates `room` in place. There's no way to replay, audit, or undo effects. If a spell is countered on the stack, there's no mechanism to roll back partial resolutions.
- **Why it matters:** Stack-based card games need the ability to counter spells. If `DEAL_DAMAGE` mutates life totals directly and then a later stack item counters it, you can't undo.
- **How to fix:** Handlers should return a delta/patch instead of mutating:
  ```typescript
  export type EffectHandler = (room: GameRoom, stackObj: StackObject) => GameRoom; // returns new room
  ```
  Or use an Immer-style immutable update pattern.

**6. No trigger system exists — `TriggeredAbility` is defined but never evaluated**
- **File:** card.types.ts (defines `TriggeredAbility`), all engine files (never reference it)
- **What's wrong:** The type system defines triggered abilities, but there's zero engine code that checks for triggers when events happen (creature enters battlefield, creature dies, upkeep begins, etc.).
- **Why it matters:** Triggered abilities are half the game. Without a trigger evaluation loop, cards with "When this enters the battlefield..." or "At the beginning of your upkeep..." simply don't work.
- **How to fix:** Add a `TriggerSystem` class that:
  1. Listens to game events (creature ETB, death, phase changes)
  2. Scans all permanents for matching `TriggeredAbility` entries
  3. Pushes triggered effects onto the stack

**7. `ActionCondition.globalFlag` is a closed union with only 2 values**
- **File:** effect.types.ts, line ~35
- **What's wrong:** `'creatureDiedThisTurn' | 'hasDrawnSecondCard'` — only 2 flags. A real card game needs dozens: 'spellCastThisTurn', 'landPlayedThisTurn', 'attackedThisTurn', etc.
- **Why it matters:** Same extensibility problem as `EffectPayload`. Every new condition flag requires a type change.
- **How to fix:** Widen to `string` and maintain a registry of known flags, or use a `Record<string, boolean>` turn-history object on the room.

**8. room-factory.ts has hardcoded RPS card IDs — tight coupling**
- **File:** room-factory.ts, lines ~70-72
- **What's wrong:** `instantiateCard('rock')`, `instantiateCard('paper')`, `instantiateCard('scissors')` are hardcoded. If the card IDs change or the RPS mechanic is replaced, this breaks.
- **Why it matters:** The room factory shouldn't know about specific card IDs. This couples the engine to card data.
- **How to fix:** Pass RPS card IDs as configuration, or define them in a constants file:
  ```typescript
  const RPS_CARD_IDS = ['rock', 'paper', 'scissors'] as const;
  ```

**9. card-parser.ts `normalizeAbility` returns `any`**
- **File:** card-parser.ts, line ~18
- **What's wrong:** `export function normalizeAbility(ability: any): any` — both parameter and return type are `any`. This completely bypasses the type system.
- **Why it matters:** The parser is the bridge between untyped JSON and typed TypeScript. If it returns `any`, all downstream type safety is lost.
- **How to fix:** Return `CardAbility`:
  ```typescript
  export function normalizeAbility(ability: Record<string, unknown>): CardAbility | null
  ```

**10. card-factory.ts Proxy pattern is confusing and error-prone**
- **File:** card-factory.ts, lines ~65-75
- **What's wrong:** `export const cards = new Proxy({}, { ... })` — accessing `cards.rock` calls `instantiateCard('rock')`. This is clever but non-obvious. It also means `cards.rawCardData` and `cards.instantiateCard` are magic strings that return card instances instead of the expected values.
- **Why it matters:** A developer writing `cards.length` or `Object.keys(cards)` gets unexpected behavior. This is a debugging nightmare.
- **How to fix:** Remove the Proxy. Use explicit function calls: `instantiateCard('rock')`. It's one more word and infinitely clearer.

**11. `ActionCost.allowedZones` is duplicated in `ActionRequirements.allowedZones`**
- **File:** effect.types.ts, lines ~12 and ~42
- **What's wrong:** `ActionCost` has `allowedZones?: CardZone[]` and `ActionRequirements` has `allowedZones: CardZone[]`. The cost of an action and where it can be activated from are different concepts. Having `allowedZones` in `ActionCost` is semantically wrong.
- **Why it matters:** Confusion about which `allowedZones` takes precedence. If they differ, which one wins?
- **How to fix:** Remove `allowedZones` from `ActionCost`. Zone eligibility is a requirement, not a cost.

**12. No `GRANT_STATS` handler in effect-registry.ts**
- **File:** effect-registry.ts
- **What's wrong:** `EffectPayload` defines `GRANT_STATS` and card_data.json uses it (Crimson Hellkite), but there's no handler registered for it. The card simply won't work.
- **Why it matters:** Missing handler = silent failure at runtime.
- **How to fix:** Add a `GRANT_STATS` handler that creates a temporary stat modifier on the target.

### Minor (Nice to Have)

**13. `ManaCost` type is defined but never used**
- **File:** card.types.ts, line ~11
- **What's wrong:** `export type ManaCost = Partial<Record<ManaColor, number>>` is exported but nothing imports it. `ActionCost.mana` uses the same inline type.
- **How to fix:** Use `ManaCost` in `ActionCost.mana` for consistency, or remove the unused export.

**14. `CardEffect` type is defined but never used**
- **File:** card.types.ts, lines ~25-30
- **What's wrong:** `CardEffect` is exported but nothing imports or references it. It's dead code.
- **How to fix:** Remove it or integrate it into the ability system.

**15. `GameStateMachineConfig` is defined but never used**
- **File:** game.state.types.ts, lines ~14-18
- **What's wrong:** The interface exists but no code instantiates it.
- **How to fix:** Either implement the state machine that uses it, or remove it until needed.

**16. room-factory.ts class name should be PascalCase**
- **File:** room-factory.ts, line ~7
- **What's wrong:** `export class roomFactory` — class names should be PascalCase: `RoomFactory`.
- **How to fix:** Rename to `RoomFactory`.

**17. card-parser.ts default export pattern inconsistent with card-factory.ts**
- **File:** card-parser.ts, last lines
- **What's wrong:** card-parser.ts uses `export default { ... }` while card-factory.ts uses named exports. Inconsistent module pattern.
- **How to fix:** Pick one pattern. Prefer named exports for tree-shaking and clarity.

**18. card_data.json uses `"onPlay"` but `CardBlueprint` expects `onPlayEffect`**
- **File:** card_data.json (e.g., line 8: `"onPlay": { "effectId": "DISCARD_HAND", ... }`) vs card.types.ts (`onPlayEffect?: EffectPayload`)
- **What's wrong:** The JSON key is `onPlay` but the parser reads `raw.onPlayEffect`. The RPS cards' on-play effects will never be parsed.
- **How to fix:** Either rename the JSON keys to `onPlayEffect` or update the parser to read `raw.onPlay || raw.onPlayEffect`.

---

## Summary Assessment

The type hierarchy is well-conceived and the separation of blueprint/instance/state is architecturally sound. However, the code has **critical extensibility problems**: closed unions on `EffectPayload`, `CardType`, `CardSubType`, and `globalFlag` will make adding new cards a constant battle against the type system. The `CardInstance extends CardBlueprint` inheritance pattern is a latent shared-mutation bug.

**Top 4 priorities before proceeding:**
1. Open up `EffectPayload` to a flexible interface (Critical #1)
2. Fix `CardInstance` to use composition instead of inheritance (Critical #4)
3. Add a trigger event system (Critical #3, Important #6)
4. Fix the `onPlay`/`onPlayEffect` JSON mismatch (Minor #18 — but it means RPS cards don't work)