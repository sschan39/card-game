# Targeting System — Design Document

**Date:** 2026-09-03
**Status:** Ready for Implementation — all open questions settled (2026-09-04)
**Context:** The `TargetPointer` type and the resolve-time half of targeting (`revalidateTargets`) already exist. What's missing is the **cast-time half**: the server merging client-chosen targets into the `StackEffect`, validating them against `TargetingDefinition`, and the client actually collecting and sending targets. This design wires `TargetPointer` into use end-to-end, MTG-faithfully.

---

## 1. Overview

MTG targeting has two distinct moments:

1. **Cast time (CR 601.2c)** — the player announces targets as part of casting, *before* costs are paid. Targets are locked into the spell on the stack.
2. **Resolve time (CR 114.5)** — when the spell resolves, each target is re-checked for legality. If *all* targets are illegal, the spell fizzles. If *some* are illegal, it resolves with the remaining legal ones.

The codebase already implements **resolve-time revalidation** (`revalidateTargets` in `src/engine/effect-resolver.ts`). This design adds the **cast-time half**:

- **Backend:** merge client-sent `TargetPointer[]` into the `StackEffect.targets` (currently dropped), and validate them against the card's `TargetingDefinition` at `validate()` time.
- **Frontend:** a target-selection mode that highlights legal targets and collects `TargetPointer[]` to send with the action.

**Out of scope:** hexproof/shroud/protection (still a stub), creature-vs-creature combat (separate deferred item), auras/equipment, multi-target selection UX polish, "target player" vs "target permanent" mixed-mode UI.

---

## 1.1 Architectural invariant: `validate()` must be pure & re-evaluable

**This is the single most important constraint on the design.** Every `validate()` method (and every validation helper it calls) MUST be a **pure function**:

- It reads `room` and `action` only — it never mutates `room`, never writes to external state, never emits events, never has side effects.
- It returns a deterministic `ActionResult` based solely on its inputs.
- It can be **safely re-evaluated at any point in the action lifecycle** — at cast time, when the action goes on the stack, and again at resolve time — and still produce a correct result against the *current* room state.

**Why this matters:** MTG is built on interaction chains. A spell goes on the stack, players respond, the stack resolves in LIFO order. Between cast and resolve, the game state can change arbitrarily (a target dies, a permanent gains hexproof, a player loses priority). The engine must be able to re-check legality at each step without corrupting state or depending on stale snapshots.

**Concrete guarantees this design preserves:**

1. **`validate()` never mutates.** Verified in the current handlers (`play-card-handler`, `attack-handler`, `tap-for-mana-handler`): all `validate()` methods only read `room`/`action` and return a result. This MUST be preserved for any new target-validation code.
2. **`ActionValidator` and `ModifierRegistry` are pure static helpers.** They take `room` and return booleans/results; they never mutate. New target-validation helpers MUST follow the same pattern.
3. **Cast-time and resolve-time checks are independent.** Cast-time validation (CR 601.2c) runs against the pre-cast room. Resolve-time revalidation (`revalidateTargets`, CR 114.5) runs against the post-response room. Both are pure reads; neither depends on the other's side effects.
4. **No validation state is persisted.** Legality is always computed on the fly from the current room. There is no "saved legality" to invalidate or refresh — the check is stateless by construction.

> **Rule for implementers:** if a validation helper ever needs to mutate state or read non-room state, it is NOT a validation helper — it belongs in `propose()` or `resolve()`. Keep `validate()` pure.

---

## 2. Current State (verified 2026-09-03)

### 2.1 What already exists

