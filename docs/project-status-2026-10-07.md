# Project status — 7 October 2026

The project is an MTG-inspired two-player prototype with a substantial engine and client. Accepted verification-gate, terminal-processing and engine-lifecycle fixes are implemented. It is not yet a broadly MTG-faithful engine: priority boundaries, combat arithmetic, mana payment, and continuous-effect lifetimes still have significant gaps. Future work should prioritize rules fidelity, as requested by the project owner.

## Accepted implementation update

- **0.1 complete:** server/client typecheck scripts, supported Node range, CI tests before build, and stale attack UI cleanup. The gate task passed its checks on Node 24.19.0.
- **0.2 implemented and verified:** atomic terminal win/draw outcome, convergent SBA/priority work, post-game rejection, stable deltas and client results.
- **0.4 implemented and verified:** create/join/recovery share initialized engine replacement, replacement releases previous listeners, repeated initialization is safe and disposal is final. Room destruction cancels its grace timer; HTTP server close clears remaining timers and disposes remaining engines. Three lifecycle regressions and focused source-loaded actual-server tests pass for two-client create/join/RPS, ETB/attack/death triggers, destruction/replacement, spell/combat terminal convergence, rejection, responsiveness, reconnect snapshots and shutdown cleanup.
- **Final Milestone 0 gate, 7 October 2026:** 392 tests pass in 34 files; server and client typechecks pass; the production build succeeds on Node 24.19.0. Verification also found and fixed a missing `SET_ATTACKED_THIS_TURN` delta that made a reconnect snapshot disagree with live clients after combat.
- **Retained deferrals:** 0.3 private snapshot projection; general 0.5 factory/injected store/clock/RNG framework, comprehensive match automation and browser harness. Raw snapshots remain available for debugging. Trigger semantics and other broader rules work are unchanged.

The sections below retain the original historical audit of baseline `8d6176c`; baseline failure descriptions are not claims about the current implementation.

## Baseline and verification

- Repository: `sschan39/card-game`, branch `main`.
- Fetched GitHub and fast-forwarded the clean checkout from `1c47eb3` to `8d6176c7c1a99baa84d6923a55c51f1ab55f9ef4` (167 commits). This was the fetched `origin/main` tip. No gameplay changes were made for this assessment.
- Latest commit: 5 October 2026, `feat(triggers): carry the triggering event through to the stack object`.
- Installed the existing lockfile with `npm ci --no-audit --no-fund`; used bundled Node **24.19.0**. The default local Node **22.10.0** is below the engine requirement reported by Vite and its React plugin (`^20.19.0 || >=22.12.0`).

| Check performed on this baseline | Result | What it proves |
|---|---|---|
| Vitest, existing suite | **370 tests pass in 30 files** | Existing engine, server-helper, and client-store expectations hold |
| `npm run build` | **Pass** | Backend TypeScript compiles; Vite bundles the client |
| `tsc --noEmit -p src/client/tsconfig.json` | **Fail: four errors** | Client still references the removed `attack` action; production bundling does not check client types |
| Targeted compiled-module probes | **Seven gaps reproduced** | See findings and saved evidence below; synthetic fixtures are identified |
| Two Socket.IO clients against actual compiled server | **Create/join → RPS → main phase succeeds** | Real network setup works; full snapshots leak opponent cards |
| Browser interaction | **Not exercised during this audit** | No claim of complete UI or end-to-end gameplay verification |

The first sandboxed test run failed on temporary-file renames before collecting tests. The successful unsandboxed rerun above is the suite result. The first local socket probe could not connect inside the sandbox; its successful rerun used local network access. These environment failures are separate from project failures.

Build/test configuration emits a Vite warning about ESM syntax in CommonJS-loaded config files. It is nonfatal on this baseline. There is no CI workflow in `.github` and no configured coverage provider/threshold.

Reproduce with a supported Node runtime on `PATH`:

