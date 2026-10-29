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

The test scans `.ts` and `.tsx` files under `apps/` and `packages/` with the TypeScript AST. Generated `dist/`, `node_modules/`, `.git/`, and `coverage/` directories are excluded. Repository-relative
paths use `/` separators. Relative imports and the current aliases are resolved:

```text
@engine/* -> packages/engine/src/engine/*
@shared/* -> packages/engine/src/types/*
@rules/* -> packages/engine/src/shared/*
@library/* -> packages/engine/src/library/*
@config -> packages/engine/src/config.ts
@client/* -> apps/game-client/*
@server/* -> apps/server/src/*
@card-game/engine/* -> packages/engine/src/*
@card-game/protocol -> packages/protocol/src/index.ts
@card-game/ui -> packages/ui/src/index.ts
@card-game/browser-session -> packages/browser-session/src/index.ts
```

The all-import graph includes type-only relationships. The runtime graph excludes `import type`,
`export type`, and named import/export declarations whose specifiers are all type-only. Runtime
imports include side-effect, default, namespace, mixed named, dynamic, literal `require`, and
external-module import-equals forms.

## Enforced rules

1. The runtime source graph has no cycles, including self-cycles.
2. `packages/engine/src/engine/**` cannot import anything under `apps/server/src/`. This rule
   applies to runtime and type-only imports.
3. Transport and multiplayer code cannot import concrete modules under `packages/engine/src/engine/handlers/**`.
   It may call stable engine entry points such as `GameEngine`. This rule also applies to type-only
   imports.
4. **R-B:** clients cannot import `packages/engine/**`, including type-only imports. Server code may import the engine; the transport entry point remains subject to rule 5.
5. The Socket.IO entry points `apps/server/src/index.ts` and `apps/server/src/application.ts` cannot import `packages/engine/src/engine/**` directly. Multiplayer
   application coordination belongs to `apps/server/src/rooms/room-runtime.ts`; the entry point composes that
   API with transport adapters.
6. Authoritative runtime consumers (`card-factory.ts`, `room-factory.ts`, `game-engine.ts`,
   `mutation-committer.ts`, and `room-runtime.ts`) cannot import `uuid` or call `Math.random`
   directly. UUID and random capabilities enter through `packages/engine/src/shared/runtime-context.ts`, which is
   the only production default owner protected by this focused check.
7. Card content under `packages/engine/src/library/**` cannot import `packages/engine/src/engine/**`, including type-only imports.
   Content normalization and catalog construction may depend on stable contracts in `packages/engine/src/types/**`
   and `packages/engine/src/shared/**`; engine rules may consume the library's public content APIs.
8. Type declarations under `packages/engine/src/types/**` cannot import executable `packages/engine/src/config.ts` or `packages/engine/src/config/**`, including
   type-only imports. Serializable configuration contracts belong in `packages/engine/src/types/**`; runtime
   defaults, validation, and snapshot construction remain in `packages/engine/src/config/`, with `config.ts` as a compatibility entry.
9. **R-A:** no application under `apps/` can import another application. No package under `packages/` can import an application. This applies to runtime and type-only imports.

10. **R-C:** protocol dependencies on the engine must be type-only.

Milestone 5 explicitly checks that the builder and shared UI import no engine/other-app code, and that both the game card wrapper and builder consume the shared UI entry point. R-A also prevents any shared UI dependency on applications. The shared face has no socket/auth/store dependency.

Milestone 6 resolves the browser-session workspace in the graph and checks that it imports no app or engine implementation. Positive edges verify game/builder transport reuse and all frontends' shared navigation use. Browser-session owns public cookie/CSRF/route helpers; auth/API adapters stay app-owned. Server cookies and native storage never enter browser packages.

Failures list sorted cycles or `source -> target` edges so the dependency can be located directly.
The dependency rules use the all-import graph unless explicitly described as runtime-only. The
deterministic-runtime rule scans its exact source list for direct provider access; it does not ban
unrelated observational clocks or client-side identifier generation.

## Client engine exception register

Empty since Milestone 1. Display characteristics, targeting candidates and eligibility now come from the server projection. The architecture tests reject every client-to-engine dependency and every protocol-to-engine runtime dependency.

## What this policy does not enforce

Milestone 3 also checks that only `apps/server/src/stores/sqlite-store.ts` imports `better-sqlite3` at runtime. Migration modules may import its types. The engine, protocol and clients have no runtime driver dependency; storage details stay behind repository interfaces.

Milestone 4 explicitly checks that the admin app imports neither engine code nor another app. Its browser build consumes protocol contracts; configuration/content JSON stays inside its owning workspace. Player/admin builds are also inspected for admin path/storage-key separation.

The test does not ban every cross-directory import or require a speculative package hierarchy.
TypeScript compilation, behavior tests, and architecture review remain responsible for broader
correctness. A new rule belongs here only after the repository demonstrates a stable ownership
boundary worth preserving.