| Piece | Location | Status |
|-------|----------|--------|
| `TargetPointer` type | `src/types/effect.types.ts` | ✅ Defined |
| `TargetingDefinition` (type/required/min/max/all/filters) | `src/types/effect.types.ts` | ✅ Defined |
| `TargetValidator` type | `src/types/effect.types.ts` | ✅ Defined |
| `buildStackEffects()` fills `self` + `all` targets | `src/engine/effect-resolver.ts` | ✅ Works |
| `revalidateTargets()` resolve-time revalidation | `src/engine/effect-resolver.ts` | ✅ Works |
| `useGameActions.playerAction(actionId, cardUuid, targets?)` forwards targets | `src/client/hooks/useGameActions.ts` | ✅ Works |
| `server.ts` `playerAction` forwards `targets` | `src/server.ts` | ✅ Works |

### 2.2 The gaps

1. **Backend drops client targets.** `play-card-handler.ts` `propose()` passes `action.targets` to `ModifierRegistry.canTarget` (a stub returning `true`) and `ModifierPipeline.apply`, but **never copies them into the built `StackEffect`**. The comment in `buildStackEffects()` says *"targets are filled by server-prompted targeting (future)"* — so any explicit-target effect gets an empty `targets` array.
2. **Cast-time validation is a stub.** The *hook* exists — `play-card-handler.validate()` calls `ModifierRegistry.canTarget()` — but `canTarget()` always returns `true`. `TargetingDefinition.required/minTargets/maxTargets` are never actually checked against what the client sends.
3. **No frontend targeting UI.** `CardComponent` left-click and `ContextMenu` both call `playerAction` with **no targets**. There's no target-selection mode, no legal-target highlighting, no pending-target state.
4. **No cards need targeting yet.** The test deck (4x 帝国奴僕 + 4x 血炎山) has no targeting. The deferred-work spec lists "Targeted damage to creature" (3 cards) and "Destroy target" (5 cards) as the mechanics that would exercise this.

---

## 3. Design

### 3.1 Data flow (end-to-end)

```
Client                                    Server
──────                                    ──────
1. Left-click card in hand
2. Client reads card.blueprint.onCastEffects
   from its room snapshot → finds a
   TargetingDefinition with explicit targets
   (type !== 'self' && !all)
3. Enter targeting mode
4. Highlight legal targets (from room
   snapshot + TargetingDefinition)
5. Player clicks a target
6. playerAction(actionId, cardUuid,
   targets: TargetPointer[])
                                         7. playCardHandler.validate():
                                            - check target count vs
                                              TargetingDefinition
                                            - check each target legal
                                         8. playCardHandler.propose():
                                            - merge action.targets into
                                              StackEffect.targets
                                            - pay costs, push to stack
                                         9. resolveStackObject():
                                            - revalidateTargets() (CR 114.5)
                                            - apply effects to remaining
                                              legal targets
```

### 3.2 Backend changes

#### 3.2.1 Merge client targets into StackEffect (core fix)

**Settled: add `targeting?: TargetingDefinition` to `StackEffect`.** `buildStackEffects()` preserves the `TargetingDefinition` on each effect it builds. Then in `play-card-handler.ts` `propose()`, the handler iterates the effects and, for each effect whose `targeting` is explicit (`type !== 'self' && !all`), assigns the corresponding slice of `action.targets`.

```ts
// in buildStackEffects() — preserve the definition
return {
  action: def.action,
  params: def.params,
  tags: def.tags || [],
  targeting: def.targeting,   // NEW — preserved for merge + revalidation
  targets,
};

// in play-card-handler.propose() — merge client targets
let targetIdx = 0;
for (const effect of effects) {
  const t = effect.targeting;
  if (t && t.type !== 'self' && !t.all) {
    const count = t.maxTargets ?? action.targets.length;
    effect.targets = action.targets.slice(targetIdx, targetIdx + count);
    targetIdx += count;
  }
}
```

**Why the field (not re-parsing card data):** `buildStackEffects()` is called from **two** places — `play-card-handler.propose()` (for `onCastEffects`) and `TriggerManager` (for `onEnterEffects`). ETB triggers with explicit targets will need the same merge logic. Carrying `targeting` on the `StackEffect` makes the merge self-contained and avoids re-reading card data at each call site.

