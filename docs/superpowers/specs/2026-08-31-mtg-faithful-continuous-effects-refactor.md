# MTG-Faithful Continuous Effects — Refactor Design

**Date:** 2026-09-01
**Status:** Reviewed — Ready for Planning
**Supersedes:** The modifier model in `2026-08-30-continuous-effects-and-modifiers-design.md` §2–§6. That design materialized continuous effects onto each affected card's `CardState.modifiers`. This refactor replaces that with MTG's global continuous-effect model.

**Context:** The materialized-modifier model (committed `730904a`, `7ccec5a`) has three deviations from MTG that are real problems, not nits:

1. **Effects are materialized onto targets.** An anthem resolves by scanning the battlefield and pushing `ADD_MODIFIER` onto each *existing* matching card. A permanent that enters *after* the anthem source never gets the effect. MTG applies continuous effects to *all* matching objects at *all* times, including ones that enter later.
2. **Client computes effective stats.** `CardComponent` calls `getEffectivePower(card)` client-side with no room. The client cannot know about global effects.
3. **Cleanup is a distributed push problem.** When the source leaves, every copy of its modifier must be found and removed. "Silenced" would need a second mechanism.

This refactor moves to MTG's model: a **`ContinuousEffectPool`** — a global registry of continuous effects, evaluated from the source outward, on-demand, in layer order.

---

## 1. The MTG model

In MTG, a continuous effect is **not stored on the affected object**. It lives in a global registry of effects, each with:

- **Source** — the object that created it (a permanent, an emblem, etc.)
- **Layer** — which of the 7 layers it applies in (we implement a subset of layer 7)
- **Scope** — which objects it affects (a characteristic-defining query, evaluated continuously)
- **Ordering** — timestamp order within a layer

When you ask "what is this creature's power?", the game:
1. Collects **all** continuous effects from the pool
2. Filters to those whose **source has a valid zone** (on battlefield, not silenced)
3. Filters to those whose **scope matches this creature**
4. Applies them in **layer order**, then **timestamp order**

The effect is evaluated from the source outward. It is never copied onto the target. This is why a new permanent entering later automatically gets the anthem, and why the effect stops applying the instant its source leaves — there is nothing to clean up.

### 1.1 There is no "apply" pass and no "remove applied effects" pass

The single most important correction to the old model: **continuous effects are never "applied" to targets, so there is nothing to "remove" from targets.**

The old (wrong) mental model was three scans:
1. ❌ Scan to find which effects are active
2. ❌ Scan to find what each effect applies to, and *push* the effect onto those targets
3. ❌ Scan to find effects that are no longer active, and *remove* them from targets

The MTG model is **one on-demand evaluation**, and nothing else:
1. ✅ When reading a card's characteristic, evaluate the pool: filter by source-zone validity + scope, fold the deltas.

There is no periodic sweep. There is no "applied effects" list to clean up. An entry whose source left the battlefield simply **stops matching** — it contributes nothing to the evaluation. It can sit in the pool forever and never affect anything.

The only reason to *physically remove* an entry from the pool is **housekeeping** (memory + not syncing dead data to the client), never correctness. §5 covers this housekeeping, but it is explicitly an optimization, not a game rule.

---

## 2. The new model

### 2.1 `ContinuousEffectEntry` — a pool entry

```typescript
// src/types/card.types.ts (or a new continuous-effect.types.ts)

export interface ContinuousEffectEntry {
  source: string;              // cardUuid of source | 'emblem' | 'global'
  layer: number;               // 1-7 subset; we implement layer 7 (P/T)
  effect: ContinuousEffect;    // STAT_DELTA | SET_STATS (existing union)
  scope: {
    cardTypes?: string[];      // e.g. ['Creature']
    subTypes?: string[];       // e.g. ['Servant']
    cardUuid?: string;         // single-card target (for non-anthem buffs, §4.5)
    controller?: 'self' | 'opponent' | 'any';  // relative to source's controller
  };
  requiredZone?: CardZone;     // zone the source must occupy for this entry to be valid.
                               // Default: 'battlefield' (most effects are from permanents).
                               // Explicit: 'graveyard' for graveyard-dependent effects.
                               // 'emblem'/'global' sources ignore this field.
  duration: 'END_OF_TURN' | 'WHILE_ATTACHED' | 'WHILE_ON_BATTLEFIELD' | 'PERMANENT';
  // No timestamp — ordering within a layer is insertion order (array index).
  // No ST01A card creates timestamp-dependent ordering conflicts.
  // Revisit when implementing full layer system (§7).
}
```

