# Workspace Architecture — Supplement to ARCHITECTURE.md

**Updated:** 28 October 2026

**Status:** Current workspace, protocol, authentication and persistence architecture

This supplement describes the build, runtime, typechecking, and test boundaries introduced by the workspace restructure. [ARCHITECTURE.md](../ARCHITECTURE.md) remains the reference for game behaviour and subsystem ownership; the [concept map](MAP.md) locates individual rules and flows. Acceptance evidence is recorded in the [Phase 0 report](phase-0-status-2026-10-25.md) and [Milestone 1 report](phase-1-status-2026-10-26.md).

## 1. Workspace and artifact ownership

| Workspace or directory | Owns | Consumed by |
|---|---|---|
| `packages/engine/src/` (`@card-game/engine`) | Rules, card catalog, shared helpers, configuration, serializable contracts | Server and tests |
| `packages/protocol/src/` (`@card-game/protocol`) | Player DTOs, commands/events, versions and presentation helpers; type-only engine dependencies | Server, clients and tests |
| `apps/server/src/` (`@card-game/server`) | Express/Socket.IO composition and room lifecycle, identity mapping, synchronization | Node server build and server tests |
| `apps/game-client/` (`@card-game/client`) | React components, Socket.IO client, Zustand state and UI interactions | Player build and client tests |
| `apps/admin/` (`@card-game/admin`) | Separate admin login, room/log/account/config pages | Admin build and focused client logic/render tests |
| `apps/deck-builder/` (`@card-game/deck-builder`) | Public catalog/editor, game-account saves and ID-only game handoff | Independent builder build and focused logic/render tests |
| `packages/ui/src/` (`@card-game/ui`) | Printed `CardSurface` and stylesheet; React-only | Player and builder builds |
| `tests/` | Existing engine, server, client, library, shared and architecture scenarios | Four Vitest projects; files stay at the repository root |
| `build/types/` | Generated declarations and incremental TypeScript metadata | TypeScript project references only; ignored by Git |
| `apps/server/dist/` | Executable server bundle, including engine code | Node at runtime; ignored by Git |
| `apps/game-client/dist/` | HTML, CSS and browser JavaScript | Express static serving; ignored by Git |
| `data/deltas.jsonl` | Runtime diagnostic/replay log | SyncService; ignored by Git |
| `data/card-game.sqlite` and WAL/SHM files | Durable accounts, hashed sessions and owned decks | Server-only SQLite adapter; ignored by Git |

There is one backend process. Phase 0 established workspace ownership; Milestones 1–3 added private player views, scoped authentication and persistent accounts/decks. Milestone 4 added owned configuration/content folders and the independent admin application/API/audit boundary. Milestone 5 adds the independent deck builder and shared card face. Security-lab infrastructure remains governed by its own plan. See [configuration ownership](configuration-architecture.md), [admin architecture](admin-architecture.md) and [deck builder](deck-builder-architecture.md).

## 2. Build and runtime flow

```mermaid
flowchart LR
    E["packages/engine/src"] --> SB["Vite server build"]
    S["apps/server/src"] --> SB
    SB --> SD["apps/server/dist/index.js"]
    P["packages/protocol/src"] --> CB["Vite client build"]
    P --> SB
    C["apps/game-client"] --> CB
    CB --> CD["apps/game-client/dist"]
    A["apps/admin"] --> AB["Vite admin build"]
    P --> AB
    AB --> AD["apps/admin/dist"]
    U["packages/ui / shared card face"] --> CB
    U --> DB["Vite builder build"]
    P --> DB
    W["apps/deck-builder"] --> DB
    DB --> DD["apps/deck-builder/dist"]
    N["One Node process"] -->|executes| SD
    N -->|serves static files| CD
    N -->|serves /deck-builder/| DD
    N -->|loads| D["Third-party runtime dependencies"]
    B["Player browsers"] <-->|Socket.IO| N
```

`@card-game/engine/*` exports `./src/*.ts`. The server Vite configuration bundles this internal package and emits CommonJS for the supported Node runtime; third-party dependencies remain external. Production Node executes the resulting JavaScript, so it does not require a TypeScript loader or an engine JavaScript build. Argon2 and better-sqlite3 remain native runtime dependencies; the server-only blocklist and numbered migration definitions are bundled with server code. Native binaries must match the deployment host and Node runtime.

The client Vite configuration consumes protocol sources and emits a separate browser build. Client engine imports are forbidden; the exception register is empty. Protocol engine dependencies must be type-only. Auth REST schemas are shared through protocol, while password and session implementation remain server-only.

The compiled server resolves the player and builder as `../../game-client/dist` and `../../deck-builder/dist` relative to `apps/server/dist`. Its delta-log path resolves three levels up to repository `data/deltas.jsonl`. These lookups use the server bundle's directory rather than the caller's working directory. Keep the application output directories in this relative layout when deploying. Admin production hosting remains independent.

## 3. Typechecking and clean builds

The root `tsconfig.json` references engine, protocol, UI, server, player, admin and builder. Server references engine/protocol; all frontends reference protocol; player/builder also reference UI. Protocol references engine for types; UI depends only on React.

- Engine, protocol, UI and server are composite projects with declaration-only emission under their respective `build/types/` directories.
- Player, admin and builder are composite, no-emit projects; their incremental metadata is also under `build/types/`.
- Shared strict compiler options live in `tsconfig.base.json`.
- `tsc -b` orders referenced projects. The per-app typecheck commands also use build mode, so referenced declarations are generated when absent.
- Vite produces executable JavaScript. TypeScript declaration outputs are not runtime artifacts and cannot select an old JavaScript engine implementation.