**Why not pass client targets into `buildStackEffects()`:** keeps `buildStackEffects()` pure (no client input) and keeps the merge in the handler where `action.targets` is already available.

#### 3.2.2 Cast-time target validation (CR 601.2c)

Target legality is **two distinct concerns** that must be kept separate:

1. **Structural legality** — does the target match the `TargetingDefinition`? (right type, right count, exists in the right zone). This is a **rules check** and belongs in `ActionValidator` alongside the other rules validation (zone, timing, cost, priority).
2. **Permission legality** — is the target protected? (hexproof, shroud, protection). This **is** a modifier check and belongs in `ModifierRegistry`. It remains a stub for now.

**Structural checks (new — in `ActionValidator`):** add a pure static method, e.g. `ActionValidator.canTarget(room, playerId, card, targets, targetingDef)`, that validates `action.targets` against the card's `TargetingDefinition`:

- **Count:** if `required` and no targets → reject. If `minTargets`/`maxTargets` set → enforce bounds.
- **Type:** each target's `targetType` must match the `TargetingDefinition.type` (and `cardTypes`/`subTypes` filters).
- **Existence:** each target must reference a real object (permanent on battlefield by `cardUuid`, player in `room.players`, spell on stack by `stackUuid`).

**Permission checks (future — in `ModifierRegistry`):** `ModifierRegistry.canTarget()` stays a stub for now. When hexproof/shroud/protection are implemented, they extend this method (or add sibling checks).

**Resolve-time fizzle (CR 114.5) — uses the new `targeting` field:** `revalidateTargets()` currently drops illegal targets but has no way to know whether an effect *required* targets. With `targeting.required` now on the `StackEffect`, it can decide: if `targeting.required` and all targets were dropped → the effect fizzles (empty `targets`); otherwise it resolves with the remaining legal targets. This is a pure read (see §1.1).

**Orchestration in `play-card-handler.validate()`:** the handler calls BOTH:

```ts
// 1. Structural legality (rules check)
if (!ActionValidator.canTarget(room, playerId, card, action.targets, targetingDef)) {
  return { success: false, phase: 'validate', reason: 'Target is not legal' };
}
// 2. Permission legality (modifier check — stub for now)
if (!ModifierRegistry.canTarget(room, playerId, card, action.targets)) {
  return { success: false, phase: 'validate', reason: 'Target is protected' };
}
```

Both helpers are pure (see §1.1), so this orchestration is safely re-evaluable mid-flight.

#### 3.2.3 Expose targeting requirements to client (OPTIONAL — deferred)

Extend `ActionOption` (in `src/engine/option-service.ts`) with an optional `targeting?: TargetingDefinition`. Populate it in `getHandOptions()`/`getBattlefieldOptions()` by reading the card's `onCastEffects`/`abilities` for any effect with an explicit-target `TargetingDefinition`.

**Status: NOT required for the cast-spell flow.** The client already holds the full `CardBlueprint` (including `onCastEffects` with its `TargetingDefinition`) in its room snapshot — `server.ts` sends the complete `GameRoom` on create/join/start, and `filterForPlayer` only redacts the opponent's hand/deck. So the client can derive targeting requirements directly from its snapshot (see §3.3.2).

This field becomes necessary **later**, when targeted *activated/triggered abilities* are added — those use the legacy `EffectPayload` (`{ effectId, params? }`), which has **no `targeting` field** today. At that point the ability data model must gain a `targeting` field, and `ActionOption.targeting` is the natural server-authoritative carrier for it.

### 3.3 Frontend changes

#### 3.3.1 Targeting-mode state

Add to `gameStore.ts`:

```ts
interface TargetingState {
  cardUuid: string;
  zone: 'hand' | 'battlefield';
  actionId: ActionIdOrAbility;
  targeting: TargetingDefinition;
  collected: TargetPointer[];
}
```

Store field `targeting: TargetingState | null`. Actions: `beginTargeting(state)`, `addTarget(pointer)`, `removeTarget(pointer)`, `cancelTargeting()`, `confirmTargeting()`.

