# Automated architecture checks design

Date: 20 October 2026
Status: approved under the standing behavior-preserving architecture instruction

## Problem

The first four modernization slices removed the known runtime cycles and clarified several
ownership boundaries, but most of those gains are protected only by focused source-text tests and
manual graph audits. A future import can silently recreate a cycle or invert a layer while all game
behavior tests continue to pass.

The repository already has TypeScript as a development dependency and uses ES import/export syntax
throughout `src/`. The local audit script also demonstrates that the TypeScript compiler API can
distinguish runtime imports from `import type` relationships. Slice 5 should turn that evidence into
a maintained, automatically executed repository policy without adding a dependency or changing
runtime code.

## Goals

- Fail the normal Vitest suite when any runtime import cycle appears in `src/`.
- Prevent engine modules from importing transport or multiplayer modules.
- Prevent transport modules from importing concrete action handlers.
- Restrict client-to-engine runtime imports to the exact, documented rule-query exceptions that
  exist today.
- Distinguish type-only imports and exports from runtime edges using the TypeScript AST.
- Produce deterministic, path-based failure output that tells a maintainer which edge or cycle
  violated policy.

## Non-goals

- No production module moves or gameplay changes.
- No generic dependency-injection, lint, monorepo, or build-graph framework.
- No ban on existing type-only client imports from engine contracts.
- No immediate shared projection API; the five existing client rule-query edges remain explicit
  temporary exceptions.
- No enforcement of every cross-directory import observed by the audit. Only the roadmap's proven
  boundaries become hard policy in this slice.
- No replacement for TypeScript compilation, behavioral tests, or the human architecture map.

## Considered approaches

### 1. Tracked TypeScript AST helper plus Vitest policy tests — selected

Create `tests/architecture/import-graph.ts` as a focused test utility. It will:

- parse imports and re-exports with the TypeScript compiler API;
- classify runtime versus type-only edges;
- resolve relative source imports and the existing `@engine/*` / `@shared/*` aliases;
- build deterministic all-import and runtime graphs using repository-relative paths;
- find strongly connected components with Tarjan's algorithm;
- expose sorted edge and cycle results for readable assertions.

Create `tests/architecture/import-boundaries.test.ts` to apply the repository policy. Because the
file matches the existing Vitest include pattern, every normal test run executes the checks. Add a
`test:architecture` package script for a fast explicit gate.

This keeps test logic out of production code, adds no dependency, and makes the graph parser
directly testable.

### 2. Duplicate the audit script inside one test — rejected

A single large test file would be quicker initially, but graph parsing, path resolution, policy,
and diagnostics would be tangled. Parser regressions would be hard to distinguish from real
architecture violations, and later policies would duplicate setup.

### 3. Shell out to the local `.superpowers` audit script — rejected

The current script is ignored workspace tooling rather than a tracked project artifact. A test
that depends on it would pass locally but be absent in a clean checkout or CI environment. Parsing
its console output would also make the contract less precise than calling typed graph functions.

## Graph model

The graph scans source files under `src/` with `.ts` or `.tsx` extensions. Nodes and
edges use normalized repository-relative paths with `/` separators.

Each parsed dependency contributes to the all-import graph. It contributes to the runtime graph
only when evaluation can load a value:

- side-effect imports are runtime;
- default and namespace imports are runtime;
- named imports/exports are runtime when at least one specifier is not marked `type`;
- `import type` and `export type` are type-only;
- `require('literal')`, `import('literal')`, and external-module import-equals declarations are
  runtime;
- package and Node built-in imports are outside the repository graph.

Relative imports resolve `.ts`, `.tsx`, and `index` candidates. The current aliases resolve as:

```text
@engine/* -> src/engine/*
@shared/* -> src/types/*
```

Unresolved local imports remain a compiler concern rather than being represented as phantom graph
nodes.

## Enforced policies

### No runtime cycles

Tarjan's algorithm runs against the runtime graph. Any multi-node strongly connected component or
runtime self-edge fails with every path in the component. Type-only cycles remain visible to
TypeScript but do not fail this runtime-initialization policy.

### Engine cannot depend on transport or multiplayer

No import edge, including a type-only edge, may originate under `src/engine/` and target:

- `src/server.ts`;
- `src/server/**`;
- `src/multiplayer/**`.

Contracts needed by the engine must live at or below the engine/core boundary rather than in an
outer application layer.

### Transport cannot import concrete handlers

No import edge, including a type-only edge, may originate in `src/server.ts`, `src/server/**`, or
`src/multiplayer/**` and target `src/engine/handlers/**`. Transport may call stable engine entry
points such as `GameEngine`, but it must not assemble rule handlers.

### Client runtime rule-query exceptions are exact

Client runtime imports into `src/engine/**` must equal this temporary allowlist:

```text
src/client/components/CardComponent.tsx -> src/engine/card-characteristic-service.ts
src/client/store/combatSelection.ts      -> src/engine/card-characteristic-service.ts
src/client/store/gameStore.ts            -> src/engine/card-characteristic-service.ts
src/client/targeting.ts                   -> src/engine/ability-effects.ts
src/client/targeting.ts                   -> src/engine/card-characteristic-service.ts
```

Exact equality prevents both unreviewed additions and stale exceptions. Removing an edge is an
architecture improvement, but the allowlist and its documentation must be updated in the same
change. Type-only client imports are not rule execution and do not require an exception.

## Test design

Parser-focused tests will prove that:

- type-only imports/exports appear only in the all-import graph;
- mixed named imports/exports, side-effect imports, dynamic imports, literal `require`, and
  import-equals declarations create runtime edges;
- the existing `@engine/*` alias resolves while its current type-only use remains absent from the
  runtime graph.

Repository-policy tests will prove all four enforced policies. Their failure messages will list
sorted paths or `from -> to` edges, avoiding nondeterministic filesystem ordering.

Test-driven implementation will first add the policy expectations against the current repository;
the test must fail because the graph helper and policy module do not yet exist. The minimal helper
then makes the current clean graph pass. A mutation check will temporarily add a forbidden runtime
edge in an in-memory fixture and verify that the corresponding policy helper reports it, without
modifying production source.

## Documentation

- Add `docs/architecture-import-policy.md` as the maintained human-readable policy and exception
  register.
- Update `ARCHITECTURE.md` to identify the automated gate and link the policy.
- Update `docs/MAP.md` to record the five temporary client rule-query edges as a known rough edge.
- Preserve the audit's historical findings and mark its automated-check recommendation complete.
- Mark Slice 5 complete in the modernization roadmap without changing later slice scope.

## Compatibility and failure behavior

The slice changes only tests, scripts, and documentation. A compliant source graph has no runtime
effect. Violations fail Vitest with deterministic diagnostics; no file is rewritten and no policy
is auto-waived. Updating an intentional boundary requires changing the test allowlist and policy
documentation together in a reviewed architecture change.