```powershell
npm ci --no-audit --no-fund
npm test
npm run build
npx tsc --noEmit -p src/client/tsconfig.json
node docs/project-audit/2026-10-07-probes.cjs
```

The probe script/results are retained as the historical `8d6176c` baseline. Its assertions deliberately record broken behavior; terminal assertions now fail as intended after the fix. Use current regression tests for conformance. Evidence: [historical results](project-audit/2026-10-07-results.json) and [historical probe script](project-audit/2026-10-07-probes.cjs).

## How the project works

The active application is `src/server.ts` plus `src/client/`. Root-level JavaScript files and `public/` belong to the earlier prototype. `wrangler.jsonc` still points at the legacy `public` assets; it does not establish a deployment path for the active Node/Socket.IO application.

The intended architecture is sound and should be extended:

1. **Types/library:** raw JSON is normalized into card blueprints, then card instances with UUIDs and mutable state.
2. **Engine:** action handlers validate and propose `GameMutation[]`; `GameEngine` applies them through the immutable `gameReducer`. It owns the phase director, action service, events, and state-based checks.
3. **Server:** Express serves the built client; Socket.IO translates player actions into engine calls. `InMemoryStore` holds authoritative rooms. `SyncService` produces player-filtered deltas and appends a JSONL log.
4. **Client:** React components read Zustand state. Socket listeners apply snapshots/deltas; targeting and combat selections live in client store slices. Some characteristic calculations are shared with the engine.

Important integration constraint: reducers replace the room object. Code must read `engine.roomState` after a mutation batch; an earlier room reference can be stale. Direct setup mutations still exist around RPS/deck dealing, so the application is not wholly reducer-driven.

## What is implemented

Here, **implemented** means code exists and is exercised to the extent described, not that every associated MTG rule is supported.

| Area | Existing capability | Principal source and remaining boundary |
|---|---|---|
| Room setup | Create/join rooms, stable player IDs, RPS, shuffled test decks, starting hands | `server.ts`, `room-factory.ts`; real socket flow verified |
| State architecture | Immutable reducer, mutation batches, action registry, per-room engine | `game-reducer.ts`, `game-engine.ts`; setup mutations and event ordering still need consolidation |
| Turn/priority scaffold | Separate `phase`, `status`, `engineState`; ordered phases; priority token; both-pass resolution | `state-machine.ts`; incomplete turn sequence and response windows |
| Casting/stack | Costs for mana/life, hand-to-stack move, LIFO resolution, spell/activated/triggered stack types | `play-card-handler.ts`, `effect-resolver.ts`; generic activation is not wired |
| Mana abilities | Immediate mana production from supported lands/creatures | `tap-for-mana-handler.ts`; generic payment, richer mana abilities, and drain timing incomplete |
| Targeting | Client selection, cast-time validation, resolve-time existence checks, multi-target data model | `action-validator.ts`, `effect-resolver.ts`, `TargetSelector.tsx`; legality/whole-object resolution incomplete |
| Combat | Batch attackers/blockers, click selection, multiple blockers, flying, trample, creature damage | Combat handlers and `state-machine.ts`; arithmetic, snapshots, assignment choices, and keywords incomplete |
| State-based checks | Lethal creature damage and nonpositive life detection | `state-based-actions.ts`; terminal loop defect and broader checks missing |
| Continuous P/T effects | Pool entries, additive `STAT_DELTA`, +1/+1 counters, end-of-turn cleanup | `card-characteristic-service.ts`, `effect-registry.ts`; `SET_STATS` is ignored and source/duration semantics are incomplete |
| Trigger infrastructure | Working event bus; battlefield discovery; pending-trigger records; event carried on stack objects | `trigger-manager.ts`; runtime initialization and scheduler semantics incomplete |
| Sync/reconnect | Per-player delta redaction, identity remapping, reconnect snapshots, 30-second grace timers | `sync-service.ts`, `reconnect.ts`; snapshots are not redacted; restart recovery absent |
| UI | Rooms, hand, battlefield, stack, targeting, phases, combat selections, log | `src/client`; four client type errors and no component/browser suite |

