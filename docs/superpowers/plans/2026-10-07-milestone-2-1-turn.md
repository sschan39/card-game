# Ordinary Turn Structure Implementation Plan

> Execute inline with failing regressions and independent read-only review.

**Goal:** Implement the approved 2.1 scope on the existing branch.
**Architecture:** Shared turn helpers identify main phases and declaration owners. StateMachine plans one live step; GameEngine gates declaration decisions and priority windows. Player commands confirm declarations or pass toward combat. Applied phase events drive existing triggers. Client controls reflect declarations separately from priority.
**Tech Stack:** TypeScript, React, Vitest, Socket.IO.

- [x] Add tests/engine/ordinary-turn.test.ts: full transcript, no-attacker combat, response windows, both main-phase timing, upkeep/end triggers and Enter Battle opponent response; observe failures.
- [x] Add src/shared/turn-utils.ts; extend src/types/game.state.types.ts and game-event.types.ts. Update state-machine.ts, game-engine.ts, player-commands.ts, action-validator.ts, declaration handlers, applied-events.ts and trigger-manager.ts.
- [x] Update PhaseBar/CardComponent/CombatDisplay so decisions belong to the appropriate actor, completed declarations do not expose selection controls, and labels show both main phases.
- [x] Migrate state-machine, combat, progression and server tests to explicit passes; verify real socket turn progression and indexed delta replay.
- [x] Run complete tests, both typechecks, build and review; resolve findings, update roadmap, commit.

## Completion evidence

Full suite: 520 tests in 42 files. Server/client TypeScript checks and production build pass. Independent read-only review found no important implementation bugs and identified three accidentally omitted cleanup tests; all three were restored. A real socket transcript verifies both clients through zero-attacker combat, postcombat main, end, next upkeep/draw/main. No new config settings.