### 2.2 `GameRoom` gains the pool

```typescript
export interface GameRoom {
  // ...existing fields...
  continuousEffectPool: ContinuousEffectEntry[];   // NEW — the ContinuousEffectPool
}
```

### 2.3 `CardState` loses `modifiers`

```typescript
export interface CardState {
  // ...existing fields...
  // modifiers: ContinuousModifier[];   // REMOVED — replaced by room.continuousEffectPool
}
```

The `ContinuousModifier` interface is removed. `ContinuousEffect` (the closed union) is kept — it is the `effect` payload inside `ContinuousEffectEntry`.

---

## 3. Characteristic resolution — the query pipeline

The entry point is a **`CardCharacteristicService`** — a query facade. It answers "what is this card's power/toughness?" by folding the pool through a fixed pipeline. It is *not* a procedural flag-checker; it is a characteristic resolver.

```typescript
// src/engine/card-characteristic-service.ts (rewritten from stat-resolver.ts)

export const CardCharacteristicService = {
  resolvePower(room: GameRoom, card: CardInstance): number {
    const base = card.blueprint.power ?? 0;
    const deltas = resolveLayer7Deltas(room, card, 'power');
    const fromCounters = card.state.counters['+1/+1'] ?? 0;
    return base + deltas + fromCounters;
  },

  resolveToughness(room: GameRoom, card: CardInstance): number {
    const base = card.blueprint.toughness ?? 0;
    const deltas = resolveLayer7Deltas(room, card, 'toughness');
    const fromCounters = card.state.counters['+1/+1'] ?? 0;
    return base + deltas + fromCounters;
  },
};
```

The pipeline, in order:

```typescript
function resolveLayer7Deltas(room: GameRoom, card: CardInstance, key: 'power' | 'toughness'): number {
  return room.continuousEffectPool
    .map(entry => ({ entry, sourceCard: locateSource(room, entry) }))   // ① resolve source ONCE
    .filter(({ entry, sourceCard }) => hasValidSourceZone(entry, sourceCard))  // ② source validation
    .filter(({ entry, sourceCard }) => matchesScope(entry.scope, card, sourceCard))  // ③ scope match
    .filter(({ entry }) => entry.effect.type === 'STAT_DELTA')
    // ④ layer sort & fold — insertion order within layer 7 (no timestamp, §4.4)
    .reduce((sum, { entry }) => sum + (entry.effect[key] ?? 0), 0);
}
```

### 3.1 Step ② — Source validation (`hasValidSourceZone`)

"Active" is overloaded in card games (an effect can be enabled, a trigger can fire, a player can hold priority). This predicate validates exactly one thing: **does the source occupy its required zone?** The name makes that intent explicit.

```typescript
function hasValidSourceZone(entry: ContinuousEffectEntry, sourceCard: CardInstance | undefined): boolean {
  if (entry.source === 'emblem' || entry.source === 'global') return true;  // no zone requirement
  return sourceCard !== undefined;  // found in requiredZone → valid
  // future: && !sourceCard.state.silenced
}

function locateSource(room: GameRoom, entry: ContinuousEffectEntry): CardInstance | undefined {
  if (entry.source === 'emblem' || entry.source === 'global') return undefined;  // sentinel
  const zone = entry.requiredZone ?? 'battlefield';
  return findCardInZone(room, entry.source, zone);
}

function findCardInZone(room: GameRoom, uuid: string, zone: CardZone): CardInstance | undefined {
  switch (zone) {
    case 'battlefield':
      return room.battlefield.find(c => c.uuid === uuid);
    case 'stack':
      return (room.stack.find(s => (s.source as CardInstance).uuid === uuid)?.source as CardInstance);
    case 'hand':
    case 'graveyard':
    case 'library':
      for (const player of Object.values(room.players)) {
        const arr = zone === 'hand' ? player.hand
          : zone === 'graveyard' ? player.graveyard
          : player.deck;
        const found = arr.find(c => c.uuid === uuid);
        if (found) return found;
      }
      return undefined;
    default:
      return undefined;
  }
}
```

