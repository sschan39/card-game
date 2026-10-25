# Phase 0 Completion Report — Workspace Restructure

**Completed:** 26 October 2026 (Asia/Hong_Kong)
**Status:** Complete; all local acceptance gates passed.
**Branch:** `platform/phase-0-monorepo`
**Scope:** Phase 0 of [`platform-plan-2026-10-24.md`](platform-plan-2026-10-24.md). Game rules, wire payloads, account behaviour, and security-lab implementation are unchanged.

## Outcome

The engine, server, and player app now work as independent npm workspaces. Tests and the server consume one engine source package, eliminating the duplicate source/compiled module instances responsible for the 55 server-suite failures. Vite builds a Node server bundle and a separate player bundle; the root verification command checks every application and the architecture boundaries from a clean dependency install.

## Requirement-by-requirement evidence

| Item | Delivered | Evidence |
|---|---|---|
| 0.1 — Workspace scripts | Root npm workspaces, verify/typecheck/build/start/dev commands; per-app build/dev/start where applicable | `package.json`, application package manifests; clean install and verify passed |
| 0.2 — Engine move | Engine, library, contracts, helpers, config under `packages/engine/src/` | Dedicated move commit `bb3d130`: 163 renames, zero inserted/deleted lines; executable engine source and card data unchanged |
| 0.3 — Server move | Entry at `apps/server/src/index.ts`; room modules under `src/rooms/`; auth README under `src/auth/` | Server source tests and built-server browser flow passed |
| 0.4 — Client move | Existing client and index.html under `apps/game-client/` | Client typecheck/build, client tests and browser flow passed |
| 0.5 — TypeScript projects | Strict shared options; composite engine/server/client projects; applications reference engine | Root `tsc -b` includes all three projects. Declarations/metadata go to ignored `build/types/`; runtime packages export source |
| 0.6 — Workspace test projects | Engine/library/shared, server, client, architecture projects; root-scoped tests retained | Four project configs and shared aliases; 114 files and 1,393 tests passed |
| 0.7 — Architecture policy | App-to-app and package-to-app imports forbidden; existing rules and five client exceptions retained | AST graph scans `apps/` and `packages/`; current aliases and policy documented; architecture gate passed |
| 0.8 — Production layout | `apps/server/dist/index.js` and `apps/game-client/dist/`; Express serves the client; delta log remains at repository `data/deltas.jsonl` | Fresh production build; actual two-tab gameplay/reconnect; deployment paths documented |

## Verification results

Environment: Windows, Node **24.22.1**, npm **11.21.1**, Vitest **4.1.12**, Vite **8.2.2**.

Generated engine JavaScript, application outputs, and TypeScript build metadata were removed before the clean install. Tests do not depend on a prebuilt engine package.

| Gate | Result |
|---|---|
| `npm ci --no-audit --no-fund` | PASS — clean dependency install |
| `npm run verify` | PASS — engine/server/client typechecks, all tests including architecture, both production builds |
| Full current suite | PASS — **1,393 tests across 114 files**, no skipped tests |
| Pre-move suite at `4502758`, run independently in a temporary archive | PASS — **1,391 tests across 114 files** |
| Original failing server suites | PASS — 25 room-runtime + 49 live-routing cases |
| Production browser smoke | PASS — two independently created tabs, actual UI actions |
| `git log --follow` for engine entry | PASS — reaches pre-move commits, including `b476e6d` |
| Move-only commit review | PASS — all 163 entries in `bb3d130` have 0 additions and 0 deletions |
| Source encoding and whitespace | PASS — tracked application/test sources decode as UTF-8; `git diff --check` clean |

The plan’s test-count invariant is preserved for the original suite. The increase from 1,391 to 1,393 is exactly the two mandated R-A checks (app-to-app and package-to-app independence), introduced in the workspace backbone; no gameplay assertions were removed or weakened. The standalone pre-move run verifies the comparison independently.

An AST comparison also verified all 7,499 `expect` expressions across the 113 non-architecture test files: they are identical to the pre-move version after normalising the moved filesystem paths. The focused architecture gate passes all 16 cases.

## Production browser evidence

Ran `npm start` against the built server, serving the separate client build. Through two browser tabs:

1. Created and joined a room; both players received three RPS cards.
2. Played rock versus scissors; the first player won, both clients received five opening cards and seven remaining deck cards.
3. Passed priority through Upkeep and Draw into Precombat Main; the active player had six cards and six remaining deck cards.
4. Played a land without using the stack; activated its mana option; cast a creature with the resulting red mana.
5. Passed priority from both players; the stack emptied and both boards displayed the creature with summoning sickness.
6. Used the existing, explicitly enabled flow-debug End Turn control; the other player reached Precombat Main with six cards.
7. Reloaded the first tab; it rejoined the same room and seat with the land, creature, hand and current turn restored.
8. Checked both browser error logs: no errors.

Local screenshot and full command outputs are retained under ignored `build/phase-0-validation/` (`production-reconnect.png`, `verify.log`, `pre-move-tests.log`). Repeat the human flow using [`smoke-test-rps.md`](smoke-test-rps.md). The checklist now matches the actual phase labels, opening-hand size, mana ability label and debug behaviour.

## Build and test decisions

- **D2 retained:** engine exports point to TypeScript source. Vite bundles engine source into the CommonJS server entry and into client output as needed. There is no per-engine JavaScript build to go stale. Project references emit declaration-only artifacts under `build/types/` for ordered checking.
- A shared Vitest alias table resolves package imports and direct aliases to the same engine files. Four project configurations use the repository root so existing test paths and process.cwd() fixtures stay valid. The suite uses four worker threads.
- The TypeScript solution includes the client. Per-app typechecks build referenced declarations first, avoiding the old clean-checkout missing-output problem. CI uses the same root verify command.
- Repaired invalid UTF-8 in the moved reconnect file and restored damaged comments from the move-only commit; executable behaviour was preserved.
- Updated README, architecture/map/import-policy references, deployment paths, moved documentation links, and smoke commands.
- Added [Architecture Appendix A](../ARCHITECTURE.md#appendix-a-workspace-build-and-verification) and a [Workspace Architecture supplement](workspace-architecture.md) covering source/runtime ownership, build and test boundaries, decision trade-offs and verified operation.

## Delivery and remaining scope

The dedicated move commit remains separate from build/import fixes. Completion is delivered on the existing feature branch for review; merging and remote publication are not part of this local completion. Hosted CI has not been run during this task; its verification command passed locally after a clean install.

No Phase 0 implementation work remains. Platform Phase 1 (protocol/projection), Phase 2 (accounts), and the Linux/security-lab phases remain future work. Existing full snapshots, permissive CORS, client-supplied identity and in-memory rooms were deliberately preserved for their respective phases.