Recent completed milestones include the TypeScript engine migration, React client, targeting, combat declarations, creature-versus-creature damage, phase-control refactor, and October trigger/ability-model refactors. Reimplementing those foundations would duplicate existing work.

## Confirmed defects and source findings

| ID / priority | Finding | Evidence and consequence |
|---|---|---|
| F01 / P0 | Terminal state-based checks do not converge | At life 0, applying `SET_STATUS gameOver` still yields the identical mutation on the next check. `GameEngine.applyMutations` repeats checks until empty, implying an endless loop at game end. Probe deliberately avoids executing a hanging loop. |
| F02 / P0 | Full snapshots disclose hidden cards | Real post-RPS snapshot received by player 1 contains player 2's **four hand cards and five deck cards**, including definitions and UUIDs. `server.ts` emits unfiltered rooms on join, RPS completion, and reconnect. Delta redaction alone cannot protect these cards. |
| F03 / P0 | Normal join replaces the initialized engine | `createRoom` calls `initRoom`; `joinRoom` constructs another engine without calling it or disposing the old one. Attack-trigger fixture produces 0 stack entries without initialization and 1 with it. Normal gameplay therefore loses trigger listeners on the replacement engine. |
| F04 / P1 | Previous passes survive a new action | After p1 passes, p2 casts an instant fixture, then p2 passes: the new spell immediately resolves instead of waiting for p1. `lastPassedPlayerId` is not reset by stack addition. |
| F05 / P1 | Player combat damage overwrites earlier hits | Two unblocked attackers with power 2 and 3 leave a 20-life defender at **17**, rather than 15. Each `SET_LIFE` starts from the same original life total. Trample shares this arithmetic path. |
| F06 / P1 | Attacker power is frozen at declaration | A declared 1-power attacker with a later +3 power pool entry still deals 1 damage, despite the characteristic service returning 4. `CombatDeclaration.attackerPower` is reused at damage time. Attacker/blocker object snapshots also need removal/control-change reconciliation. |
| F07 / P1 | Numeric mana costs are treated as colorless requirements | `{2}` becomes `{colorless: 2}`. A pool of two red mana is rejected. No payment-choice model distinguishes generic requirements from explicit colorless requirements. |
| F08 / P1 | Resolved spell buffs can immediately become inert | Synthetic +2/+0 spell fixture creates a pool entry, but power stays 1. Pool entries require their source on the battlefield by default; a resolved spell is in the graveyard. Effect existence/duration is conflated with source-zone validity. |
| F09 / P1 | Client typecheck fails | `CardComponent.tsx:71`, `ContextMenu.tsx:47`, `OpponentInfo.tsx:14`, `gameStore.ts:201`: stale `attack` references. Vite still bundles them. |

Additional source-only findings, not exercised through a live exploit or complete browser flow:

