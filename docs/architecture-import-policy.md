# Architecture import policy

This document records the source dependency rules enforced by
`tests/architecture/import-boundaries.test.ts`. The checks protect boundaries that already exist;
they are not a target directory diagram and do not justify moving otherwise cohesive code.

Run the focused gate with:

```powershell
npm run test:architecture
```

The same tests also run as part of the normal Vitest suite.

## Graph scope

The test scans `.ts` and `.tsx` files under `src/` with the TypeScript AST. Repository-relative
paths use `/` separators. Relative imports and the current aliases are resolved:

```text
@engine/* -> src/engine/*
@shared/* -> src/types/*
```

The all-import graph includes type-only relationships. The runtime graph excludes `import type`,
`export type`, and named import/export declarations whose specifiers are all type-only. Runtime
imports include side-effect, default, namespace, mixed named, dynamic, literal `require`, and
external-module import-equals forms.

## Enforced rules

1. The runtime source graph has no cycles, including self-cycles.
2. `src/engine/**` cannot import `src/server.ts`, `src/server/**`, or `src/multiplayer/**`. This rule
   applies to runtime and type-only imports.
3. Transport and multiplayer code cannot import concrete modules under `src/engine/handlers/**`.
   It may call stable engine entry points such as `GameEngine`. This rule also applies to type-only
   imports.
4. Client runtime imports into `src/engine/**` must exactly match the exception register below.

Failures list sorted cycles or `source -> target` edges so the dependency can be located directly.

## Temporary client rule-query exceptions

| Client source | Engine query | Current reason |
|---|---|---|
| `src/client/components/CardComponent.tsx` | `src/engine/card-characteristic-service.ts` | Render effective card characteristics. |
| `src/client/store/combatSelection.ts` | `src/engine/card-characteristic-service.ts` | Evaluate effective combat characteristics. |
| `src/client/store/gameStore.ts` | `src/engine/card-characteristic-service.ts` | Derive effective characteristics for projected state. |
| `src/client/targeting.ts` | `src/engine/ability-effects.ts` | Evaluate targeting rules already shared with the engine. |
| `src/client/targeting.ts` | `src/engine/card-characteristic-service.ts` | Evaluate effective characteristics during target selection. |

These five edges are existing read-only rule queries, not permission for general client-to-engine
coupling. They remain until a demonstrated shared projection/query boundary can replace them.
Type-only client imports from engine contracts are not runtime exceptions.

The assertion uses exact equality: adding an edge fails, and removing an edge also fails until this
register and the test allowlist are updated. For an intentional boundary change, update the source,
test, and this document together. Do not add an allowlist entry solely to make the gate green.

## What this policy does not enforce

The test does not ban every cross-directory import or require a speculative package hierarchy.
TypeScript compilation, behavior tests, and architecture review remain responsible for broader
correctness. A new rule belongs here only after the repository demonstrates a stable ownership
boundary worth preserving.
