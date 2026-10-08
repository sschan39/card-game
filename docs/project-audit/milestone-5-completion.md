# Milestone 5 completion audit

Scope: the combat engine design approved in chat and recorded in `docs/superpowers/specs/2026-10-08-milestone-5-combat-design.md`. The owner deferred automatic allocation and new combat keyword consumers. No catalog entries, named-card mechanics, new client components or configuration flags were added.

## Requirement evidence

| Requirement | Implementation | Executable evidence |
|---|---|---|
| Persistent UUIDs must not revive departed combat objects | `combat-state.ts` compares declaration snapshot zone revision/controller/type and permanently prunes participation; reducer invokes reconciliation on battlefield/declaration changes | `combat-state.test.ts`: blink removal, controller/revision/type changes and immutable snapshots |
| Blocked remains independent of surviving blockers | Explicit `blocked` field, legacy inference and preservation during pruning | `combat-state.test.ts`; `combat-choices.test.ts`: removed last blocker with/without Trample |
| Use current power/keywords | Characteristic facade and live request construction at each damage pass; live Flying declaration checks | `combat-choices.test.ts`: live/nonpositive power and two nonempty passes; `combat-state.test.ts`: live Flying |
| Manual complete damage assignment | Existing distribution protocol, persisted combat continuation, controller ownership and current choice IDs; full-power/safe-integer/recipient validation | `combat-choices.test.ts`: arbitrary split, overassignment, rejected malformed/stale/wrong-controller answers, real stale plan |
| Existing Trample constraints | Adapter adds player recipient and checks each surviving blocker's lethal threshold | `combat-choices.test.ts`: rejected illegal spillover, overassignment and threshold hook; `combat-damage-step.test.ts`: existing marked damage |
| Simultaneous cumulative damage with source attribution | `APPLY_DAMAGE_BATCH`, shared damage service and per-source applied events; no SBA between recipients | `damage-pipeline.test.ts`: cumulative player damage, mutual lethal board and source/controller attribution; `combat-damage-step.test.ts`: counter-damage and death triggers |
| Shared combat/spell/ability damage; life loss remains distinct | EffectRegistry routes damage through `planDamage`; ordinary life changes remain `SET_LIFE` | `damage-pipeline.test.ts`, existing effect/source-information/trigger/server regressions |
| Open extension seams without new consumers | Combat/Damage rule registries; existing Flying/Trample adapters; keyword query facade | Synthetic permission, pairwise exception, whole-declaration restriction, declaration consequence, pass, participation, recipient, lethal, allocation and shared damage hook tests |
| Hooks must not multiply allocations | Recipient-reference normalization before producing choices | `combat-choices.test.ts`: overlapping recipient extension regression, reproduced as life 20→10 before fix, now 20→15 |
| Reconnectable decisions and pass progress | Room-owned damage state and pending combat continuation | `combat-choices.test.ts`: saved partial allocations and saved pass position; actual server reconnect scenario |
| Priority/checkpoint/trigger timing | GameEngine waits for all assignments, commits damage, derives completion, settles rules and then grants priority | `ordinary-turn.test.ts`, `trigger-events.test.ts`, `combat-damage-step.test.ts`, `combat-choices.test.ts`; actual server flows |
| Keep combat through end-combat responses and clean debug skips | Clear on postcombat main entry and flow skip | `combat-choices.test.ts`: end-combat lifetime and flow debug cleanup |
| Existing UI/protocol can submit decisions; deltas converge | Reuse `ChoicePanel`; explicit atomic-damage and combat-state delta mappings, including automatic participant reconciliation | `live-routing.test.ts`: lethal combat choice and multi-blocker reconnect using real server/socket/client delta reducers |

## Verification

- Full Vitest suite: **693 tests across 60 files**, including **27 actual source-server Socket.IO scenarios**.
- Server and client TypeScript checks.
- Production server/client build.
- Git diff whitespace check.
- Independent code review found overlapping recipient keys; a failing regression reproduced the error before normalization fixed it. Review coverage gaps were filled with nonempty passes, saved pass position, real stale-plan checks, hook behavior and full damaged-board consequences.
- Final independent review found no remaining actionable correctness issues; its focused run passed 34 tests across four files.

The normal engine defaults to one damage pass. Extra passes are available to registered rules; specific First/Double Strike consumers are intentionally deferred, as are new attack/block keyword consumers and Milestone 7 damage keyword behavior. Source metadata and engine seams support their later review. Derived keyword layering remains part of Milestone 6.

The implemented engine pipeline and extension contracts are documented in `docs/combat-engine.md`.
