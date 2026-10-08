# Combat engine implementation plan

> Execute inline with executing-plans and test-driven-development. Existing branch/check-out is the user's chosen workspace.

**Goal:** Implement engine combat with manual damage decisions and open keyword extension seams.

**Architecture:** Combat planning remains pure and produces persisted choices and atomic damage batches. GameEngine owns continuation and checkpoints. Declaration snapshots retain debug information and supply revision-aware participant references.

**Tech stack:** TypeScript, Vitest, existing reducer, Socket.IO and choice protocol.

## Global constraints

- Engine only. No new card mechanics or keyword consumers.
- No allocation heuristic. Every positive assignment with recipients is player selected.
- Preserve existing Flying/Trample behavior through adapters.
- Keep settings centralized in src/config.ts if any are actually necessary.

### Task 1: participant state and declaration extension seams

Files: src/engine/combat-state.ts, src/engine/combat-rules.ts, src/engine/card-characteristic-service.ts, src/engine/handlers/declare-{attackers,blockers}-handler.ts, src/engine/game-reducer.ts, src/types/effect.types.ts; tests/engine/combat-state.test.ts.

- [x] Write tests for blink removal, controller changes, explicit blocked status after blocker removal, live declaration legality, and a synthetic whole-declaration restriction. Expected: stale participants are removed and an arbitrary registered restriction rejects without writes.
- [x] Run `node node_modules/vitest/vitest.mjs run tests/engine/combat-state.test.ts` and observe missing behavior.
- [x] Add `reconcileCombat(room): GameRoom`; keep snapshots immutable and make removed participation permanent. Add `CombatRuleRegistry.register(rule): () => void`, live keyword queries, and whole-declaration hooks; route Flying through a built-in adapter.
- [x] Run the new tests and declaration/reducer regressions; resolve failures before proceeding.

### Task 2: shared atomic damage

Files: src/types/damage.types.ts, src/engine/damage-service.ts, src/types/game-mutation.types.ts, src/engine/game-reducer.ts, src/engine/applied-events.ts, src/engine/effect-registry.ts; tests/engine/damage-pipeline.test.ts.

- [x] Write tests for two sources damaging one recipient, retained source attribution, simultaneous lethal damage, zero/negative amounts, proposal transformation and consequence hooks, and life-loss separation.
- [x] Observe expected failures with `node node_modules/vitest/vitest.mjs run tests/engine/damage-pipeline.test.ts`.
- [x] Define `DamageAssignment` with source snapshot, typed recipient, amount, combat flag. Add `planDamage(room, assignments): GameMutation[]` and an atomic `APPLY_DAMAGE_BATCH` reducer mutation. Derive each event against the entire damage batch and retain per-source information. Route effect damage through this service.
- [x] Run targeted pipeline and applied-event/source-information tests.

### Task 3: manual decisions and engine continuation

Files: src/types/combat.types.ts, src/types/choice.types.ts, src/types/game.room.types.ts, src/engine/combat-service.ts, src/engine/game-engine.ts, src/engine/state-machine.ts, src/engine/applied-events.ts; tests/engine/combat-choices.test.ts, existing combat/turn/event tests, tests/server.

- [x] Write engine tests entering damage via both priority passes; assert pending distribution choice and no damage/priority until allocation. Test arbitrary multi-block splits, overassignment, Trample constraints, choice ownership/staleness, saved-room resume, and registered extra passes.
- [x] Observe missing choices with `node node_modules/vitest/vitest.mjs run tests/engine/combat-choices.test.ts`.
- [x] Persist requests/allocations/pass position as `CombatDamageState`. Use combat choice continuations to collect each source's full allocation and validate against live state. Submit all assignments as one shared damage batch, then mark the pass complete and settle checkpoints. Move damage calculation out of StateMachine.
- [x] Update existing tests to explicitly supply allocations instead of asserting a removed heuristic. Keep named-card catalog unchanged. Add real server coverage through the existing choose protocol and deltas.
- [x] Run all tests, server/client typechecks, production build and diff check. Audit every spec requirement; record evidence and update roadmap/completion report.
