# Phase 0 Status — Monorepo Restructure (2026-10-25)

Branch: `platform/phase-0-monorepo` (from `main` at `4502758`)
Plan: `docs/platform-plan-2026-10-24.md` — Phase 0 "monorepo restructure (move-only)"

## Completed

### Commit 1 — `bb3d130` (move-only, verified 100% renames)
- `src/engine`, `src/library`, `src/shared`, `src/types`, `src/config.ts` → `packages/engine/src/`
- `src/server.ts` → `apps/server/src/index.ts`
- `src/server/{action-packet,reconnect,room-runtime,state-store,sync-service}.ts` → `apps/server/src/rooms/`
- `src/server/auth/README.md` → `apps/server/src/auth/README.md`
- `src/client/**` → `apps/game-client/**`
- 163 files, 0 insertions/deletions; history preserved (`git log --follow` verified)

### Commit 2 — workspace backbone (this commit)
- **npm workspaces**: root `package.json` declares `["apps/*", "packages/*"]`; packages `@card-game/engine`, `@card-game/server`, `@card-game/client`. Dependencies remain hoisted at root (unchanged set).
- **TS project references**: `tsconfig.base.json` (strict, ES2020); engine + server are `composite` with `module: node16` / `moduleResolution: node16` (TS 6.0 deprecates `node10`); root `tsconfig.json` is solution-style; client uses bundler resolution + `noEmit`.
- **Engine package exports**: `@card-game/engine` → `packages/engine/src` via `"./*": "./dist/*.js"`; server imports use `@card-game/engine/engine/...`, `.../types/...`, `.../shared/...`, `.../config` subpaths.
- **Aliases** (consistent across vite/vitest/tsconfigs): `@engine/`, `@shared/`, `@rules/`, `@library/`, `@config`, `@client/`, `@server/`.
- **Vite**: app-level config at `apps/game-client/vite.config.mts`, `build.outDir = ../server/dist/client` so `express.static(path.join(__dirname, 'client'))` keeps working. Root `vite.config.mts` deleted.
- **Import rewrites**: server (6 files), client (17 files), tests (113 files) → aliases.
- **Architecture enforcement**: `tests/architecture/import-graph.ts` + `import-boundaries.test.ts` updated for new layout; graph walker now skips `node_modules`/`.git`/`dist`/`coverage`; **new R-A rule** enforced: no app→app imports, no package→app imports (16/16 architecture tests pass).
- **Path fixes**: `SyncService` JSONL path now `path.join(__dirname, '..', '..', '..', 'data', 'deltas.jsonl')` (dist moved from `<root>/dist` to `apps/server/dist`).

## Verification state (gate NOT yet green)

| Gate | Result |
|---|---|
| `npm run typecheck` (`tsc -b`) | ✅ PASS |
| `tests/architecture` | ✅ PASS (16/16) |
| `npm test` (full suite) | ❌ **2 files failing: `tests/server/live-routing.test.ts` (49 tests), `tests/server/room-runtime.test.ts` (6 tests)** |
| `npm run build` | ⏳ not run yet (blocked on test gate) |

Latest full run: **112/114 files, 1338/1393 tests passing.**

## Known failures (documented, not fixed)

### 1. `tests/server/live-routing.test.ts` — 49 failures
Root cause (partially fixed): the `setTimeout` spy in `beforeAll` filters stack traces by
`/src[\\/]server[\\/]room-runtime\.ts/` — updated to `/apps[\\/]server[\\/]src[\\/]rooms[\\/]room-runtime\.ts/`,
which fixed the timer-capture assertions, but the suite still fails with:
- `TypeError: Cannot read properties of undefined (reading 'roomState')` — `observed.get(roomId)` returns undefined in `match()` helper (line ~128)
- `AssertionError: expected undefined to be defined`

**Suspected remaining cause**: the `GameEngine.prototype.initRoom` / `handleAction` spies are installed on the
prototype *before* `await import('@server/index')`. The server now resolves `GameEngine` through the
**workspace symlink** (`node_modules/@card-game/engine` → `packages/engine`), while the test imports it via the
`@engine/` alias (direct path). If vitest resolves these as **two distinct module instances**, the spies patch a
different object than the one the server uses, so `observed` never gets populated. Fix direction: make the test
import `GameEngine`/`EventBus` from `@card-game/engine/engine/...` (same specifier the server uses), or add a
vitest alias `@engine/` → the package name so both resolve to one module instance.

### 2. `tests/server/room-runtime.test.ts` — 6 failures
`AssertionError: expected "info" to be called with arguments: ['rps:resolved', ...]` and
`expected "dispose" to be called N times, but got 0` — same class of problem: `vi.mock`/spy targets not
matching the module instance the server code loaded. Likely same fix as #1.

## Incidents during the restructure (resolved)

1. **Windows file locks** blocked directory `git mv` — solved with per-file `Move-Item` + `git add -A` (rename detection by content).
2. **PowerShell 5.1 `Set-Content` encoding corruption** — the first client-import rewrite used `Get-Content`/`Set-Content`, which mangled UTF-8 Chinese card names into `?` (parse error in `PhaseBar.tsx`). Fixed by restoring all client sources from HEAD and redoing the rewrite with `[System.IO.File]::ReadAllText/WriteAllText` (UTF-8 safe). **Lesson: never use `Set-Content` for source rewrites on this repo.**
3. **Two files wiped to 0 bytes** by locked-file write failures (`targeting.ts`, `GameLog.tsx`) — restored from HEAD and re-edited.
4. **`vi.mock` path specifiers** (`vi.mock('../../src/client/socket', ...)`) were not covered by the `from '...'` rewrite patterns — fixed with a second pass.
5. **Boundary tests reading source from disk** (`readFileSync(resolve(process.cwd(), 'src/engine/...'))`) — repointed to `packages/engine/src/engine/...`.

## Remaining work to close Phase 0

1. Fix the module-dual-instance problem in `live-routing.test.ts` / `room-runtime.test.ts` (see above).
2. Run `npm run build` (engine `tsc -b` + client vite build) and fix fallout.
3. RPS smoke flow through the built server (`npm run dev` + two browser tabs) per plan §0.8.
4. Update docs: `docs/architecture-import-policy.md` (graph scope, alias list, R-A rule, exception register paths), `ARCHITECTURE.md` §2 directory map, `docs/MAP.md`, `deploy/README.md` (dist paths now `apps/server/dist`).
5. Final commit + merge decision per plan acceptance gate: "`npm run verify` exits 0 with the same test count as before the move."

## How to run

```powershell
npm install          # once, to link workspaces
npm run typecheck    # tsc -b (engine + server)
npm test             # vitest run (all 114 files)
npm run build        # engine tsc -b + client vite build
npm run dev          # build:server && node apps/server/dist/index.js
```
