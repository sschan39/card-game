# Milestone 4 completion report

Audited 8 October 2026 against Milestone 4 in [the roadmap](../implementation-plan-2026-10-07.md), the [engine design](../superpowers/specs/2026-10-08-milestone-4-engine-design.md), and the [implementation plan](../superpowers/plans/2026-10-08-milestone-4-engine.md). Baseline: `bc4826c`, the completed Milestone 3 implementation.

**Result: Milestone 4 engine requirements and integration gates are complete.** Trigger definitions now distinguish event subjects and controllers, scheduling preserves player decisions, and resolution can use event values, delayed registrations, and current-turn history. The existing reducer, event pipeline, rules checkpoint, and choice protocol remain the integration boundaries.

The owner's engine-only instruction governs this milestone: no named-card implementation, catalog addition, or client component was added. New scenarios use synthetic definitions on cloned factory objects. Server scenarios operate the actual source server with two Socket.IO clients and the existing client delta reducer. Browser interaction and new UI controls are outside this accepted scope.

## Requirements and inspected evidence

Implementation paths below are under `src/engine/` unless qualified; engine scenarios are under `tests/engine/`. Server scenarios are in `tests/server/live-routing.test.ts`.

| Requirement | Implementation | Executable evidence |
|---|---|---|
| 4.1 Preserve read-only discovery and separate coordination | `discoverTriggers` returns records; `TriggerManager` queues mutations; `GameEngine` and the checkpoint control insertion and priority | `trigger-manager.test.ts`, `trigger-scheduling.test.ts`, `rules-progression.test.ts` |
| Self, another, and watcher semantics | `trigger-matching.ts`, `types/card.types.ts`; card events default to self, explicit watchers select another/any | `trigger-matching.test.ts`: self/another, legacy entry isolation, original zone revision; server self-entry versus another-creature entry |
| Controller/opponent, type and subtype predicates | Declarative `TriggerFilter`; normalization retains authored definitions | `trigger-matching.test.ts`: controller/opponent, creature/subtype, normalization |
| Departing witnesses and source information | Shared preceding battlefield for simultaneous SBA departures; snapshots retained for queued objects and delayed registrations | `applied-events.test.ts`, `source-information.test.ts`; server simultaneous dying witnesses |
| 4.2 Canonical cast, draw and discard events | `applied-events.ts`; explicit MOVE_CARD reasons in cast, draw, and discard producers | `trigger-events.test.ts`: successful cast only, semantic versus generic moves; server committed draw/discard/history scenario |
| Life gain/loss and actual incremental amounts | Positive semantic gain/loss events derived from applied life changes; damage events retain actual increments and source snapshots | `trigger-events.test.ts`: gain/loss, damage versus loss, departed/returned source attribution; server gain/loss amounts 3 and 2 |
| All supported battlefield departures; creature-only death | Applied MOVE_CARD notifications distinguish leave from creature-to-graveyard death; minimal exile storage integrates movement, source lookup, choices and deltas | `trigger-events.test.ts`: noncreature graveyard, bounce, exile, reset identity and exact delta replay; server hand/exile/graveyard routes and reconnect |
| Combat declarations/damage, upkeep and end step | Typed block, attack, damage and step events; combat step ownership is retained | `trigger-events.test.ts`: completed block declaration and combat completion after damage/history; `ordinary-turn.test.ts`: upkeep/end; existing server attack/death/combat scenarios |
| 4.3 Accumulate triggers until the checkpoint after SBAs | Room-owned trigger queue; ordinary pending mutations remain separate; checkpoint settles SBAs before scheduling | `applied-events.test.ts`, `rules-progression.test.ts`; server lethal simultaneous batch reaches ordering with an empty battlefield |
| Active/nonactive player order and chosen order within each group | `trigger-scheduler.ts` uses stable APNAP grouping and bottom-to-top ordering choices | `trigger-scheduling.test.ts`: discovery order differs from stack order; server mixed-controller selected order |
| Modes, every target group and announced divisions | Scheduler reuses mode, target-group and distribution planners; impossible required choices drop an unschedulable trigger | `trigger-scheduling.test.ts`: modes, multiple groups, exact divisions, invalid allocation rollback, impossible targets |
| Persistent choices and correct priority gating | Queue, selections and choice continuations are plain room data; reducer/sync cases cover them; unrelated actions are blocked while choosing | `trigger-scheduling.test.ts`: wrong owner, blocked pass, serialized ordering/target recovery; server reconnect restores ordering, modes and targets with debug off |
| 4.4 Consume triggeringEvent during resolution | `effect-resolver.ts` reads `DYNAMIC:event.*`, including incremental amounts and departure snapshots | `trigger-conditions.test.ts`: event amount despite later life change, departed subject power |
| Intervening conditions at discovery and resolution | Serializable comparison/all/any/not evaluator with source, controller, event and history contexts | `trigger-conditions.test.ts`: false at discovery, becomes false on stack, combined predicates |
| Optional may effects | Existing resolution choice protocol is reused by triggered objects | `trigger-conditions.test.ts`: yes/no after serialized recovery; server delayed optional trigger reconnect and owner answer |
| Invalid dynamic event data cannot corrupt state | Unresolved dynamic parameters skip the instruction with a typed resolution result | `trigger-conditions.test.ts`: missing event field leaves life unchanged and records `unresolved_parameter` |
| 4.5 Generic delayed registrations and lifetimes | `CREATE_DELAYED_TRIGGER`, reducer add/remove operations, engine-assigned registration IDs; once, end_of_turn and permanent lifetimes | `delayed-history.test.ts`: two unique registrations, one-shot consumption within a batch, cleanup expiry, permanent repetition |
| Delayed triggers survive departure and recovery | Registration owns controller, definition and source snapshot; zone movement refreshes departure information | `delayed-history.test.ts`: exile/serialization and changed departure power; server register, exile, ordinary end step, optional resolution and reconnect |
| Per-turn trigger/activation/mana limits | Shared use keys include source UUID, zone revision and ability ID; trigger reservations carry turn identity; transactional activation/payment previews enforce limits | `delayed-history.test.ts`: repeated triggers in one batch, turn crossing, repeated activation after recovery, mana payment rollback, rejected/canceled announcements; server activation rejection and trigger reset on the next ordinary turn |
| Event-derived turn history and usage predicates | Semantic history persists counts/events; all successful uses are recorded; event-time contexts include earlier events and pending uses, with shared history for simultaneous deaths | `delayed-history.test.ts`: draw condition, no future draw visibility, current/simultaneous deaths, unlimited uses, earlier-event use predicates and reset |
| Serialization, delta replay and extensible logging | New state is plain data; explicit reducer-to-delta mappings replay queue, registrations and history; semantic events use the existing generic batch logging path | `delayed-history.test.ts`: exact full-room delta equality; server equality of stack/history/registration state and recovered choices; existing sync/logger regressions |

