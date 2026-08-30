# Continuous Effects & Modifier System — Design Document

**Date:** 2026-08-30
**Status:** Draft — Awaiting Review
**Context:** The reducer-based engine, socket protocol, React frontend, and RPS phase are merged (172 tests, `tsc` clean). Card power/toughness is immutable — it lives on `CardBlueprint` (`readonly power?: number`). There is no way to represent temporary stat changes, auras, or continuous effects. `MODIFY_STATS` silently ignores power/toughness (only damage works), and `GRANT_STATS` has no handler at all.

**Real consumers (ST01A 六界降臨：炎, 24 cards):** Two cards directly need this system:
- **諸界六皇 血怒之馬甸尼** (Legendary): ETB grants self +3/+3, and a continuous anthem "all 幽爾 servants get +3 attack."
- **Crimson Hellkite** (existing card): `{R}: +1/+0 until end of turn`.

This design establishes the **continuous-effect backbone** — the general, future-proof model for "what are this card's characteristics right now" — and documents the three sibling effect axes that will be built on top of it later.

**Priority note:** Based on the 24-card analysis, the modifier system is **P3** in the build order. Scorch counters (9 cards) and attack triggers (6 cards) unlock more cards first. See §12 for the full prioritized build order.

---

## 1. Overview

### 1.1 The four-axis effect model

All card-game effects fall into exactly four categories, distinguished by **when they are evaluated** relative to an event:

```
Event occurs
   │
   ├─ 1. Replacement effects   → rewrite the event before it happens   [DEFERRED]
   ├─ 2. Triggered effects     → push a new StackObject onto the stack  [PARTIAL: ETB only]
   ├─ 3. Permission checks     → gate whether an action is legal        [STUB]
   │
   └─ 4. Continuous effects    → modify a card's characteristics        [BUILD NOW]
```

| Axis | Question it answers | Evaluation point | Current status |
|------|--------------------|------------------|----------------|
| **1. Replacement** | "What *happens* when an event occurs?" | On event dispatch, before resolution | Stub (`ModifierPipeline`) |
| **2. Triggered** | "What *should* happen because an event occurred?" | On event dispatch, after resolution | Partial (`TriggerManager`, ETB only) |
| **3. Permission** | "Is this action *legal*?" | At validation time | Stub (`ModifierRegistry`) |
| **4. Continuous** | "What *are* this card's characteristics?" | On read (P/T, keywords, types) | **This design** |

These are **four separate seams**, not a progression. A complete engine needs all four, and they do not overlap:

- You cannot express "+1/+0 until end of turn" as a replacement effect.
- You cannot express "draw twice instead of once" as a modifier list.
- You cannot express "can't be countered" as a triggered ability.

### 1.2 What this design builds

This design specifies **axis 4 (continuous effects)** in full — the typed modifier model, the effective-stat resolver, the mutation types, the `GRANT_STATS` handler, and the cleanup timing. It also documents axes 1–3 as "designed but deferred" so the continuous-effect model does not paint us into a corner.

### 1.3 Design principles

1. **Build for actual cards, design for general use.** Functions (handlers, resolver logic, anthem scanning) are built only when a card needs them. Types are minimal but correct, so new cards don't force type changes. The rule: a type variant is added now only if it changes how existing variants resolve; otherwise it is added when the card arrives.
2. **Intrinsic state ≠ continuous effects.** Tap, damage, summoning sickness, zone, and counters are *intrinsic* state and stay as direct `CardState` fields. Only *continuous effects* go in the modifier list. Mixing them is the "parsing cost" trap — a single generic list that must be scanned on every read.
3. **Server-authoritative.** The client receives computed effective stats, not raw modifier internals.
4. **Pure reducer.** All changes flow through `GameMutation[]` → `gameReducer`. No direct mutation.
5. **Future-proof ordering.** Every modifier carries a `timestamp` — the seed of MTG's layer system — so `SET_STATS` and `STAT_DELTA` can coexist without a redesign.

---

## 2. The Modifier Model (typed)

### 2.1 `ContinuousEffect` — a closed, discriminated union

The effect itself is a **closed union** (not optional fields) so invalid combinations are unrepresentable:

```typescript
// src/types/card.types.ts

export type ContinuousEffect =
  | { type: 'STAT_DELTA'; power?: number; toughness?: number }   // +1/+0
  | { type: 'SET_STATS'; power: number; toughness: number };     // "becomes 3/3"
```

> **Note:** Only `STAT_DELTA` has a handler in this phase. `SET_STATS` is declared in the type now because it changes the resolver's ordering logic (it must apply before `STAT_DELTA` — see §7.4), but it has no handler until a "becomes 3/3" card exists. Other effect kinds (`GRANT_KEYWORD`, `GRANT_ABILITY`, `CHANGE_TYPE`, `CHANGE_CONTROL`) are deliberately **omitted** — they are purely additive and will be added to the union when a card needs them, at zero retrofit cost.

### 2.2 `ContinuousModifier` — the wrapper

```typescript
export interface ContinuousModifier {
  id: string;                    // unique, for removal
  source: string;                // cardUuid of source | 'emblem' | 'global'
  effect: ContinuousEffect;
  duration: 'END_OF_TURN' | 'WHILE_ATTACHED' | 'WHILE_ON_BATTLEFIELD' | 'PERMANENT';
  timestamp: number;             // layer ordering — later applies on top
}
```

> **Why no `scope`/`filter`:** A modifier is always stored on a specific card's `CardState.modifiers`, so every modifier is "single" from storage's perspective. The "all" case (anthem) is about the *handler's* behavior — scanning the battlefield and emitting N mutations — not about the modifier's shape. Anthem targeting is already expressible in the effect's `TargetingDefinition`. Cleanup matches by `source`, not by `scope`. So `scope`/`filter` would be redundant fields that conflate handler behavior with modifier shape.

### 2.3 `CardState` gains one field

```typescript
export interface CardState {
    zone: CardZone;
    ownerId: string;
    controllerId: string;
    isTapped: boolean;
    damageTaken: number;
    summoningSickness: boolean;
    counters: Record<string, number>;   // +1/+1, -1/-1, charge, etc. (intrinsic)
    modifiers: ContinuousModifier[];    // NEW — continuous effects only
    attachedTo?: string | null;         // DEFERRED — cardUuid of host (for auras)
}
```

> `attachedTo` is declared but **not used** in this phase — see §8 (Auras).

### 2.4 Why this avoids the parsing cost

| Data | Where it lives | Access cost |
|------|---------------|-------------|
| Tap / damage / sickness / zone | Direct `CardState` fields | O(1) |
| Counters | `counters: Record<string, number>` | O(1) by type |
| Modifiers | `modifiers: ContinuousModifier[]` | O(n), n is tiny (0–2 in practice) |

Effective stats are **computed on demand**, never stored. The modifier list is only scanned when a stat is actually read (attack, damage resolution, display) — not on every mutation.

---

## 3. Effective Stat Resolution

A single pure module, used everywhere stats are read:

```typescript
// src/engine/stat-resolver.ts (new)

export function getEffectivePower(card: CardInstance): number {
    const base = card.blueprint.power ?? 0;
    const fromModifiers = card.state.modifiers
        .filter(m => m.effect.type === 'STAT_DELTA')
        .reduce((sum, m) => sum + (m.effect.power ?? 0), 0);
    const fromCounters = card.state.counters['+1/+1'] ?? 0;
    return base + fromModifiers + fromCounters;
}

export function getEffectiveToughness(card: CardInstance): number {
    // same pattern
}
```

> **Keyword granting** (`GRANT_KEYWORD`) is deferred — no card needs it yet. When it lands, a `hasKeyword()` helper will be added here.

> **Ordering note:** `SET_STATS` (when implemented) must be applied *before* `STAT_DELTA`, ordered by `timestamp`. The current `getEffectivePower` only handles `STAT_DELTA`; the full layer ordering is documented in §7.2 and deferred.

### 3.1 Read paths that must switch to these helpers

| File | Current | Change to |
|------|---------|-----------|
| `src/engine/handlers/attack-handler.ts:73` | `card.blueprint.power ?? 0` | `getEffectivePower(card)` |
| `src/engine/effect-resolver.ts:104-106` | `blueprint.power` (dynamic params) | `getEffectivePower(card)` |
| `src/client/components/CardComponent.tsx:40-42` | `card.blueprint.power` | effective P/T from server |
| `src/engine/effect-registry.ts` `MODIFY_STATS` | ignores P/T | apply via modifiers |