This separates typechecking artifacts from executable builds while preserving plan decision D2: internal packages export source, with no per-package JavaScript `dist` to maintain.

## 4. Test projects and module identity

| Vitest project | Test scope | Configuration |
|---|---|---|
| `engine` | `tests/engine`, `tests/library`, `tests/shared` | `packages/engine/vitest.config.mts` |
| `server` | `tests/server` | `apps/server/vitest.config.mts` |
| `client` | `tests/client` player/admin/builder `.test.ts` and `.test.tsx` | `apps/game-client/vitest.config.mts` |
| `architecture` | `tests/architecture` | `tests/architecture/vitest.config.mts` |

The root configuration composes these projects with the repository as their root. Existing relative fixture paths and `process.cwd()` source checks therefore remain valid. Projects share the alias table in `vitest.shared.mts`; the suite uses four worker threads and preserves ordinary test isolation.

Within a test context, `@card-game/engine/engine/game-engine` and `@engine/game-engine` resolve to the same source file. The same holds for shared configuration and logging aliases. A spy installed by a test therefore observes the class or logger used by the server under test. Before this fix, server package imports selected compiled engine files while tests selected source files; the resulting distinct module instances caused 55 failures.

Tests do not import the production bundle as a substitute for source-level integration coverage. The separate production browser smoke exercises the actual bundle and static-serving layout.

## 5. Dependency boundaries

The AST import graph scans production `.ts` and `.tsx` files under `apps/` and `packages/`, skipping generated and dependency directories. It resolves relative imports and the current engine, shared, rules, library, config, client, server and engine-package aliases.

Phase 0 adds rule R-A: an app cannot import another app, and a package cannot import an app. Runtime and type-only edges are checked. Existing rules still prohibit runtime cycles, engine-to-transport imports, transport access to concrete handlers, card-content access to engine implementations, executable config imports from contracts, and undocumented client rule queries. The authoritative UUID/random boundary remains behind RuntimeContext.

The exact rules, exceptions and enforcement limits are maintained in [architecture-import-policy.md](architecture-import-policy.md). Milestone 1 adds private-view filtering and forbids client engine imports and protocol runtime engine imports. Milestone 2 derives socket identity from scoped sessions before it reaches RoomRuntime. See the [projection supplement](protocol-projection-architecture.md) and [auth supplement](authentication-architecture.md).

## 6. Decision records and trade-offs

| Decision | Reason | Cost or limitation |
|---|---|---|
| Retain npm workspaces and one Node process | Matches the existing dependency system and operating model | No service-level scaling or fault isolation is implied |
| Export internal engine source and bundle applications | Avoids a stale package JavaScript build and keeps tests on the authoritative implementation | Application builds must understand TypeScript; direct Node consumers of the source package need their own compilation strategy |
| Emit declarations centrally for project references | Makes ordered strict checks work from a clean checkout | Typechecks create ignored metadata and declaration files |
| Build client and server into separate app directories | Gives each application ownership of its output | Deployment must retain both directories and their relative layout |
| Share test aliases and keep tests root-scoped | Preserves module identity, fixtures, assertions and history | Changes to aliases must remain consistent with the import policy and application compiler/bundler configuration |
| Preserve the move-only commit | Keeps history traceable and distinguishes relocation from build repair | Phase 0 delivery also needs a follow-up configuration/documentation commit |

## 7. Verification and operation

From the repository root:

```sh
npm ci
npm run verify
npm start
```

`verify` checks all seven TypeScript projects, runs all four test projects including architecture, and builds server/player/admin/builder. CI runs the same sequence through `npm ci` and `npm run verify` on Node 24. Milestone 5 uses focused checks at the user's request, recorded in its report. Individual commands remain available:

| Command | Purpose |
|---|---|
| `npm run typecheck:server` | Check server and its engine reference |
| `npm run typecheck:client` | Check client and its protocol reference |
| `npm run typecheck:admin` | Check admin and its protocol reference |
| `npm run typecheck:deck-builder` | Check builder, protocol and shared UI |
| `npm run test:architecture` | Run the focused import boundary gate |
| `npm test` | Run all root-scoped tests |
| `npm run build` | Build server, player, admin and builder outputs |
| `npm run dev` | Build and start the backend |
| `npm run dev:client` | Serve the player app through Vite on port 5173 |
| `npm run dev:admin` | Serve the admin app at port 5174 under `/admin/` |
| `npm run dev:deck-builder` | Serve the builder at port 5175 under `/deck-builder/` |

Historical Phase 0 verification on Node 24.22.1: clean dependency installation; 1,393 passing tests in 114 files; both production builds; and two-browser create/join, RPS, card play, priority resolution, turn advancement and reconnect. An independent pre-move run passed 1,391 tests; the two added cases enforce R-A. All 7,499 expect expressions across the 113 non-architecture test files were preserved, allowing only relocated filesystem paths. These historical results are not a full-suite claim for Milestone 2, which uses the focused checks recorded in its report at the user's request.

Use the [production RPS smoke checklist](smoke-test-rps.md) to reproduce the browser flow. The [completion report](phase-0-status-2026-10-25.md) contains the detailed acceptance ledger and evidence locations. Hosted CI and Linux deployment have not been executed during this local verification.

## 8. Milestone 1 extension

The protocol workspace uses source exports and declaration-only project references, like the engine. The client references protocol; protocol references engine for types. Vite removes those type-only dependencies from the browser bundle. The five client engine exceptions are now empty. Snapshot/delta projection and wire identifiers live only in the server. See [the projection supplement](protocol-projection-architecture.md) and [verification report](phase-1-status-2026-10-26.md).
