# Checkpoint and Live Phase Progression Implementation Plan

> **For agentic workers:** Execute inline with test-driven regression checks; request a final read-only code review.

**Goal:** Finish Milestone 1.4–1.6 with one rules settlement boundary, correct consecutive passes and authoritative phase stepping.

**Architecture:** `rules-checkpoint.ts` coordinates reducer batches through injected room/apply/queue callbacks. GameEngine owns applied batches, busy/pending gating, resolution completion and the phase loop. StateMachine produces pure one-step plans and pass decisions.

**Tech Stack:** TypeScript, Vitest, existing event batches and delta transport.

## Constraints

- Existing branch; commit completed 1.3 first and this slice after verification.
- Keep `resolve_stack` / `end_turn` lean and preserve event-agnostic logging.
- No new settings unless needed; settings belong in `src/config.ts`.
- Targeting, choice UI and broad identity-type migration remain separate.

## Steps

- [x] Write `tests/engine/rules-progression.test.ts` regressions and confirm failure: observe stack additions only after lethal creatures leave; reject commands during event publication; pass→instant→pass preserves P1 response; debug/normal resolution converge; automatic stepping stops for triggers; combat planning uses live participants.
- [x] Create `src/engine/rules-checkpoint.ts` with `runRulesCheckpoint({getRoom, apply, takePending})`. In `game-engine.ts`, extract `commitMutations()` and run the coordinator after each complete batch. Expose `hasPendingRulesWork`; guard command/priority/phase entry points. Preserve terminal queue disposal and applied batch cause IDs.
- [x] Clear passes on successful proposals before committing costs/effects. Remove duplicate resolution completion from command descriptors and pass routing. StateMachine pass results explicitly request `none`, `resolve` or `advance`; GameEngine executes the continuation after settling.
- [x] Replace `StateMachine.advancePhase()` with `planNextStep()`: one phase and its side effects. GameEngine loops over current room state, stopping at input/stack/terminal. Remove preplanned phase chunk application.
- [x] Add optional combat declaration completion flags, the blocker completion mutation, reducer/delta mappings and descriptor/handler checks. Preserve default immediate advancement; pause when triggers arise. Read live combat participants and accumulate damage/life assignments within a simultaneous step.
- [x] Update old phase-director tests to exercise GameEngine; add live routing and delta replay coverage for interrupted declaration/resolution. Update the roadmap/docs.
- [x] Run targeted and full Vitest suites, both typechecks and build. Request read-only review, fix material findings, rerun affected checks and commit the finished slice.

Verification uses bundled Node with `node_modules/vitest/vitest.mjs run`, both TypeScript project checks and npm `run build`.

## Completion evidence

Implemented all slices on `codex/milestone-0`. Full suite: 511 tests across 41 files. Server and client typechecks and production build pass. Independent review identified a missing lower-level proposal checkpoint guard; fixed it and added reason-specific reentry assertions. No new settings were required.
