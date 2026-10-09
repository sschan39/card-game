# Milestone 6 Effects Implementation Plan

> **For agentic workers:** Use executing-plans task by task, with test-driven-development.

**Goal:** Complete Milestone 6 continuous/static effects and permissions.

**Architecture:** Serializable effect definitions feed a shared pure board evaluator. Resolved effects retain fixed references; static effects are derived from applicable abilities. Engine/client consumers use effective characteristics and shared permissions.

**Tech Stack:** TypeScript, Vitest, Socket.IO, React.

## Global constraints

- Engine first; no new named cards or client components.
- Keep stable card UUIDs and zone revisions.
- Keep settings centralized if any setting is necessary.
- Existing checkout and branch; local commit on completion.

## Task 1: characteristic layers

- [x] Add generic layer types, static abilities and defining expressions in `src/types/card.types.ts` and `src/types/continuous-effect.types.ts`.
- [x] Add failing scenarios in `tests/engine/continuous-layers.test.ts`: 2/4 base -> set 3/5 -> +2/+1 -> +1/+1 counter -> switch = 7/6; type/control/color/ability changes, copy, timestamps, dependencies, defining counts, dynamic static sources and lost abilities.
- [x] Run targeted Vitest and confirm missing behavior.
- [x] Implement pure board evaluation in `src/engine/characteristic-layers.ts`, source/scope helpers in `src/engine/continuous-effects.ts`, facade in `src/engine/card-characteristic-service.ts`.
- [x] Run targeted suite and typecheck.

## Task 2: effect lifetime and production

- [x] Test source departure, frozen recipients versus later entrants, individual IDs, cleanup, both source and target revisions, serialized effects and generic primitives.
- [x] Normalize effect metadata in reducer/engine, replace blanket source removal with exact lifetime handling, implement generic continuous-effect creation and SET_STATS.
- [x] Run affected engine suites and inspect sync convergence.

## Task 3: effective consumers and permissions

- [x] Test shared effective structural targeting, hexproof/shroud/protection, flash, prohibitions, ability removal/gain, control, combat and resolution revalidation.
- [x] Route engine and existing client queries through the facade; preserve last-known effective characteristics.
- [x] Implement shared permission evaluator, integrate cast/activation/mana and displayed options.
- [x] Run engine/client tests and typechecks.

## Task 4: integration and completion

- [x] Add actual-server scenarios and serialization/delta/client agreement assertions.
- [x] Review implementation against every roadmap requirement and add missing regression evidence.
- [x] Run full Vitest, both typechecks, production build and diff check.
- [x] Write `docs/project-audit/milestone-6-completion.md`, update roadmap, commit and report.