> **Design rationale:** `requiredZone` defaults to `'battlefield'` because the vast majority of continuous effects come from permanents. A card that says "while this card is in your graveyard, ..." explicitly sets `requiredZone: 'graveyard'`. The zone condition is part of the effect definition, not a runtime discovery.
>
> **Zone-change cleanup:** When the source moves zones, `REMOVE_CONTINUOUS_EFFECT` fires (§5.1). If the effect should persist in the new zone, the appropriate trigger re-creates it with the new `requiredZone`. This is MTG-faithful: a new zone means a new object.
>
> **Silenced** is a future extension point. The predicate would become `sourceCard && !sourceCard.state.silenced`. No ST01A card silences, so `silenced` is **not** added to `CardState` now. (See §7.)

### 3.1a The "while" condition is orthogonal to the effect payload

`requiredZone` answers **one** question: *where must the source be for this entry to be valid?* It is the **source-validity** dimension. It is deliberately orthogonal to **what the effect does** (the `effect` payload).

Consider two future cards:

1. *"While this card is in your graveyard, the first spell you cast each turn costs colorless mana only."*
   - `requiredZone: 'graveyard'` (source-validity condition)
   - `effect: { type: 'COST_MODIFICATION', ... }` (a future effect type — not in the current `STAT_DELTA | SET_STATS` union)
   - The "first spell each turn" is a *further* condition inside the effect's own semantics, not a source-validity concern.

2. *"You may play one card from your graveyard each turn, then banish that card."*
   - `requiredZone: 'battlefield'` (implied — the default)
   - `effect: { type: 'PLAY_PERMISSION', ... }` (a future effect type)
   - The "one card each turn" and "then banish" are effect semantics.

**Key point:** `requiredZone` handles the "while in zone Z" clause generically. The *effect payload* (`ContinuousEffect` union) is the extension point for new effect kinds (cost modification, play permission, etc.). This refactor only implements `STAT_DELTA | SET_STATS` (layer 7), but the `requiredZone` mechanism is already general enough to support any "while in zone Z" effect. New effect types are added by extending the `ContinuousEffect` union — no change to the source-validity model.

### 3.2 Step ③ — Scope match (`matchesScope`)

```typescript
function matchesScope(
  scope: ContinuousEffectEntry['scope'],
  card: CardInstance,
  sourceCard: CardInstance | undefined
): boolean {
  // Single-card target (non-anthem buffs, §4.5)
  if (scope.cardUuid && card.uuid !== scope.cardUuid) return false;
  // Characteristic-based matching
  if (scope.cardTypes?.length && !scope.cardTypes.some(t => card.blueprint.cardTypes.includes(t))) return false;
  if (scope.subTypes?.length && !scope.subTypes.some(s => (card.blueprint.subTypes || []).includes(s))) return false;
  // Controller-relative (resolved against source's controller)
  if (scope.controller === 'self' && sourceCard && card.state.controllerId !== sourceCard.state.controllerId) return false;
  if (scope.controller === 'opponent' && sourceCard && card.state.controllerId === sourceCard.state.controllerId) return false;
  return true;
}
```

> **Controller resolution:** `scope.controller` is relative to the *source's* controller, not the reader's. The source card's `state.controllerId` is looked up at read time. This is how "all creatures **you** control" (relative to the anthem source's controller) works. For `'emblem'`/`'global'` sources there is no source card; `controller` is then resolved against the entry's recorded controller (see §4.2).

---

## 4. Mutations

### 4.1 New mutation types

```typescript
// src/types/game-mutation.types.ts

| { type: 'ADD_CONTINUOUS_EFFECT'; entry: ContinuousEffectEntry }
| { type: 'REMOVE_CONTINUOUS_EFFECT'; source: string }   // remove all entries from a source
| { type: 'CLEAR_END_OF_TURN_EFFECTS' }                  // fired at cleanupStep
```

- `ADD_CONTINUOUS_EFFECT` appends to `room.continuousEffectPool`.
- `REMOVE_CONTINUOUS_EFFECT` filters out all entries with matching `source`. This is the **single** housekeeping path — used when a source changes zones.
- `CLEAR_END_OF_TURN_EFFECTS` strips all entries with `duration === 'END_OF_TURN'`.