---

## 4. Mutation Types

```typescript
// src/types/game-mutation.types.ts — add:

| { type: 'ADD_MODIFIER'; cardUuid: string; modifier: ContinuousModifier }
| { type: 'REMOVE_MODIFIER'; cardUuid: string; modifierId: string }
| { type: 'CLEAR_END_OF_TURN_MODIFIERS' }   // fired at cleanupStep
```

The reducer handles these with the existing `updateCardOnBattlefield` helper — no new zone logic needed.

---

## 5. The `GRANT_STATS` Handler

```typescript
// src/engine/effect-registry.ts — add:

'GRANT_STATS': (room, _stackObj, effect) => {
    const params = effect.params as { power?: number; toughness?: number };
    const mutations: GameMutation[] = [];
    for (const target of effect.targets) {
        if (!target.cardUuid) continue;
        if (params.power) {
            mutations.push({
                type: 'ADD_MODIFIER',
                cardUuid: target.cardUuid,
                modifier: {
                    id: `${target.cardUuid}-power-${/* injected uuid */}`,
                    source: 'self',
                    effect: { type: 'STAT_DELTA', power: params.power },
                    duration: 'END_OF_TURN',
                    timestamp: Date.now(),
                },
            });
        }
        // same for toughness
    }
    return mutations;
}
```

> **UUID injection:** modifier `id` generation must be injected at the engine boundary (like `StackObject` UUIDs) to keep the handler pure. See §9.

---

## 6. Cleanup Timing

The `cleanupStep` phase already exists (`stateEndPhase → cleanupStep → stateTurnStart`). Wire cleanup there:

```typescript
// src/engine/state-machine.ts — in transition(), when `to === 'cleanupStep'`:
mutations.push({ type: 'CLEAR_END_OF_TURN_MODIFIERS' });
```

The reducer's `CLEAR_END_OF_TURN_MODIFIERS` case strips all `duration === 'END_OF_TURN'` modifiers from every battlefield card. This is the **single place** "until end of turn" is enforced.

---

## 7. Deferred Axes (designed, not built)

### 7.1 Axis 1 — Replacement effects (`ModifierPipeline` stub)

```typescript
type ReplacementEffect = (event: GameEvent, room: GameRoom) => GameEvent | GameEvent[] | null;
```

**Why deferred:** Requires a canonical event vocabulary *before* it can be built. Building it now, with zero consumers, means guessing at the event model — and guessing wrong is more expensive than waiting. The `EventBus` is its natural home, so the seam already exists.

**When to build:** First card that needs "draw 2 instead of 1", "prevent all damage", "spells cost 1 less", "can't be countered", or target redirection.

**Hard problems to solve when built:**
1. Ordering — when two replacements apply to one event, which wins? (MTG: affected player chooses, with self-replacement prevention.)
2. Self-replacement prevention — a replacement must not apply to its own output (infinite loop guard).
3. The "would happen" event model.

### 7.2 Axis 2 — Triggered effects (`TriggerManager`, ETB only)

Currently only `PERMANENT_ENTERED` is wired. Missing:

| Event | Trigger | Example |
|-------|---------|---------|
| `PERMANENT_LEFT` | death triggers | "When this dies, draw a card" |
| `TURN_STARTED` | upkeep triggers | "At the beginning of your upkeep…" |
| `PHASE_CHANGED` | combat triggers | "At the beginning of combat…" |
| `LIFE_CHANGED` | life-gain triggers | "Whenever you gain life…" |

**When to build:** First card with a non-ETB trigger.

### 7.2.1 Design decision — how TriggerManager finds trigger-holders (DEFERRED — not settled)

**Problem:** The current `onTrigger` helper assumes every event carries a single source `card` in its payload, and scans *that card's* abilities for matching triggers:

```typescript
const onTrigger = (eventId, triggerEvent) => {
  eventBus.on(eventId, (event) => {
    const card = event.payload.card;   // ← assumes a single source card
    if (!card) return;                  // ← silently kills global events
    const effects = getMatchingTriggers(card, triggerEvent, controllerId);
    ...
  });
};
```