- `resolve_stack` calls resolution directly without verifying room membership or waiting for both players to pass. `end_turn` checks the active player and stack, but can skip response windows even when that player lacks priority. The central socket boundary lacks a common membership/status/payload guard.
- `TURN_SEQUENCE` has no upkeep or postcombat main phase; draw, combat damage, end combat, end step, and cleanup auto-advance. Declaring attackers/blockers immediately advances the phase. Rich response timing is therefore absent.
- Lands use the spell-casting path and stack; there is no land-play counter. Opening hands are four cards, decks are nine-card fixtures, and the starting player draws immediately. These are prototype/custom defaults, not a configurable MTG rules profile.
- Generic `activateAbility_*` actions appear in options, but no runtime handler exists. Action IDs identify effects rather than distinct abilities, so a card with two abilities using the same effect cannot be addressed reliably.
- Costs model discard, tap, and sacrifice, but the spell proposal pays only mana and life. Condition `globalFlag` handling is commented out. More complete costs need choices and atomic payment.
- Target revalidation mostly checks object existence. It does not repeat all controller/type/permission checks. Effects fizzle independently; the spell's structural destination is applied first. That is insufficient for whole-spell target legality.
- Trigger discovery matches event names and scans all battlefield cards, without source-versus-watcher predicates, life-gain direction, APNAP ordering, target/mode choices, or deferred insertion at priority checkpoints. `triggeringEvent` is stored but not read by resolution. Leave events are only emitted for battlefield-to-graveyard moves; death events are emitted for noncreature permanents too.
- `SET_DAMAGE` events report the resulting marked damage, not necessarily the newly dealt amount. There is no shared damage/prevention/replacement pipeline for players and permanents.
- `ModifierRegistry` always allows actions/targets; `ModifierPipeline` returns its input unchanged and is not called by the current resolver. They are placeholders, not implemented rules systems.
- The characteristic resolver only sums stat deltas/counters. No effective keywords, control/type changes, layer dependencies, or operational `SET_STATS` exist. `GRANT_STATS` always creates end-of-turn effects; true static-ability sourcing/attachments are absent.
- Zone moves preserve UUID and most prior state; there is no zone-object generation model. Exile/command zones and tokens are absent. Source snapshots and last-known information need explicit semantics.
- Empty-library draws silently do nothing. No general outcome record, concession, simultaneous-result handling, or comprehensive terminal action guard exists.

These observations explain why a green unit suite cannot establish rules fidelity.

## Content and unfinished systems

The active JSON contains **seven definitions**: rock, paper, scissors, Empire Servant, red land, Crimson Hellkite, and Broken Fireball. The default nine-card deck uses Servant, land, and Fireball; Hellkite is outside it. There are no activated non-mana executions, counterspell cards, graveyard/search/reveal choices, operational attachments, token creation, or production deck construction.

The older ST01A plan describes 24 custom cards and mechanics such as Scorch, chain prevention, reveal-related casting, discard costs, equipment, and once-per-turn limits. Those requirements remain relevant as a content backlog, but their old engine status markers are not authoritative. Scorch and chain prevention should be documented as custom mechanics layered on the engine rather than presented as MTG rules.

Persistence is in-memory; Mongoose is a dependency with no active integration. JSONL deltas are useful diagnostics, but a durable command log, versioned snapshots, replay determinism, and sequence-gap recovery have not been established.

## MTG fidelity direction

Use a versioned rules profile and a conformance catalog. The official rules checked for this audit are effective **25 September 2026**. Prioritize CR 117/500/601–605/608/611–616/704. Land play is a special action (305); pending triggers require priority-boundary scheduling (117.5/603); zone changes require explicit object identity (400). Existing comments citing priority as CR 116 are outdated. [Official Comprehensive Rules](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt).

One design correction matters immediately: modern combat allows the controller to divide damage among blockers. The existing fixed heuristic and lethal-first cap cannot be labeled full combat fidelity. The Foundations update removed damage assignment order; the roadmap should build allocation choices rather than resurrect that obsolete ordering UI. [Wizards' Foundations mechanics](https://magic.wizards.com/en/news/feature/foundations-mechanics).

## Documentation reconciliation

- `current-stub.md` incorrectly calls the event bus a no-op and P/T/death/SBA work missing.
- `ARCHITECTURE.md` labels several flows “Full” despite the defects above, says `SET_STATS` is applied when it is not, and still calls trigger-holder discovery deferred after October's battlefield scan implementation.
- The August deferred-work document includes obsolete materialized `CardState.modifiers` work. Keep the later pool/query architecture.
- Historical test reports saying 317/331/360 passing tests are snapshots; today's verified count is 370.
- The September creature-combat spec's deferred blocker-order UI should be replaced by modern damage allocation requirements.

Treat this report as the current assessment of the pinned baseline and retain older plans for design history. The [implementation plan](implementation-plan-2026-10-07.md) turns these findings into dependency-ordered work with explicit acceptance gates.