### 4.2 `GRANT_STATS` handler — unified target model

The handler uses `effect.targets` (the same `TargetPointer[]` used by all other handlers) to derive the scope. One `TargetPointer` type serves both modes:

- **Anthem mode** (`target.all === true`): scope uses the filter fields (`cardTypes`, `subTypes`, `controller`). One global effect affects all matching permanents.
- **Single-target mode** (`target.cardUuid`): scope uses `cardUuid`. One global effect affects exactly that card.

```typescript
'GRANT_STATS': (room, stackObj, effect) => {
  const params = effect.params as { power?: number; toughness?: number };
  const sourceCard = stackObj.source as CardInstance | undefined;
  const source = sourceCard?.uuid ?? 'emblem';
  const mutations: GameMutation[] = [];

  for (const target of effect.targets) {
    // Derive scope from the SAME TargetPointer used by all handlers.
    // Anthem: target.all + filter fields → characteristic scope.
    // Single-target: target.cardUuid → cardUuid scope.
    const scope: ContinuousEffectEntry['scope'] = target.all
      ? { cardTypes: target.cardTypes, subTypes: target.subTypes, controller: target.controller }
      : target.cardUuid
        ? { cardUuid: target.cardUuid }
        : {};

    if (params.power !== undefined) {
      mutations.push({
        type: 'ADD_CONTINUOUS_EFFECT',
        effect: {
          source,
          layer: 7,
          effect: { type: 'STAT_DELTA', power: params.power },
          scope,
          duration: 'END_OF_TURN',
        },
      });
    }

    if (params.toughness !== undefined) {
      mutations.push({
        type: 'ADD_CONTINUOUS_EFFECT',
        effect: {
          source,
          layer: 7,
          effect: { type: 'STAT_DELTA', toughness: params.toughness },
          scope,
          duration: 'END_OF_TURN',
        },
      });
    }
  }

  return mutations;
}
```

> **Key change:** For an anthem (`all: true`), the handler emits **one** global effect with a characteristic scope, not N per-card modifiers. This is what makes new permanents entering later automatically get the anthem.
>
> **Unified target model:** The same `TargetPointer` type carries both anthem filter fields and concrete `cardUuid`. `revalidateTargets()` already handles both paths (expand `all` → concrete, validate concrete). The `GRANT_STATS` handler reads the same targets and derives the appropriate scope. No new types needed.

### 4.3 `duration` on `ContinuousEffectEntry`

The `duration` field is stored on `ContinuousEffectEntry` (see §2.1). `CLEAR_END_OF_TURN_EFFECTS` strips entries with `duration === 'END_OF_TURN'`.

> **Note on `WHILE_ON_BATTLEFIELD`:** With the pool model, `WHILE_ON_BATTLEFIELD` is *implied* by `hasValidSourceZone` (§3.1) — the entry stops matching when its source leaves. The explicit `duration` value is retained for clarity and for the `END_OF_TURN` cleanup, but the *mechanism* that stops a battlefield anthem is the source-validity filter, not a duration sweep. This is the MTG-faithful behavior the user asked for.

### 4.4 No timestamp

**Decision:** No `timestamp` field on `ContinuousEffectEntry`. Ordering within a layer is insertion order (array index). No ST01A card creates timestamp-dependent ordering conflicts (e.g., two anthems applying in a specific order). Revisit when implementing the full layer system (§7).

### 4.5 Concrete-target effects (non-anthem)