This is **correct only for source-card events** (`PERMANENT_ENTERED`, `PERMANENT_LEFT`, `ATTACK_DECLARED`) where the card that caused the event is also the trigger-holder. It is **broken for global events** (`LIFE_CHANGED`, `TURN_STARTED`), whose payloads carry no card (`{ playerId, newLife }` / `{ currentPlayer }`). A card like *"when you heal, gain +1/+1"* would never fire because there is no `payload.card` to scan.

**Decision — hybrid scan (no registration lifecycle):**

1. **Source-card events** (`PERMANENT_ENTERED`, `PERMANENT_LEFT`, `ATTACK_DECLARED`): scan the event's source card's own abilities. The source card *is* the trigger-holder. No room scan needed.
2. **Global events** (`LIFE_CHANGED`, `TURN_STARTED`): scan `room.battlefield` for all permanents whose `abilities` contain a `triggered` ability matching the event. Each matching permanent produces its own triggered `StackObject`.

**Why not dynamic registration?** (permanents register/unregister with the manager on enter/leave) — considered and rejected as over-engineering for a 2-player game:
- Registration lifecycle bugs (unregister on leave, re-register on re-enter, zone changes, destruction mid-resolution) are subtle and numerous.
- Global events still need context regardless — registration solves "which cards care" but not "what data they get." The event payload must carry context either way.
- The trigger-holder is usually discoverable from the event itself; only global events need a scan, and that scan is small and well-defined.

**Implementation cost:** `TriggerManager` needs access to the room (or a getter) to scan the battlefield for the global-event case. Currently it only receives `(eventBus, collector, generateUuid)` — pass the room in.

**Status: DEFERRED — design NOT settled.** The hybrid-scan approach above is a *candidate*, not a decision. The user has not settled on how trigger-holders are discovered. Do not implement until the design is agreed. The current code still uses the single-card assumption and silently skips global events (guard: `if (!card) return;`).

### 7.2.2 Design decision — per-turn aggregate flags (DEFERRED)

**Problem:** Cards like *"deal damage equal to the amount you healed this turn"* need to track a running total across the turn. Where does this state live?

**Two candidate homes:**
- **On the card** (`CardState`): e.g. `state.turnCounters = { healed: 3 }`. Good for card-scoped tracking ("this card dealt damage this turn"), wrong for global aggregates ("total damage dealt this turn" across all sources).
- **On the room** (`GameRoom`): a `turnHistory` / `turnCounters` record. Good for global aggregates. Matches the existing recommendation in `notes/review.md` #7 ("maintain a `Record<string, boolean>` turn-history object on the room").

**Recommendation (not yet decided):** Both, for different things — card-scoped counters on `CardState`, global turn aggregates on `GameRoom`. Cleared during the untap step (`stateTurnStart`), mirroring how `attackedThisTurn` is cleared today.

**Status:** Deferred. Needs a dedicated design pass before implementation. Do not rush into this task.

### 7.3 Axis 3 — Permission checks (`ModifierRegistry` stub)

```typescript
canPlay(room, playerId, card): boolean    // "can't cast creatures"
canTarget(room, playerId, card, targets): boolean  // hexproof, shroud, protection
```

**Why cheap to build:** These are predicates consulted at validation time. The seam already exists (`ActionValidator`).

**When to build:** First card with hexproof, shroud, protection, or a "can't" restriction. Likely soon.

### 7.4 Layer ordering (for `SET_STATS` + `STAT_DELTA` coexistence)

When `SET_STATS` is implemented, the resolver must apply effects in layer order:

```
1. SET_STATS (base overwrite)     — ordered by timestamp
2. STAT_DELTA (additive)          — ordered by timestamp
3. Counters (+1/+1)               — always last
```

The `timestamp` field is the seed of this. Today only `STAT_DELTA` exists, so ordering is trivial.

---

## 8. Auras (deferred, but modeled)

**Where stored:** An aura is a normal `CardInstance` on the battlefield with `state.attachedTo = hostUuid`.