#### 3.3.2 Enter targeting mode

In `CardComponent.tsx`, when a card requires targeting, left-click enters targeting mode instead of immediately casting.

**Design decision (settled): full Option B.** The client derives targeting requirements directly from `card.blueprint.onCastEffects` in its room snapshot. The `TargetingDefinition` is **static card data**, and the snapshot the client already holds *is* the server-authoritative copy — there is no separate authoritative version to fetch. The "needs targets?" predicate is trivial and lives in one small client helper:

```ts
// client helper — does this card need explicit targets before casting?
function needsTargets(card: CardInstance): TargetingDefinition | null {
  const def = card.blueprint.onCastEffects?.find(
    (e) => e.targeting.type !== 'self' && !e.targeting.all
  )?.targeting;
  return def ?? null;
}
```

This gives zero-latency entry into targeting mode (no round-trip on the common cast path) and no logic duplication beyond the trivial predicate above. The server `targeting` field on `ActionOption` (§3.2.3) is deferred until targeted abilities exist.

#### 3.3.3 Target selection UI

New `TargetSelector.tsx` component. When `targeting` state is active:
- Highlight legal targets: battlefield cards (matching `cardTypes`/`subTypes`/`controller` filters) and players (for `type: 'player'`).
- Clicking a legal target adds a `TargetPointer` to `collected`.
- Enforce `minTargets`/`maxTargets` (disable confirm until min reached; stop adding at max).
- Confirm → `playerAction(actionId, cardUuid, collected)`.
- Cancel → clear targeting state.

`ContextMenu.tsx` also enters targeting mode when the chosen action requires targets.

**Scope (settled): single-target UX for now.** The `TargetSelector` collects one target then confirms. The **backend and data model already fully support multi-target** — the merge logic (§3.2.1) slices `maxTargets` worth of targets per effect, `revalidateTargets()` iterates all targets, and `TargetingDefinition` carries `minTargets`/`maxTargets`. Only the *frontend interaction* (selecting N targets before confirming) is deferred; no backend change is needed to enable it later.

---

## 4. Test card

Add a targeting test card to `src/library/card_data.json` to exercise the flow, e.g.:

```json
"fire-bolt": {
  "id": "fire-bolt",
  "name": "火焰箭",
  "manaCost": "{R}",
  "cardTypes": ["Spell"],
  "rulesText": "對目標僕從造成2點傷害",
  "onCastEffects": [{
    "action": "MODIFY_STATS",
    "params": { "damage": 2 },
    "tags": ["damage"],
    "targeting": { "type": "permanent", "cardTypes": ["Creature"], "required": true, "minTargets": 1, "maxTargets": 1 }
  }]
}
```

Add it to the test deck in `room-factory.ts` so it can be drawn and cast in the smoke test.

**Settled: synthetic test card.** The real ST01A cast-spell targeting card is 烈焰獠牙 (`flame-fang`, "速：破壞對手一張地界。然後，抽一張牌"), but adding it requires the metadata schema fields (`element`, `race`, `rarity`, `set`, `mechanics`) — a **separate concern** tracked in the deferred-work spec (§4.2). The synthetic 火焰箭 exercises the exact targeting flow (cast spell → target → resolve) with zero schema changes. The real card is added later when the metadata schema work lands.

> **Note on the ST01A "targeted damage to creature" cards:** all 3 (諸界火術士, 諸界烈刃, 極炎皇帝 阿基里斯) are **attack triggers**, not cast spells. They need the triggered-ability targeting path, which is a separate follow-up (see §7.6).

---

## 5. Testing strategy

### 5.1 Engine unit tests

