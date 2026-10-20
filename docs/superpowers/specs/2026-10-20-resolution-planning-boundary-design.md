# Resolution planning boundary design

Date: 20 October 2026
Status: approved under the standing behavior-preserving architecture instruction

## Problem

The resolution orchestrator and two of its helpers form one runtime strongly connected component:

```text
effect-resolver.ts
  ├─ imports expandBoundedReveal from bounded-reveal.ts
  └─ imports resolutionChoice from resolution-choices.ts

bounded-reveal.ts
  └─ imports buildStackEffects from effect-resolver.ts

resolution-choices.ts
  └─ imports buildStackEffects, revalidateTargets, and buildDynamicParams
     from effect-resolver.ts
```

The reverse edges exist because reusable effect-construction and revalidation primitives live in
the orchestration module. Bounded reveal and resolution-choice construction are otherwise focused,
cohesive helpers and should remain separate.

## Goals

- Remove both runtime reverse edges into `effect-resolver.ts`.
- Keep `effect-resolver.ts` as the stack-resolution orchestration entry point.
- Give effect construction, resolve-time target revalidation, and dynamic parameter evaluation a
  lower-level owner that reveal, choices, and orchestration can all use.
- Preserve the existing exported helper API from `effect-resolver.ts` for current consumers.
- Keep the change independently reviewable and behavior-preserving.

## Non-goals

- No effect ordering, fizzle, target-legality, dynamic-value, reveal, or choice behavior changes.
- No changes to `StackObject`, `StackEffect`, `PendingChoice`, or continuation serialization.
- No redesign of `EffectRegistry`, `ModifierRegistry`, numeric queries, or replacement planning.
- No merge of bounded reveal or choice construction into the orchestrator.
- No broad migration of existing consumers away from the `effect-resolver.ts` facade.
- No directory reorganization or dependency-injection framework.

## Considered approaches

### 1. Extract reusable primitives into `resolution-planning.ts` — selected

Create `src/engine/resolution-planning.ts` containing the existing implementations of:

- `buildStackEffects()`;
- `revalidateTargets()`;
- `buildDynamicParams()`.

`effect-resolver.ts`, `bounded-reveal.ts`, and `resolution-choices.ts` import these functions from
the new lower-level module. `effect-resolver.ts` also re-exports them so existing engine, server,
client, and test imports remain compatible.

The runtime direction becomes:

```text
effect-resolver.ts
  ├─ resolution-planning.ts
  ├─ bounded-reveal.ts ────────┐
  └─ resolution-choices.ts ────┼─→ resolution-planning.ts
                               └─ no edge back to effect-resolver.ts
```

This follows the roadmap's preferred boundary with minimal call-site churn.

### 2. Inject planning callbacks into helper functions — rejected

Passing `buildStackEffects`, `revalidateTargets`, and `buildDynamicParams` into reveal and choice
functions would remove the imports mechanically. It would also add callback plumbing to every call,
allow inconsistent helper combinations, and leave the reusable primitives owned by the wrong
module.

### 3. Fold reveal and choice construction into `effect-resolver.ts` — rejected

Inlining both helper modules would remove the cycles, but it would expand an already large
orchestrator and erase two existing cohesive responsibilities. That conflicts with the instruction
to preserve working subsystem boundaries.

## Module responsibilities

### `resolution-planning.ts`

Owns pure planning primitives that do not advance the resolution cursor:

- convert effect definitions to stack effects;
- resolve and revalidate effect targets against a room snapshot;
- evaluate dynamic effect parameters against a room snapshot and stack object.

The implementations move without semantic edits. Their existing dependencies move with them.

### `effect-resolver.ts`

Continues to own orchestration:

- intervening-if evaluation;
- whole-object target/fizzle decisions;
- ordered effect iteration and working-room advancement;
- bounded-reveal expansion and resolution-choice pauses;
- replacement planning and outcome settlement;
- structural zone change and resolution reports.

It imports the three planning primitives and re-exports the same function objects. This preserves
all existing imports from `effect-resolver.ts` while making the actual ownership explicit.

### `bounded-reveal.ts`

Continues to own only the starter's bounded reveal expansion. Its sole ownership change is importing
`buildStackEffects()` from `resolution-planning.ts`.

### `resolution-choices.ts`

Continues to construct and apply serializable resolution choices. It imports the three primitives
from `resolution-planning.ts` and does not depend on orchestration.

## Data flow and compatibility

No resolution data flow changes:

```text
planStackResolution
→ validate the object and effects
→ expand bounded reveal or request a serialized choice when needed
→ resolve one effect against the current working room
→ plan replacements/outcomes
→ advance the cursor or return a continuation
→ apply the structural zone change and publish the resolution report
```

Existing callers may continue importing the three helpers from `effect-resolver.ts`. The facade
re-exports the exact bindings from `resolution-planning.ts`, so there is no wrapper behavior,
duplicated implementation, or second planning path.

## Error handling and invariants

- Invalid or missing targets retain the current filtered/fizzled behavior.
- Unresolved dynamic parameters retain the current `unresolved_parameter` result.
- Unsupported or invalid bounded reveal counts retain the current effect-removal behavior.
- Choice construction and `applyResolutionChoice()` keep their current validation and errors.
- The new module is pure with respect to `GameRoom`; it produces values and never commits state.

## Tests

The test-first boundary contract will prove:

- `bounded-reveal.ts` and `resolution-choices.ts` contain no runtime import from
  `effect-resolver.ts`;
- `effect-resolver.ts` still exports the three public helpers;
- those facade exports are the same function bindings exported by `resolution-planning.ts`.

Existing effect-resolver, bounded-reveal, resolution-choice/continuation, target-group, numeric,
zone-transition, resolution-outcome, engine, and live Socket.IO tests remain the behavioral
regression evidence.

## Documentation

- `ARCHITECTURE.md` will distinguish resolution planning primitives from orchestration.
- `docs/MAP.md` will point resolve-time target planning to `resolution-planning.ts`.
- The architecture audit will retain the original finding and mark the resolver/helper SCC
  resolved in Slice 3.
- The modernization roadmap will mark Slice 3 complete without changing later slice scope.