For a non-anthem `GRANT_STATS` (e.g. Crimson Hellkite's `{R}: +1/+0 until end of turn` on itself), the effect targets one specific card. In the global model, this is a global effect whose scope matches exactly that one card via `scope.cardUuid` (already in the type, §2.1).

**Decision:** `cardUuid?: string` in `scope`. When present, the effect applies only to that card. This handles self-buffs and single-target buffs cleanly without inventing a new mechanism. It is a pragmatic concession — MTG would express this as "target creature gets +1/+0" which is a one-shot effect, not a continuous one, but our `GRANT_STATS` is used for both. See §7 for the distinction.

---

## 5. Housekeeping (not correctness)

> **Critical framing:** Per §1.1, removing an entry from the pool is **never required for correctness**. `hasValidSourceZone` (§3.1) already makes a dead entry contribute nothing. This section is purely about *housekeeping* — keeping the pool small and not syncing dead data to the client.

### 5.1 Source changes zones → `REMOVE_CONTINUOUS_EFFECT`

When a card moves zones, its pool entries are removed. This is emitted in `GameEngine.applyMutations()` on **any** `MOVE_CARD` where the moved card is a source of pool entries:

```typescript
// game-engine.ts, in applyMutations(), on any MOVE_CARD:
if (m.type === 'MOVE_CARD') {
  // Housekeeping: drop entries whose source just changed zones.
  // Correctness does NOT depend on this — hasValidSourceZone() would already
  // make these entries inert. This just keeps the pool small and the client
  // in sync. If the effect should persist in the new zone, the appropriate
  // trigger re-creates it with the new requiredZone.
  if (this.room.continuousEffectPool.some(entry => entry.source === m.cardUuid)) {
    this.mutationCollector.push({ type: 'REMOVE_CONTINUOUS_EFFECT', source: m.cardUuid });
  }

  // ...existing PERMANENT_LEFT emission (battlefield→graveyard only)...
}
```

> **Design note:** This fires on ALL zone changes. A source moving battlefield→graveyard, graveyard→hand, hand→stack, etc. all trigger cleanup. If the effect should persist (e.g., an emblem), the source is `'emblem'` which never matches a `cardUuid`. If a card returns from graveyard to battlefield, it's a new object and the entry must be re-created by the appropriate trigger — this is MTG-faithful.
>
> **Example:** "While this card is in your graveyard, first spell each turn costs colorless" sets `requiredZone: 'graveyard'`. If the card moves graveyard→hand, `REMOVE_CONTINUOUS_EFFECT` fires. If it later moves hand→graveyard again, the appropriate trigger re-creates the entry with `requiredZone: 'graveyard'`.

### 5.2 End of turn → `CLEAR_END_OF_TURN_EFFECTS`

Already wired in `state-machine.ts` at `cleanupStep`; the mutation name changes. This is also housekeeping — an `END_OF_TURN` rule could carry a `duration` check in the resolver, but stripping it at cleanup is simpler and keeps the list small.

---

## 6. Client (deferred display, correct data now)

The client already holds the full `GameRoom` (synced via path-based deltas). The server is authoritative for the `continuousEffectPool` state.

### 6.1 Sync `continuousEffectPool`

`sync-service.ts` must emit deltas for `room.continuousEffectPool` when it changes:

```typescript
case 'ADD_CONTINUOUS_EFFECT':
  return [{ path: `continuousEffectPool[${newState.continuousEffectPool.length - 1}]`, op: 'add', value: /* new entry */ }];
case 'REMOVE_CONTINUOUS_EFFECT':
  // emit remove changes for each removed index, in REVERSE order
case 'CLEAR_END_OF_TURN_EFFECTS':
  // emit remove changes for each removed index, in REVERSE order
```

> **Reverse-order removal:** When removing multiple indices (e.g., indices 1 and 3), emit removes for index 3 first, then index 1. This keeps earlier indices valid during client-side array mutation.

### 6.2 Client display (deferred)

The client will eventually use `CardCharacteristicService.resolvePower(room, card)` in `CardComponent`. For now, the client receives the correct `continuousEffectPool` data via delta sync. The display can continue reading `card.blueprint.power` directly — the data is correct on the server; the client just isn't rendering derived characteristics yet. This is tracked as a follow-up.

> **Why deferred?** The client-side characteristic resolution requires importing the service into the client bundle and wiring it through `CardComponent`. This is a pure display concern — the game logic is correct regardless. Deferring keeps this refactor focused on the engine.

---

## 7. What this refactor does NOT do (deferred)

- **Client-side stat display** — `CardComponent` still reads `card.blueprint.power`. The client receives correct `continuousEffectPool` data; rendering derived characteristics is a follow-up (§6.2).
- **Silenced** — no ST01A card silences. The `hasValidSourceZone` predicate is written to accept a `silenced` flag later (one-line change). Not added now.
- **Full layer system (layers 1–6)** — only layer 7 (P/T) is implemented. `layer` is stored on each effect for future ordering, but only layer 7 is resolved today.
- **`SET_STATS` handler** — still declared in the union, no handler until a "becomes 3/3" card exists.
- **`MODIFY_STATS` P/T** — the handler currently ignores power/toughness changes (gap #12). Separate follow-up.
- **Timestamp ordering** — no timestamp field. Insertion order (array index) is sufficient for ST01A. Revisit with full layer system.
- **One-shot vs continuous distinction** — MTG distinguishes "target creature gets +1/+0 until end of turn" (a one-shot effect that creates a continuous effect) from a true continuous ability. Our `GRANT_STATS` handler is used for both. The `cardUuid` scope (§4.5) is the pragmatic bridge. A future refactor could split these, but no card needs it yet.
- **Auras / equipment** — `attachedTo`, `WHILE_ATTACHED` cleanup. Unchanged from the prior design.
- **Frontend special-effect rendering** — TBC, out of scope.

---

## 8. Files touched

| File | Change |
|------|--------|
| `src/types/card.types.ts` | Add `ContinuousEffectEntry`; remove `ContinuousModifier`; remove `modifiers` from `CardState` |
| `src/types/game.room.types.ts` | Add `continuousEffectPool: ContinuousEffectEntry[]` to `GameRoom` |
| `src/types/game-mutation.types.ts` | Replace modifier mutations with `ADD_CONTINUOUS_EFFECT`/`REMOVE_CONTINUOUS_EFFECT`/`CLEAR_END_OF_TURN_EFFECTS` |
| `src/engine/card-characteristic-service.ts` | New: `CardCharacteristicService` with `resolvePower`/`resolveToughness` using the 4-step pipeline |
| `src/engine/stat-resolver.ts` | Removed — replaced by `card-characteristic-service.ts` |
| `src/engine/game-reducer.ts` | Handle new mutations; remove old modifier cases |
| `src/engine/effect-registry.ts` | `GRANT_STATS` emits pool entries; `MODIFY_STATS` P/T deferred |
| `src/engine/effect-resolver.ts` | Update `CardCharacteristicService.resolvePower` call sites (pass room) |
| `src/engine/handlers/attack-handler.ts` | Update `CardCharacteristicService.resolvePower(room, card)` |
| `src/engine/state-machine.ts` | Rename cleanup mutation |
| `src/engine/game-engine.ts` | Emit `REMOVE_CONTINUOUS_EFFECT` on any zone change |
| `src/server/sync-service.ts` | Emit deltas for `continuousEffectPool` |
| `src/client/components/CardComponent.tsx` | (Deferred — see §6.2) |
| `tests/engine/card-characteristic-service.test.ts` | New: test the 4-step pipeline |
| `tests/engine/stat-resolver.test.ts` | Removed — replaced by card-characteristic-service tests |
| `tests/engine/effect-registry.test.ts` | Update `GRANT_STATS` tests |
| `tests/engine/game-reducer.test.ts` | Update mutation tests |
| `tests/engine/game-engine.test.ts` | Add zone-change→`REMOVE_CONTINUOUS_EFFECT` test |

---

## 9. Resolved questions

1. **Unified target model (§4.2)** — ✅ Use the same `TargetPointer` for both anthem (`all: true` + filter fields) and single-target (`cardUuid`). The `GRANT_STATS` handler derives scope from the same targets every other handler uses. No new types.
2. **Client display (§6.2)** — ✅ Deferred. Client receives correct `continuousEffectPool` data via delta sync. `CardComponent` still reads `card.blueprint.power` for now. Rendering derived characteristics is a follow-up.
3. **Source zone (§3.1, §5.1)** — ✅ Zone-conditional via `requiredZone?: CardZone`. Defaults to `'battlefield'`. `REMOVE_CONTINUOUS_EFFECT` on zone change is **housekeeping** (not correctness) — `hasValidSourceZone` already makes dead entries inert. The only correctness-critical cleanup is `CLEAR_END_OF_TURN_EFFECTS` (entries that expire by time, not by zone).
4. **Timestamp (§4.4)** — ✅ Removed. No `timestamp` field. Ordering is insertion order (array index). Revisit with full layer system.
5. **`MODIFY_STATS` P/T** — ✅ Separate follow-up. Not in this refactor.