**How applied:** The aura's `onEnterEffects` resolves to an `ADD_MODIFIER` mutation on the **host** card, with `source: aura.uuid` and `duration: 'WHILE_ATTACHED'`.

**When applied:** At aura ETB resolution — same pipeline as any other effect. The modifier lives on the *host's* `CardState.modifiers`, not on the aura.

**When removed:** Two triggers must remove the modifier:
1. Aura leaves battlefield → `REMOVE_MODIFIER` on host (match `source === aura.uuid`).
2. Host leaves battlefield → aura falls off (goes to graveyard); its modifier is irrelevant since the host is gone.

**Why clean:** The host never needs to know *why* it has +1/+1 — it just has a modifier with a `source`. When the source leaves, the modifier is removed by matching `source`.

**Anthems** ("all creatures you control get +1/+0") are the same mechanism — the handler scans the battlefield for matching cards (using the effect's `TargetingDefinition`) and applies `ADD_MODIFIER` to each, all sharing the same `source`. This requires either a new `targetType: 'all_permanents'` or the handler itself scanning. Deferred until an anthem card exists.

---

## 9. UUID Injection

Modifier `id` generation must be injected at the engine boundary, mirroring the existing `StackObject` UUID pattern:

```typescript
// GameEngine already has generateUuid(). Pass it into the effect resolver
// or generate modifier ids in the handler via an injected callback.
```

The `EffectRegistry` handlers are currently pure functions `(room, stackObj, effect) => GameMutation[]`. Adding modifier-id generation requires either:
- (a) A module-level counter (breaks purity, non-deterministic), or
- (b) Injecting a `generateUuid` callback into the handler signature (breaking change to all handlers), or
- (c) Deriving the modifier id deterministically from `cardUuid + effectId + timestamp` (pure, but collision-prone if the same effect applies twice in one tick).

**Recommendation:** (c) for now — derive `id = ${cardUuid}:${effectId}:${timestamp}`. Revisit if collisions become real.

---

## 10. Running Example (trace)

**Board:** PlayerA has a 1/1 "Servant" and an anthem "All creatures you control get +1/+0". PlayerB has a 1/1 "Guard".

**Sequence:** PlayerA casts "Giant Growth" (+2/+2 until end of turn) on Servant → Servant attacks Guard → end of turn.

### Step 1 — Cast Giant Growth

```
playerAction('cast_spell', { cardUuid: 'giant-growth', targetUuid: 'servant' })
  → playCardHandler.propose() builds StackObject:
      effects: [{ action: 'GRANT_STATS', params: { power: 2, toughness: 2 },
                  targets: [{ targetType: 'permanent', cardUuid: 'servant' }] }]
  → PUSH_STACK → priority passes to opponent
```

### Step 2 — Resolve

```
resolveStackObject()
  → applyStructuralZoneChange(): non-permanent → graveyard
  → resolveEffects():
      revalidateTargets(): servant still on battlefield ✓
      ModifierPipeline.apply(): STUB (identity)
      EffectRegistry['GRANT_STATS']:  ← NEW
        → ADD_MODIFIER on servant: { effect: STAT_DELTA(+2/+2), duration: END_OF_TURN, timestamp: 2 }
```

### Step 3 — Effective stats

```
getEffectivePower(servant):
  base = 1
  modifiers = [
    { source: 'anthem', effect: STAT_DELTA(+1/+0), duration: WHILE_ON_BATTLEFIELD, timestamp: 1 },
    { source: 'giant-growth', effect: STAT_DELTA(+2/+2), duration: END_OF_TURN, timestamp: 2 },
  ]
  power = 1 + 1 + 2 = 4 ✓
  toughness = 1 + 0 + 2 = 3 ✓
```

### Step 4 — Attack

```
attackHandler.propose():
  power = getEffectivePower(servant) = 4   ← was blueprint.power = 1 (WRONG)
  effects: [{ action: 'MODIFY_STATS', params: { damage: 4 }, targets: [guard] }]
```

### Step 5 — Combat damage

```
MODIFY_STATS: SET_DAMAGE on guard = 4 → guard (1 toughness) dies [state-based action, DEFERRED]
MODIFY_STATS: SET_DAMAGE on servant = 1 → servant (3 toughness) survives
```

### Step 6 — End of turn

```
transition('cleanupStep') → CLEAR_END_OF_TURN_MODIFIERS
  → servant.modifiers = [ anthem only ]   // Giant Growth removed
  → getEffectivePower(servant) = 1 + 1 = 2 ✓
```

---

## 11. Gap & Stub Inventory

| # | Gap / Stub | Where | Status |
|---|-----------|-------|--------|
| 1 | `GRANT_STATS` handler missing | `effect-registry.ts` | 🔴 Build now |
| 2 | No `CardState.modifiers` field | `card.types.ts` | 🔴 Build now |
| 3 | No `ADD_MODIFIER`/`REMOVE_MODIFIER`/`CLEAR_END_OF_TURN_MODIFIERS` mutations | `game-mutation.types.ts`, `game-reducer.ts` | 🔴 Build now |
| 4 | No `stat-resolver.ts` | new file | 🔴 Build now |
| 5 | `attack-handler.ts` reads `blueprint.power` | `attack-handler.ts:73` | 🟡 After 1–4 |
| 6 | `CardComponent.tsx` displays `blueprint.power` | `CardComponent.tsx:40` | 🟡 After 1–4 |
| 7 | `effect-resolver.ts` dynamic params read `blueprint.power` | `effect-resolver.ts:104` | 🟡 After 1–4 |
| 8 | No cleanup wiring for `CLEAR_END_OF_TURN_MODIFIERS` | `state-machine.ts` | 🟡 After 1–4 |
| 9 | `ModifierPipeline.apply()` is identity stub | `modifier-pipeline.ts` | ⏸️ Deferred (Axis 1) |
| 10 | `ModifierRegistry.canPlay/canTarget` always true | `modifier-registry.ts` | ⏸️ Deferred (Axis 3) |
| 11 | `TriggerManager` only handles `PERMANENT_ENTERED` | `trigger-manager.ts` | ⏸️ Deferred (Axis 2) |
| 12 | `MODIFY_STATS` ignores P/T (only damage) | `effect-registry.ts` | 🟡 After 1–4 |
| 13 | No state-based actions (creature death from damage) | new system | ⏸️ Deferred |
| 14 | Combat targets player, not creature | `attack-handler.ts` | ⏸️ Deferred |
| 15 | Anthem (multi-target) resolution | `effect-registry.ts` | ⏸️ Deferred |
| 16 | `attachedTo` field unused | `card.types.ts` | ⏸️ Deferred (Auras) |

---

## 12. Prioritized Build Order (validated against ST01A, 24 cards)

Based on the mechanic inventory in §12.1, the modifier system is **P3** — not P0. Scorch and attack triggers unlock more cards first.

| Priority | Mechanic | Unlocks | Difficulty | Depends on |
|----------|----------|---------|------------|------------|
| 🔴 P0 | **灼熱 (Scorch) counter system** | 9 cards | High — new system | Counters (exists) |
| 🔴 P1 | **Attack triggers** | 6 cards | Medium — extend TriggerManager | TriggerManager |
| 🔴 P2 | **Destroy target** | 5 cards | Low — new effect handler | EffectRegistry |
| 🔴 P3 | **Stat boost / anthem** (this spec) | 2 cards | Medium | Modifier system |
| 🟡 P4 | **Deck search/reveal** | 2 cards | Medium | Deck manipulation |
| 🟡 P5 | **AOE damage** | 1 card | Low | Multi-target |
| 🟡 P6 | **Equipment** | 1 card | High — new system | `attachedTo` |
| 🟡 P7 | **Chain prevention** | 3 cards | Medium — replacement effect | Axis 1 |
| 🟡 P8 | **Discard-as-cost** | 3 cards | Low — extend ActionCost | ActionCost |
| 🟡 P9 | **Conditional cast from reveal** | 2 cards | Medium — replacement effect | Axis 1 |
| 🟡 P10 | **Once per turn** | 1 card | Low — flag on card | CardState |

### 12.1 Full mechanic inventory (ST01A, 24 cards)

| # | Mechanic | Cards using it | Engine status |
|---|----------|---------------|---------------|
| 1 | **灼熱 (Scorch)** — place counters on opponent's cards; when counters ≥ card's "ability total", destroy it | 9 cards | 🔴 New system |
| 2 | **ETB triggers** (召喚時) | 6 cards | ✅ Exists |
| 3 | **Attack triggers** (攻擊時) | 6 cards | 🔴 Missing |
| 4 | **Death triggers** (破壞時) | 1 card | 🔴 Missing |
| 5 | **Mana production** (橫置：生產) | 2 cards | ✅ Exists |
| 6 | **Deck search/reveal** (公開/加入手牌) | 2 cards | 🔴 Missing |
| 7 | **Conditional draw** (條件抽牌) | 4 cards | 🟡 Partial |
| 8 | **Direct damage to player** (對玩家造成傷害) | 2 cards | ✅ Exists |
| 9 | **Targeted damage to creature** (對僕從造成傷害) | 3 cards | 🟡 Partial |
| 10 | **Destroy target** (破壞) | 5 cards | 🔴 Missing |
| 11 | **Stat boost** (+X/+X) | 2 cards | 🔴 This spec |
| 12 | **Equipment** (裝備) | 1 card | 🔴 Missing |
| 13 | **Chain prevention** (不能觸發Chain) | 3 cards | 🔴 Missing |
| 14 | **Discard from hand as cost** (棄置此卡) | 3 cards | 🔴 Missing |
| 15 | **AOE damage** (全部僕從造成傷害) | 1 card | 🔴 Missing |
| 16 | **Conditional cast from reveal** (公開時加入手牌) | 2 cards | 🔴 Missing |
| 17 | **Once per turn** (效果回合一次) | 1 card | 🔴 Missing |
| 18 | **Anthem** (我方僕從攻擊力+3) | 1 card | 🔴 This spec |

### 12.2 Card type breakdown

| Type | Count | Engine mapping |
|------|-------|---------------|
| 僕從 (Servant/Creature) | 15 | `Creature` |
| 魔法 (Spell) | 4 | `Spell` |
| 遺跡 (Relic/Artifact) | 3 | `Artifact` |
| 地界 (Land) | 1 | `Land` |
| 裝備 (Equipment) | 1 | New type needed |

### 12.3 New card schema fields needed

The current `card_data.json` schema is missing fields these cards need:

| Field | Example | Used by |
|-------|---------|---------|
| `element` | `"fire"` | All 24 cards |
| `race` | `"fire-beast"`, `"yuer"`, `"fire-soldier"` | All 24 cards |
| `rarity` | `"common"`, `"rare"`, `"epic"`, `"legendary"`, `"basic"` | All 24 cards |
| `set` | `"ST01A"` | All 24 cards |
| `mechanics` | `["scorch", "etb"]` | All 24 cards (metadata, not engine) |
| `keywords` | `"Flying"` (from Crimson Hellkite) | Some cards |

> **Note:** `element`, `race`, `rarity`, and `set` are metadata — they don't affect engine logic but are needed for deck building, filtering, and display. `mechanics` is a human-readable tag for analysis. Only `keywords` affects engine behavior (via `hasKeyword()`).

---

## 13. Phased Rollout

**Phase 1 (this design):** `ContinuousEffect` + `ContinuousModifier` types, `modifiers` on `CardState`, `stat-resolver.ts`, `GRANT_STATS` handler, three new mutations, cleanup wiring, switch read paths to effective stats.

**Phase 2 (when auras/equipment exist):** `attachedTo` field, `ATTACH` effect, `WHILE_ATTACHED` cleanup on leave, anthem (multi-target) resolution.

**Phase 3 (when cards need them):** `ModifierPipeline` (replacement effects), `ModifierRegistry` (permission checks), non-ETB triggers, state-based actions, creature-vs-creature combat.

---

## 14. Out of Scope

- Full layer system (MTG layers 1–7) — only `timestamp` ordering is seeded.
- State-based actions (creature death, legend rule, etc.).
- Creature-vs-creature combat (current combat is player-targeting).
- Anthem/aura resolution (multi-target, `attachedTo`).
- Replacement effects and permission checks (axes 1 and 3).
- Non-ETB triggers (axis 2).
- Scorch counter system (P0 — separate design needed).
- Attack triggers (P1 — separate design needed).