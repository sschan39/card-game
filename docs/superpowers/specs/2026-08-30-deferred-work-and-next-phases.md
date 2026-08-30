# Deferred Work & Next Phases — Consolidated Spec

**Date:** 2026-08-30
**Status:** Draft — Awaiting Review
**Context:** This spec consolidates all deferred and undone work pulled from two documents:
- `2026-08-30-continuous-effects-and-modifiers-design.md` — the continuous-effect/modifier design (P3). Its core (axes 1–3, auras, layer ordering, phased rollout) was designed but not built.
- `2026-08-30-foundational-triggers-and-attack-destroy.md` — the trigger/attack/destroy implementation plan. Tasks 1–6 are **done and committed**; Task 7 (integration test) is **deferred** because the actual attackable card is not implemented yet (only the RPS phase is tested).

The purpose of this spec is to keep a single, authoritative home for everything that is **designed but not yet built**, so future work can pick up from a clear list rather than re-reading two documents.

---

## 1. What Is Done (for reference)

The following are **implemented and committed** on `feat/trigger-and-modifier-systems`:

| Work | Commit(s) | Status |
|------|-----------|--------|
| PERMANENT_LEFT emission | `5913042` | ✅ Done |
| LIFE_CHANGED emission | `5871758` | ✅ Done |
| TURN_STARTED emission | `659b577` | ✅ Done |
| TriggerManager generalization (source-card events) | `84df591` | ✅ Done |
| ATTACK_DECLARED emission | `30d9244` | ✅ Done |
| DESTROY effect handler | `c63497a` | ✅ Done |
| ON_ATTACK trigger event + test | `fc2517e` | ✅ Done |
| Task 7 integration test | — | ⏸️ Deferred (see §2) |

---

## 2. Deferred from the Trigger/Attack/Destroy Plan

### 2.1 Task 7 — Integration test (attack → trigger → destroy flow)

**Status:** DEFERRED — blocked on the attackable card not being implemented.

**Why deferred:** The actual attackable card is not implemented yet — only the RPS phase is tested. The `full turn play loop` test in `game-engine.test.ts` fails because the attack flow depends on a real attackable creature card that doesn't exist yet.

**When to build:** Once the attackable card and full attack flow are implemented.