- **Merge:** a card with `targeting.type='permanent'` gets its client-sent `cardUuid` into the `StackEffect.targets` after `propose()`.
- **Count validation:** reject when `required` and no targets; reject when fewer than `minTargets`; reject when more than `maxTargets`.
- **Type validation:** reject a `player` target when the definition requires `permanent`.
- **Legality validation:** reject a `cardUuid` not on the battlefield.
- **Resolve revalidation (already covered):** confirm a target that left the battlefield is dropped at resolve; confirm the spell fizzles when all targets are gone.
- **Fizzle via `targeting.required`:** an effect with `required: true` whose only target left the battlefield resolves with empty `targets` (fizzles); an effect with `required: false` resolves with the remaining legal targets.

### 5.2 Manual smoke test

Extend `docs/smoke-test-rps.md` (or a new doc) with a targeting scenario:
1. Cast 火焰箭 → targeting mode highlights legal creatures.
2. Select a creature → damage applies to the chosen creature.
3. Attempt to cast with no legal target → rejected with error.

---

## 6. Phased rollout

Each phase is independently verifiable (build + tests pass):

| Phase | Deliverable | Verify |
|-------|-------------|--------|
| **1** | Backend: merge `action.targets` into `StackEffect` | Unit test: target lands in StackEffect |
| **2** | Backend: add `ActionValidator.canTarget()` (structural: count/type/existence) + wire into `play-card-handler.validate()` | Unit tests: count/type/existence rejections; purity test (validate is re-evaluable) |
| **3** | Frontend: targeting-mode UI (client reads `onCastEffects` from snapshot) | Manual smoke test |
| **4** | Test card + integration | Engine tests + smoke test |
| **5** *(deferred)* | Backend: expose `targeting` on `ActionOption` (needed only when targeted abilities exist) | Unit test: getOptions returns targeting |

---

## 7. Open questions for discussion

1. **Where should target legality live?** **Settled: split.** Structural legality (type/count/existence) goes in a new pure `ActionValidator.canTarget()`; permission legality (hexproof/shroud/protection) stays in `ModifierRegistry.canTarget()` (stub for now). Both are pure per §1.1.
2. **How does the client know a card needs targets?** **Settled: full Option B.** Client reads `card.blueprint.onCastEffects` from its room snapshot (which is the server-authoritative copy). The `TargetingDefinition` is static card data; no round-trip needed. The server `targeting` field on `ActionOption` is deferred until targeted abilities exist.
3. **Should `StackEffect` gain a `targeting?: TargetingDefinition` field** so the merge logic is self-contained? **Settled: yes.** `buildStackEffects()` preserves it; `propose()` uses it for merge; `revalidateTargets()` uses `targeting.required` for the CR 114.5 fizzle decision. Also needed for future ETB (`onEnterEffects`) targeting via `TriggerManager`.
4. **Multi-target UX:** **Settled: single-target UX for now.** The backend and data model already support multi-target (`minTargets`/`maxTargets`, merge slices `maxTargets` per effect, `revalidateTargets` iterates all). Only the frontend `TargetSelector` interaction (selecting N targets before confirming) is deferred — no backend change needed to enable it later.
5. **Should the test card be a real ST01A card** (e.g. one of the 3 "targeted damage to creature" cards) rather than a synthetic one? **Settled: synthetic.** The real cast-spell targeting card (烈焰獠牙) needs the metadata schema fields (`element`/`race`/`rarity`/`set`/`mechanics`), a separate concern tracked in the deferred-work spec. The synthetic 火焰箭 exercises the targeting flow with zero schema changes.
6. **TODO — onAttack-triggered targeting (needs full spec later).** The 3 ST01A "targeted damage to creature" cards (諸界火術士, 諸界烈刃, 極炎皇帝 阿基里斯) are **attack triggers**, not cast spells. They require: (a) a `targeting` field on the legacy `EffectPayload`/`TriggeredAbility` model (currently absent), (b) `TriggerManager` prompting the attacker for a target when an attack-triggered effect needs one, and (c) the client entering targeting mode from an attack-trigger context (not just cast). This is a **separate feature** — the current spec covers cast-time targeting only. **Deferred; write a full spec before implementing.**