## Milestone gate

Every named gate has engine and actual-server evidence:

| Gate | Engine scenarios | Actual-server scenarios |
|---|---|---|
| Own entry versus another creature's entry | `trigger-matching.test.ts` | `separates self-entry from another-creature entry through socket casting` |
| Gain versus loss | `trigger-events.test.ts` | `routes committed life/draw/discard events and event-history predicates to both clients` |
| Noncreature graveyard movement | `trigger-events.test.ts` | `routes leave to graveyard without a false noncreature death` |
| Bounce/exile | `trigger-events.test.ts` | Parameterized hand/exile leave and reconnect scenarios |
| Simultaneous deaths | `applied-events.test.ts`, `delayed-history.test.ts` | `retains simultaneous dying witnesses before scheduling their triggers on the server` |
| Mixed-controller order | `trigger-scheduling.test.ts` | Mixed-controller ordering/modes/targets scenario |
| Optional/targeted triggers | `trigger-conditions.test.ts`, `trigger-scheduling.test.ts` | Mixed-controller target choice and delayed optional resolution scenarios |
| Delayed end-step effects | `delayed-history.test.ts` | `creates a delayed optional end-step trigger, retains departure information and resumes it after reconnect` |
| Once-per-turn abilities | `delayed-history.test.ts` | Repeated activation rejection; `enforces a once-per-turn trigger across socket resolutions and resets it on the next ordinary turn` |

## Final verification

On bundled **Node 24.19.0**, after the final runtime edit:

- `node node_modules/vitest/vitest.mjs run`: **669 passed, 57 files, exit 0**. The actual-server file contains **26 passing scenarios**. Milestone 3's baseline had 614 tests in 52 files.
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`: **exit 0**.
- `node node_modules/typescript/bin/tsc --noEmit -p src/client/tsconfig.json`: **exit 0**.
- `npm run build`: **exit 0**, TypeScript compilation and Vite production build.
- `git diff --check`: **exit 0**.

Independent read-only review reproduced missing source attribution/step ownership and chronological-history issues. Red regressions preceded their fixes. Follow-up checks confirmed departure snapshots, exact delta replay, simultaneous death conditions, turn-scoped reservations, and prior-event ability-use predicates. The final review reported no remaining finding in the changed scope.

## Boundaries and follow-on work

Full private client projection remains deferred under the owner's Milestone 0.3 decision. Existing opponent hand deltas expose a hand count, while snapshots and new event/queue/history data still carry authoritative information for debugging. This report does not claim private-state isolation.

History is current-turn engine state, not a durable replay/database service. Delayed lifetimes cover the authored once/end-of-turn/permanent schema; richer durations and rules profiles remain extensible follow-on work. Exile support here is the minimal movement/reference infrastructure required by this milestone, not comprehensive exile card-family mechanics.

No new configuration switch was needed. Ability filters, conditions and limits are authored rules data; actual configuration remains centralized in `src/config.ts`. Deferred Milestone 2 action economy/cleanup work, combat and unified damage, broader layers/permissions, replacement/prevention, catalog expansion and browser coverage retain their roadmap scope.