**Test to add** (in `tests/engine/game-engine.test.ts`):

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

  // Propose attack
  const result = engine.proposeAndStack('player1', 'attack', {
    cardUuid: creature.uuid,
    stackUuid: engine.generateUuid(),
  });

  expect(result.success).toBe(true);

  // The attack trigger should have pushed a DRAW onto the stack.
  // Stack should have 2 items: the attack StackObject + the triggered DRAW StackObject
  expect(engine.roomState.stack.length).toBe(2);
  // The triggered DRAW should be on top (last pushed)
  expect(engine.roomState.stack[1].type).toBe('triggered');
  expect(engine.roomState.stack[1].effects[0].action).toBe('DRAW');
});
```

---

## 3. Deferred from the Continuous-Effects/Modifier Design

The modifier design (`2026-08-30-continuous-effects-and-modifiers-design.md`) specified **axis 4 (continuous effects)** in full but deferred axes 1–3, auras, and several mechanics. Those deferred pieces are consolidated here.

### 3.1 Axis 1 — Replacement effects (`ModifierPipeline` stub)

```typescript
type ReplacementEffect = (event: GameEvent, room: GameRoom) => GameEvent | GameEvent[] | null;
```

**Why deferred:** Requires a canonical event vocabulary *before* it can be built. Building it now, with zero consumers, means guessing at the event model — and guessing wrong is more expensive than waiting. The `EventBus` is its natural home, so the seam already exists.

**When to build:** First card that needs "draw 2 instead of 1", "prevent all damage", "spells cost 1 less", "can't be countered", or target redirection.

**Hard problems to solve when built:**
1. Ordering — when two replacements apply to one event, which wins? (MTG: affected player chooses, with self-replacement prevention.)
2. Self-replacement prevention — a replacement must not apply to its own output (infinite loop guard).
3. The "would happen" event model.

### 3.2 Axis 2 — Triggered effects: trigger-holder discovery (NOT SETTLED)

**Status:** DEFERRED — design NOT settled. The user has not decided how `TriggerManager` finds trigger-holders for global events.

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

**Candidate — hybrid scan (no registration lifecycle):**

1. **Source-card events** (`PERMANENT_ENTERED`, `PERMANENT_LEFT`, `ATTACK_DECLARED`): scan the event's source card's own abilities. The source card *is* the trigger-holder. No room scan needed.
2. **Global events** (`LIFE_CHANGED`, `TURN_STARTED`): scan `room.battlefield` for all permanents whose `abilities` contain a `triggered` ability matching the event. Each matching permanent produces its own triggered `StackObject`.

**Why not dynamic registration?** (permanents register/unregister with the manager on enter/leave) — considered and rejected as over-engineering for a 2-player game:
- Registration lifecycle bugs (unregister on leave, re-register on re-enter, zone changes, destruction mid-resolution) are subtle and numerous.
- Global events still need context regardless — registration solves "which cards care" but not "what data they get." The event payload must carry context either way.
- The trigger-holder is usually discoverable from the event itself; only global events need a scan, and that scan is small and well-defined.

**Implementation cost:** `TriggerManager` needs access to the room (or a getter) to scan the battlefield for the global-event case. Currently it only receives `(eventBus, collector, generateUuid)` — pass the room in.

**Do not implement until the design is agreed.** The current code still uses the single-card assumption and silently skips global events (guard: `if (!card) return;`).

### 3.3 Axis 2 — Per-turn aggregate flags (DEFERRED)

**Problem:** Cards like *"deal damage equal to the amount you healed this turn"* need to track a running total across the turn. Where does this state live?

**Two candidate homes:**
- **On the card** (`CardState`): e.g. `state.turnCounters = { healed: 3 }`. Good for card-scoped tracking ("this card dealt damage this turn"), wrong for global aggregates ("total damage dealt this turn" across all sources).
- **On the room** (`GameRoom`): a `turnHistory` / `turnCounters` record. Good for global aggregates. Matches the existing recommendation in `notes/review.md` #7 ("maintain a `Record<string, boolean>` turn-history object on the room").

**Recommendation (not yet decided):** Both, for different things — card-scoped counters on `CardState`, global turn aggregates on `GameRoom`. Cleared during the untap step (`stateTurnStart`), mirroring how `attackedThisTurn` is cleared today.

**Status:** Deferred. Needs a dedicated design pass before implementation. Do not rush into this task.

### 3.4 Axis 3 — Permission checks (`ModifierRegistry` stub)

```typescript
canPlay(room, playerId, card): boolean    // "can't cast creatures"
canTarget(room, playerId, card, targets): boolean  // hexproof, shroud, protection
```

**Why cheap to build:** These are predicates consulted at validation time. The seam already exists (`ActionValidator`).

**When to build:** First card with hexproof, shroud, protection, or a "can't" restriction. Likely soon.

### 3.5 Auras & Equipment (deferred, but modeled)

**Where stored:** An aura is a normal `CardInstance` on the battlefield with `state.attachedTo = hostUuid`.

**How applied:** The aura's `onEnterEffects` resolves to an `ADD_MODIFIER` mutation on the **host** card, with `source: aura.uuid` and `duration: 'WHILE_ATTACHED'`.

**When applied:** At aura ETB resolution — same pipeline as any other effect. The modifier lives on the *host's* `CardState.modifiers`, not on the aura.

**When removed:** Two triggers must remove the modifier:
1. Aura leaves battlefield → `REMOVE_MODIFIER` on host (match `source === aura.uuid`).
2. Host leaves battlefield → aura falls off (goes to graveyard); its modifier is irrelevant since the host is gone.

**Why clean:** The host never needs to know *why* it has +1/+1 — it just has a modifier with a `source`. When the source leaves, the modifier is removed by matching `source`.

**Anthems** ("all creatures you control get +1/+0") are the same mechanism — the handler scans the battlefield for matching cards (using the effect's `TargetingDefinition`) and applies `ADD_MODIFIER` to each, all sharing the same `source`. This requires either a new `targetType: 'all_permanents'` or the handler itself scanning. Deferred until an anthem card exists.

### 3.6 Layer ordering (for `SET_STATS` + `STAT_DELTA` coexistence)

When `SET_STATS` is implemented, the resolver must apply effects in layer order:

```
1. SET_STATS (base overwrite)     — ordered by timestamp
2. STAT_DELTA (additive)          — ordered by timestamp
3. Counters (+1/+1)               — always last
```

The `timestamp` field is the seed of this. Today only `STAT_DELTA` exists, so ordering is trivial.

---

## 4. Remaining Mechanics (from the prioritized build order)

The modifier design's §12 prioritized build order lists mechanics that unlock cards. P0–P2 (Scorch, attack triggers, destroy target) are now done or in progress. The remaining mechanics:

| Priority | Mechanic | Unlocks | Difficulty | Depends on |
|----------|----------|---------|------------|------------|
| 🔴 P3 | **Stat boost / anthem** (modifier system) | 2 cards | Medium | Modifier system |
| 🟡 P4 | **Deck search/reveal** | 2 cards | Medium | Deck manipulation |
| 🟡 P5 | **AOE damage** | 1 card | Low | Multi-target |
| 🟡 P6 | **Equipment** | 1 card | High — new system | `attachedTo` |
| 🟡 P7 | **Chain prevention** | 3 cards | Medium — replacement effect | Axis 1 |
| 🟡 P8 | **Discard-as-cost** | 3 cards | Low — extend ActionCost | ActionCost |
| 🟡 P9 | **Conditional cast from reveal** | 2 cards | Medium — replacement effect | Axis 1 |
| 🟡 P10 | **Once per turn** | 1 card | Low — flag on card | CardState |

### 4.1 Full mechanic inventory (ST01A, 24 cards)

| # | Mechanic | Cards using it | Engine status |
|---|----------|---------------|---------------|
| 1 | **灼熱 (Scorch)** — place counters on opponent's cards; when counters ≥ card's "ability total", destroy it | 9 cards | 🔴 New system |
| 2 | **ETB triggers** (召喚時) | 6 cards | ✅ Exists |
| 3 | **Attack triggers** (攻擊時) | 6 cards | ✅ Done (P1) |
| 4 | **Death triggers** (破壞時) | 1 card | 🔴 Missing |
| 5 | **Mana production** (橫置：生產) | 2 cards | ✅ Exists |
| 6 | **Deck search/reveal** (公開/加入手牌) | 2 cards | 🔴 Missing |
| 7 | **Conditional draw** (條件抽牌) | 4 cards | 🟡 Partial |
| 8 | **Direct damage to player** (對玩家造成傷害) | 2 cards | ✅ Exists |
| 9 | **Targeted damage to creature** (對僕從造成傷害) | 3 cards | 🟡 Partial |
| 10 | **Destroy target** (破壞) | 5 cards | ✅ Done (P2) |
| 11 | **Stat boost** (+X/+X) | 2 cards | 🔴 P3 |
| 12 | **Equipment** (裝備) | 1 card | 🔴 Missing |
| 13 | **Chain prevention** (不能觸發Chain) | 3 cards | 🔴 Missing |
| 14 | **Discard from hand as cost** (棄置此卡) | 3 cards | 🔴 Missing |
| 15 | **AOE damage** (全部僕從造成傷害) | 1 card | 🔴 Missing |
| 16 | **Conditional cast from reveal** (公開時加入手牌) | 2 cards | 🔴 Missing |
| 17 | **Once per turn** (效果回合一次) | 1 card | 🔴 Missing |
| 18 | **Anthem** (我方僕從攻擊力+3) | 1 card | 🔴 P3 |

### 4.2 New card schema fields needed

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

## 5. Gap & Stub Inventory (remaining)

| # | Gap / Stub | Where | Status |
|---|-----------|-------|--------|
| 1 | `GRANT_STATS` handler missing | `effect-registry.ts` | 🔴 P3 |
| 2 | No `CardState.modifiers` field | `card.types.ts` | 🔴 P3 |
| 3 | No `ADD_MODIFIER`/`REMOVE_MODIFIER`/`CLEAR_END_OF_TURN_MODIFIERS` mutations | `game-mutation.types.ts`, `game-reducer.ts` | 🔴 P3 |
| 4 | No `stat-resolver.ts` | new file | 🔴 P3 |
| 5 | `attack-handler.ts` reads `blueprint.power` | `attack-handler.ts:73` | 🟡 After P3 |
| 6 | `CardComponent.tsx` displays `blueprint.power` | `CardComponent.tsx:40` | 🟡 After P3 |
| 7 | `effect-resolver.ts` dynamic params read `blueprint.power` | `effect-resolver.ts:104` | 🟡 After P3 |
| 8 | No cleanup wiring for `CLEAR_END_OF_TURN_MODIFIERS` | `state-machine.ts` | 🟡 After P3 |
| 9 | `ModifierPipeline.apply()` is identity stub | `modifier-pipeline.ts` | ⏸️ Deferred (Axis 1) |
| 10 | `ModifierRegistry.canPlay/canTarget` always true | `modifier-registry.ts` | ⏸️ Deferred (Axis 3) |
| 11 | `TriggerManager` global-event scanning | `trigger-manager.ts` | ⏸️ Deferred (§3.2) |
| 12 | `MODIFY_STATS` ignores P/T (only damage) | `effect-registry.ts` | 🟡 After P3 |
| 13 | No state-based actions (creature death from damage) | new system | ⏸️ Deferred |
| 14 | Combat targets player, not creature | `attack-handler.ts` | ⏸️ Deferred |
| 15 | Anthem (multi-target) resolution | `effect-registry.ts` | ⏸️ Deferred (§3.5) |
| 16 | `attachedTo` field unused | `card.types.ts` | ⏸️ Deferred (Auras) |

---

## 6. Phased Rollout (remaining phases)

**Phase 1 (modifier system, P3):** `ContinuousEffect` + `ContinuousModifier` types, `modifiers` on `CardState`, `stat-resolver.ts`, `GRANT_STATS` handler, three new mutations, cleanup wiring, switch read paths to effective stats.

**Phase 2 (when auras/equipment exist):** `attachedTo` field, `ATTACH` effect, `WHILE_ATTACHED` cleanup on leave, anthem (multi-target) resolution.

**Phase 3 (when cards need them):** `ModifierPipeline` (replacement effects), `ModifierRegistry` (permission checks), non-ETB triggers, state-based actions, creature-vs-creature combat.

---

## 7. Out of Scope (still)

- Full layer system (MTG layers 1–7) — only `timestamp` ordering is seeded.
- State-based actions (creature death, legend rule, etc.).
- Creature-vs-creature combat (current combat is player-targeting).
- Anthem/aura resolution (multi-target, `attachedTo`).
- Replacement effects and permission checks (axes 1 and 3).
- Non-ETB triggers (axis 2).
- Scorch counter system (P0 — separate design needed).