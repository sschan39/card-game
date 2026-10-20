# Characteristic evaluation boundary design

Date: 20 October 2026
Status: approved under the standing behavior-preserving architecture instruction

## Problem

The characteristic facade, layer evaluator, and continuous-effect normalization module form the
last runtime strongly connected component in the engine:

```text
card-characteristic-service.ts
  -> characteristic-layers.ts
  -> continuous-effects.ts
  -> card-characteristic-service.ts
```

`characteristic-layers.ts` does not need entry normalization. It imports `continuous-effects.ts`
only for read-only room-card and effect-lifetime queries, plus scope helpers that already belong to
`effect-scopes.ts`. The reverse edge exists because `normalizeContinuousEntry()` correctly uses the
public characteristic facade to freeze resolved scopes and numeric values.

## Goals

- Remove the final runtime import cycle without changing characteristic or continuous-effect
  behavior.
- Give read-only continuous-effect state queries a lower-level owner.
- Keep entry normalization in `continuous-effects.ts` and layer evaluation in
  `characteristic-layers.ts`.
- Preserve the existing exports from `continuous-effects.ts` for compatibility.
- Point internal read-only consumers directly at the lower-level module.

## Non-goals

- No changes to layer order, dependency ordering, timestamps, scope matching, last-known
  information, or characteristic-defining abilities.
- No changes to effect normalization, resolved recipient freezing, numeric evaluation, or effect
  duration.
- No changes to card, ability, continuous-effect, room, or mutation data contracts.
- No broad redesign of the characteristic facade, continuous-effect pool, or numeric subsystem.
- No dependency-injection framework or directory reorganization.

## Considered approaches

### 1. Extract read-only state queries — selected

Create `src/engine/continuous-effect-state.ts` containing the existing implementations of:

- `roomCards()`;
- `effectSource()`;
- `effectIsActive()`.

`characteristic-layers.ts` imports these queries from the new module and imports
`characteristicScope()` and `scopeMatches()` directly from their existing owner,
`effect-scopes.ts`. Other engine modules that only need the read-only queries also import the new
module directly. `continuous-effects.ts` consumes and re-exports the same function bindings so
existing imports remain compatible.

The runtime direction becomes:

```text
card-characteristic-service.ts -> characteristic-layers.ts
characteristic-layers.ts ------> continuous-effect-state.ts
characteristic-layers.ts ------> effect-scopes.ts

continuous-effects.ts ---------> card-characteristic-service.ts
continuous-effects.ts ---------> continuous-effect-state.ts
continuous-effects.ts ---------> effect-scopes.ts
```

There is no path from the lower-level state or scope modules back to normalization or the facade.

### 2. Inject characteristic callbacks into normalization — rejected

Passing resolution callbacks into `normalizeContinuousEntry()` would remove its facade import, but
would expose an implementation dependency at every mutation call site and permit inconsistent
views of characteristics. The normalization module already has the correct responsibility; only
the read-only helpers are misplaced.

### 3. Move normalization into the layer evaluator or facade — rejected

Relocating `normalizeContinuousEntry()` would mechanically remove the cycle but combine mutation
input preparation with read-only characteristic evaluation. Both existing subsystems are cohesive,
so merging them would worsen ownership for no behavioral benefit.

## Module responsibilities

### `continuous-effect-state.ts`

Owns pure queries over a room snapshot and effect entry:

- enumerate unique cards visible to continuous-effect rules;
- resolve an effect's source incarnation and required zone;
- determine whether a duration/source-dependent effect remains active.

The functions move without semantic edits and do not resolve characteristics or normalize entries.

### `effect-scopes.ts`

Continues to own scope validation, characteristic-scope defaults, and scope matching. Layer
evaluation imports it directly instead of through a convenience re-export.

### `continuous-effects.ts`

Continues to own timestamps, sequence allocation, and entry normalization. It imports the new
read-only queries and re-exports them as the exact same bindings, preserving current callers.

### `characteristic-layers.ts`

Continues to own printed characteristic construction, layer ordering, dependency ordering,
static-effect discovery, and whole-board evaluation. It depends only on the lower-level state and
scope queries, never on entry normalization or the public characteristic facade.

### `card-characteristic-service.ts`

Remains the stable read-only facade over `resolveCharacteristics()`. Its API and implementation
shape do not change.

## Data flow and compatibility

Characteristic reads retain their current path:

```text
CardCharacteristicService
-> resolveCharacteristics
-> enumerate room cards and active entries
-> build the printed board
-> apply layers in dependency order
-> return the requested card's effective characteristics
```

Continuous-effect creation retains its current path:

```text
game reducer
-> normalizeContinuousEntry
-> resolve current characteristics through the facade
-> freeze recipients or numeric values where required
-> add the normalized entry to the pool
```

Existing callers may continue importing the three read-only helpers from `continuous-effects.ts`.
The compatibility exports reference the functions from `continuous-effect-state.ts`; there is no
wrapper, duplicate implementation, or alternate behavior path.

## Error handling and invariants

- Missing or stale source incarnations remain inactive under the existing zone/revision rules.
- Global, emblem, resolved, permanent, battlefield, and attachment durations retain their current
  activation rules.
- Room-card enumeration retains its existing zone coverage and UUID de-duplication.
- Last-known characteristics and copiable values retain the current fallback behavior.
- Normalization errors for unresolved numeric expressions remain unchanged.

## Tests

The test-first boundary contract will prove:

- `continuous-effect-state.ts` exists and is independent of normalization, layers, and the facade;
- `characteristic-layers.ts` does not import `continuous-effects.ts` or the facade;
- `continuous-effects.ts` re-exports the three compatibility bindings from the state module;
- representative pure query behavior remains unchanged;
- the runtime import graph has no strongly connected components.

Existing characteristic-layer, continuous-effect, dependency-ordering, numeric, static-ability,
state-based, engine, client, and live Socket.IO tests remain the behavioral regression evidence.

## Documentation

- `ARCHITECTURE.md` will distinguish read-only continuous-effect state queries, entry
  normalization, layer evaluation, and the facade.
- `docs/MAP.md` will point characteristic evaluation and continuous-effect ownership to the new
  dependency direction.
- The architecture audit will retain the historical finding and record its Slice 4 resolution.
- The modernization roadmap will mark Slice 4 complete without changing later slice scope.
