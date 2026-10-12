# Implementation plan — MTG rules fidelity

**Prepared:** 7 October 2026. **Audit baseline:** `8d6176c`. **Implementation status:** accepted 0.1, 0.2 and 0.4, Milestone 1, the accepted Milestone 2 turn/setup/mana slices, and the approved engine scopes of Milestones 3–7 are implemented and verified. Deferred Milestone 0/2 slices, deferred combat consumers, and Milestones 8–9 remain future work.

The owner's priority is **broader MTG-style rules fidelity**. Build on the existing TypeScript engine, reducer, React client, and tests. First repair demonstrated correctness failures, then implement the foundational rule systems that many cards depend on. This is a staged route to a broadly compatible engine, not a claim that a small card demo represents full MTG coverage.

Evidence and defect IDs are in the [status report](project-status-2026-10-07.md); [baseline probe results](project-audit/2026-10-07-results.json) distinguish runtime reproductions from source-only findings. The existing 370 tests stay as regression coverage, but expectations that encode prototype shortcuts must change when the supported rules profile changes.

Every one of the 57 individual tasks/table rows/bullets now has an [editable development document](development/README.md) with current structure, flow, extension boundaries and remaining acceptance gates. Unnumbered rows receive numbers in their existing order. Documentation coverage includes deferred work; it does not mark that work implemented.

## Target, boundaries, and working method

- Establish a versioned **MTG two-player rules profile**, with a feature/conformance manifest rather than a blanket “Full” label. Pin the initial reference to the official 25 September 2026 rules checked in the audit. Current rule families: 117, 305, 400, 500–514, 601–605, 608, 611–616, 702, 704. [Official rules](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt).
- Keep custom rules explicit: RPS is a valid starting-player selection convention; four-card hands, nine-card fixture decks, Scorch, chain prevention, and any custom casting rules belong to a separate profile. Do not silently apply fixture shortcuts to the MTG profile.
- Each milestone includes the necessary engine state, protocol choices, client controls, real server integration, and rule scenarios. A mechanic whose handler passes unit tests but cannot be chosen or completed through the application is incomplete.
- Retain `GameEngine` as the authoritative entry point, the pure reducer, delta sync, blueprint/instance separation, and on-demand characteristic queries. Introduce small services at meaningful boundaries rather than creating a second orchestrator or rewriting the application.
- Inject randomness, IDs, and clock inputs where replay matters. Make action choices serializable; keep hidden information out of client state.
- Each task should land as a reviewable change with targeted tests. Run the whole suite, server typecheck, client typecheck, and production build before calling a milestone complete.
- Do not assign calendar estimates yet. The choice/pending-action and rules-checkpoint design are substantial enough to need a concrete design pass first. Sequence and acceptance criteria below are the planning deliverable.

## Milestone 0 — Reliable baseline and immediate failures

**Dependency:** none. **Priority:** P0. This work establishes a trustworthy platform for fidelity changes; it does not replace the broader roadmap.

**Owner review — 7 October 2026:** 0.1, 0.2, and 0.4 are accepted, implemented and verified. Focused actual-server checks cover lifecycle and game end. Defer 0.3 to preserve access to full state while debugging. The general 0.5 server-factory/injection framework remains deferred.

| Task | Implementation | Acceptance evidence |
|---|---|---|
| 0.1 Verification gates — complete | Separate server/client typechecks, supported Node `engines`, CI install/typecheck/test/build, README commands; stale attack-targeting branches removed (F09). | Both typechecks, existing tests and production build passed on bundled Node 24.19.0 in the gate task. |
| 0.2 Convergent terminal processing — verified | F01 fixed with stable win/draw outcomes, atomic END_GAME, convergent SBA/priority processing, terminal action rejection and client results. | Engine/client and actual-server spell/combat/reconnect scenarios pass. Both connected clients and reconnect snapshots converge on the terminal result. |
| 0.3 Private client views — deferred | Fix F02 later with one projection service used for every snapshot and delta. This concerns hiding private information in outgoing client messages; JSON serialization already exists. Keep complete authoritative state available for debugging. | When resumed: socket tests for create/join, post-RPS, draw, cast, and reconnect receive no private card IDs, definitions, order, or UUIDs; explicit reveals still work. |
| 0.4 Engine lifecycle — verified | F03 addressed through centralized initialized engine replacement/recovery; old managers disposed, repeated init safe, disposal final, room destruction and server close clear listeners/timers. Joined room data retained. | Three lifecycle regressions and five actual-server checks pass, including real join → cast/attack/death, replacement/destruction, terminal reconnect and shutdown cleanup. |
| 0.5 Real integration harness — pending scope decision | Original proposal: export a server factory with ephemeral port, injected store/clock/RNG, and explicit shutdown. Add Socket.IO scenarios that import the real server instead of copying its branches. Consider the lighter alternative below first. | Full proposal: two clients drive RPS → lands/mana → creature/spell → turn/combat → reconnect. Fixtures can test mechanics absent from the starter deck. No server or timer leaks after tests. |

The three accepted implementations are now present. Their focused live checks import current server source through Vitest before production build, use two real clients, and keep fixtures local; they require no broader 0.5 framework. The original audit script/results remain the historical `8d6176c` baseline. Its assertions of broken terminal behavior will now fail as intended and are not conformance checks.

### Why 0.5 was proposed, and a lighter alternative

Existing tests mostly call the engine or server helpers directly. They can pass even when `server.ts` wires those pieces together incorrectly: the join path replaces the engine without initializing its trigger listeners (F03), which the green suite did not catch.

The focused checks use the actual source server on an ephemeral port and two Socket.IO clients. Call-through engine observations provide a compact test-local fixture seam; cloned card blueprints and authoritative room data exercise triggers and lethal state, while actions still use real socket handlers. Tests close clients/server and retain failure-path timer/listener cleanup. They have been executed in the accepted milestone verification and subsequent full-suite runs.

Defer a general server factory, injected clock/RNG/store framework, comprehensive match automation, and browser testing until their consumers justify the work. Focused lifecycle and terminal checks are included in the accepted implementation; that decision does not authorize the general framework.

## Milestone 1 — Authoritative objects, events, and rules checkpoints

**Dependencies:** 0. **Priority:** P1. This is the central integration design for subsequent milestones.

1. Add common action-boundary checks for room membership, player identity, game status, request shape, choice ownership, and priority. Avoid crashes from unknown players and prevent direct resolution/phase-skip packets from bypassing engine rules.
2. Introduce explicit object references with a zone-change generation, distinct from the persistent physical card ID. Zone moves reset the appropriate state and produce new object identity; define last-known-information snapshots separately. Add zone infrastructure for exile/command and tokens without pretending those mechanics are already supported.
3. Introduce typed game events recording before/after state, source object, controller, affected objects, damage/life deltas, and event batches. Events are derived from actual applied changes, not prematurely emitted while building a speculative phase chain. Separate proposed replacement events from post-event notifications.
4. Add a single rules checkpoint: finish the atomic action/event batch, settle state-based actions, process pending trigger choices/insertion, repeat as required, then grant priority. Preserve simultaneous-event snapshots and pending choices. Do not drain triggers into the stack before the relevant state-based checks.
5. Fix F04 by resetting consecutive-pass history after an intervening action or relevant transition. Route stack resolution through the priority/checkpoint coordinator; restrict manual resolution to an explicit development-only facility if retained.
6. Ensure the phase director advances one authoritative step at a time. Recompute after triggers, state-based changes, and player decisions; do not precompute an entire turn from a room that later changes during application.

**Gate:** scenarios prove p1 pass → p2 instant → p2 pass returns priority to p1; objects leaving and re-entering invalidate old references; simultaneous deaths preserve watchers' relevant information; no action can resume a terminal game. Both live clients observe the same public event ordering.

## Milestone 2 — Full ordinary turn structure and action economy

**2.1 implemented (7 October 2026):** separate upkeep/postcombat main, ordinary response windows, declaration decisions independent of priority, zero attackers, phase-entry triggers, and updated client controls. Enter Battle passes toward combat. Debug end_turn remains an explicit shortcut. The remaining action economy/setup/cleanup items below are later slices. See `superpowers/specs/2026-10-07-milestone-2-1-turn-design.md`.

**Setup config and mana slice implemented (7 October 2026):** centralized room-snapshotted setup defaults, first-turn draw policy, generic/colored/explicit-colorless payment with validated allocations, and selected atomic mana abilities/output choices. Existing defaults retained. Milestone 3 subsequently added payment allocation choices and nested mana activation/discard/sacrifice costs. Mulligans, land play, both-player phase-boundary mana draining and cleanup choices remain open. See `superpowers/specs/2026-10-07-setup-mana-design.md` for the original slice and the [current per-item development documents](development/README.md) for present structure.

**Dependencies:** 1. **Priority:** P1.

- Expand the turn state into untap, upkeep, draw, precombat main, combat steps, postcombat main, end, and cleanup. Distinguish turn-based declarations from priority windows. Give response opportunities after declarations, drawing, damage, and end-step triggers; keep untap/ordinary cleanup automatic where appropriate.
- Replace unconditional “End Turn” skips with a shortcut/auto-pass preference that yields to the opponent's actions, triggers, and requested stops. Support zero attackers through a legal declaration path. Keep blocker choices separate from who gets priority afterward.
- Add per-turn land allowance/count and a `play_land` special action that moves directly to the battlefield. Do not make land play counterable or a spell.
- Separate **generic** costs from explicit colorless/colored requirements (F07). Add a deterministic payment proposal with optional player allocation, then validate the chosen payment. Cover X and alternate/additional costs in the extensible schema; implement unsupported symbols in later profiles deliberately.
- Drain mana at step/phase boundaries for both players using the rules profile. Replace `ADD_MANA`-only classification with proper mana-ability eligibility and support mana choices/payment windows when needed.
- Make setup configurable: opening hand size, first-turn draw behavior, mulligans, and deck construction validation. Fixture decks remain explicitly development content.
- Implement cleanup hand-limit discard choices and repeated cleanup/checkpoint handling; record empty-library draw attempts and resulting outcomes.

**Gate:** complete turn transcript exercises both main phases, upkeep/end-step responses, one land limit with modifier hook, generic payment from colored mana, both players' mana draining, no-attacker combat, mulligan/setup choices, empty-library loss, and cleanup choices. Shortcut use cannot deny the other player's action window.

## Milestone 3 — Casting, activated abilities, targets, and resolution choices

**Complete (7 October 2026):** all six items are implemented and verified. Stable ability activation, atomic shared costs, grouped target validation, whole-object resolution, room-owned pending choices, selected stack counter operations, and source-independent ability resolution with retained source information are present. Choices include announcement modes/targets/distributions/payment and resolution optional effects, nontargeted options/selections, searches, distributions and ordering. Owner reconnect, serialized trigger continuation, departure snapshots and client deltas are covered. Final gate: 614 tests in 52 files, both typechecks and production build passed. The [requirement-by-requirement audit](project-audit/milestone-3-completion.md) records concrete source and scenario evidence. This completes Milestone 3; deferred Milestone 2 slices retain their separate scope.

**Dependencies:** 1–2. **Priority:** P1.

1. Add stable per-card **ability IDs** and an `activate_ability` action carrying source reference, ability ID, costs, modes, and target groups. Replace `activateAbility_<effect>` ambiguity. Implement Crimson Hellkite's ability as an early end-to-end consumer.
2. Create a transactional announce/choose/pay/commit flow shared by casting and activation. Include mana, life, tap/untap, discard, sacrifice, and choices made during payment. Validate the complete action before committing irreversible costs; reject illegal combinations without partial payment. Source permanents remain in place when an ability is put on the stack.
3. Model targets per spell/ability and per target group; validate every group, not just the first explicit-target effect. Revalidate full current legality, including changed characteristics/control and permission effects. Separate nontargeted “all matching” selections from targets.
4. Decide legality and whole-object failure before applying structural resolution destinations. Retain effects that still legally resolve under the chosen scenario; do not approximate this by independently flagging each primitive as fizzled.
5. Add a serializable pending-choice protocol for modes, optional effects, searches, targets, distribution, ordering, and choices made during resolution. Pause resolution without granting unrelated priority. Reconnect restores the outstanding choice for its owner.
6. Support countering spells/abilities as stack-object operations. Add instant-speed card data and basic counterspell fixtures. Support source-independent ability resolution and last-known information.

**Gate:** paid costs persist if a spell is countered; rejected actions pay nothing; an ability resolves after its source leaves; two abilities using the same primitive can be selected separately; target type/control changes are respected; all-targets-illegal versus partially legal scenarios produce correct outcomes. Hellkite activation works from both UI and sockets.

## Milestone 4 — Trigger semantics and scheduling

**Engine scope complete (8 October 2026):** precise self/watcher/controller predicates, canonical committed events, APNAP and player-selected scheduling, persisted modes/targets/divisions, event-dependent and intervening conditions, optional effects, delayed registrations, and event-derived turn history with trigger/activation/mana limits are implemented. The owner's instruction limits new work to the engine, with synthetic engine and actual-server protocol scenarios; no named cards, catalog entries or client components were added. Final gate: 669 tests in 57 files, including 26 actual-server scenarios, both typechecks and production build passed. The [completion report](project-audit/milestone-4-completion.md) maps every requirement and named gate to inspected implementation and executable evidence.

**Dependencies:** 1, 3. **Priority:** P1.

- Preserve the October discovery/coordinator separation. Extend trigger definitions with event-subject predicates, self/watcher semantics, controller/opponent filters, optional choices, intervening conditions, and last-known information.
- Expand canonical events for cast, draw, discard, life gain/loss, every applicable leave-zone path, combat declarations/damage, upkeep, and end step. Emit death only for the appropriate creature-to-graveyard event. Event parameters represent newly dealt damage/gained life rather than cumulative totals.
- Accumulate pending triggers during actions/resolution; schedule them at the checkpoint. Implement active-player/nonactive-player ordering and player-selected ordering within their batch, with target/mode selection and reconnectable prompts.
- Consume `triggeringEvent` during resolution. Implement delayed triggers, optional “may” effects, per-turn activation/trigger limits, and turn-history predicates using event-derived state rather than ad hoc flags.
- Avoid blindly triggering every ETB/death/attack ability on any matching event. Include witnesses that leave in the same simultaneous batch.

**Gate:** own ETB versus another creature's ETB, gain versus loss, noncreature graveyard moves, bounce/exile, simultaneous deaths, mixed-controller trigger order, optional/targeted triggers, delayed end-step effects, and once-per-turn abilities have engine and real-server scenarios.

## Milestone 5 — Combat and unified damage

**Engine scope complete (8 October 2026):** revision/controller-aware combat participants, explicit blocked status, player-selected damage allocations, shared simultaneous damage batches, persisted decisions and open combat/damage rule hooks are implemented. Existing Flying/Trample behavior uses adapters. The owner's revised scope defers auto-allocation and new keyword consumers; generic damage passes and declaration/damage hooks are provided without implementing First/Double Strike, Haste, Reach, Vigilance, Menace, Defender or damage keyword consumers. Cumulative damage and live-power behavior already repaired in earlier milestones are preserved. See the [completion audit](project-audit/milestone-5-completion.md) and [engine pipeline](combat-engine.md). Verification: 693 tests in 60 files, including 27 actual-server scenarios, both typechecks and production build.

**Dependencies:** 1–4; use the characteristic facade before the full layer expansion. **Priority:** P1.

- Fix cumulative player damage (F05). Build a damage event batch; apply totals and source attribution without overwriting prior assignments.
- Reconcile combat participants against live object references and query current power/keywords at damage time (F06). Track blocked status independently of surviving blockers. Remove departed/control-changed participants appropriately.
- Replace the fixed sort/lethal-first cap with player-chosen **damage allocations**, validated on the server. Auto-allocation is deferred by the owner's instruction. Do not restore obsolete blocker assignment order. [Official Foundations combat update](https://magic.wizards.com/en/news/feature/foundations-mechanics).
- Support first-strike/double-strike damage steps, response windows between them, trample constraints, and simultaneous application. Include negative/zero power, over-assignment, and multiple sources hitting one recipient.
- Expand attack/block legality for haste, vigilance, reach, menace, defender, and restrictions/requirements. Use derived characteristics instead of only blueprint keyword strings.
- Create one damage pipeline for players and permanents, with source/controller/recipient/amount/combat metadata and hooks for prevention, deathtouch, lifelink, indestructible, protection, infect/wither, and regeneration. Implement basic keyword consumers with milestone 7 rather than hard-coding them in combat loops.
- Add planeswalker/battle attack destinations after their state model and target UI exist; retain multiplayer combat as an explicitly later extension.

**Gate:** two attackers with power 2 and 3 reduce life 20 to 15; buffs/removal after declarations affect damage; blocker removal preserves blocked status; chosen splits and trample validate; first/double-strike steps allow intervening actions; source attribution enables correct lifelink/deathtouch results; no healing from negative combat power. UI controls can submit all required choices.

## Milestone 6 — Continuous/static effects and permissions

**Engine scope complete (9 October 2026):** generic characteristic layers, timestamps/dependencies/defining expressions, static abilities with dynamic scopes and declared zones, independent resolved lifetimes/frozen recipients, stable effect/grant identities, effective engine/UI consumers and shared target/cast/activation permissions are implemented. Source/target re-entry, control tenure, last-known/copied values, resolution revalidation, deltas and reconnects have concrete coverage. See the [completion audit](project-audit/milestone-6-completion.md) and [engine contracts](continuous-effects-engine.md). Verification: 762 tests in 64 files, including 30 actual-server scenarios, both typechecks and production build. Manual combat and deferred keyword consumers remain as approved; replacement/prevention and protection's damage/blocking/attachment consumers remain in their later pipelines.

**Dependencies:** 1, 3–5. **Priority:** P1/P2.

- Fix F08. Distinguish effects created by resolving spells/abilities from static effects conditional on a source's presence. Duration, affected-object set, source identity, and controller snapshot need independent fields. Source departure must not cancel an independent end-of-turn buff.
- Implement `SET_STATS`, then the remaining layer/sub-layer pipeline with timestamps, dependency ordering, characteristic-defining abilities, copying, control/type/color/ability changes, counters, and P/T switching. Expand the characteristic service to effective types, control, colors, and abilities; all legality/UI queries use it.
- Register static abilities while their sources apply. Keep dynamic matching for static anthems and explicitly chosen affected-object sets for effects that require them. Add effects in other zones deliberately.
- Replace permission stubs with characteristic-driven restrictions: hexproof, shroud, protection, casting/activation prohibitions, and timing permissions such as flash. Evaluate at both announcement and resolution as appropriate.
- Add unique effect IDs so expiry/removal does not indiscriminately remove every effect sharing a source. Test zone re-entry against old effects.

**Gate:** a spell's temporary buff survives source departure; a static anthem stops with its source and applies to later entrants; SET_STATS/deltas/counters/switching interact correctly; timestamps/dependencies have concrete conflict fixtures; ability removal changes combat/activation legality; target permissions are consistent on server and UI.

## Milestone 7 — Replacement, prevention, and remaining state-based actions

**Engine scope complete (10 October 2026):** typed proposal processing, affected-player replacement ordering, self-replacements, finite shields, persisted nested/resolution continuations, semantic destruction/sacrifice, generic damage consumers and extended simultaneous SBA batches are implemented. Ordinary draw attempts record failed draws; individual draws see earlier results. Actual events, JSONL replay and client deltas use final outcomes. Existing choice components and manual combat remain; no named-card mechanics or catalog additions were added. Verification: 819 tests in 70 files, including 33 actual-server scenarios, both typechecks and production build. See the [completion audit](project-audit/milestone-7-completion.md) and [engine contracts](proposed-events-engine.md). Full token/copy creation, attachment actions, loyalty actions and battle gameplay retain Milestone 8 scope.

**Dependencies:** 1, 5–6. **Priority:** P2.

- Build replacement/prevention processing over typed **proposed events**, before state mutation. Do not substitute the current post-effect identity stub for this system.
- Support affected-player choices among applicable replacements, per-event application tracking, self-replacements, prevention shields, and event re-evaluation. Persist pending replacement choices across reconnect.
- Distinguish destroy, sacrifice, zone transfer, and damage; implement indestructible/regeneration and damage keyword consumers without incorrectly treating all removal as destruction.
- Extend state-based actions for zero toughness, deathtouch-marked damage, tokens, illegal attachments, legend/uniqueness choices, loyalty/defense, incompatible counters, poison/deck-out outcomes, and simultaneous changes. Settle the full batch before triggers/priority.

**Gate:** multiple replacements can be chosen in different valid orders; prevention changes actual damage and related triggers/lifelink; sacrifice bypasses destruction prevention; attachment/legend/token scenarios converge; simultaneous outcomes do not pick an arbitrary winner by iteration order.

## Milestone 8 — Zones, card families, and content coverage

**Dependencies:** 1, 3–7. **Priority:** P2.

Editable per-item structures, current contracts, extension boundaries and remaining gates are in the [development documents](development/README.md). Proposed structures there are not implementation-completion claims. The owner's engine-first scope keeps catalog/custom content implementation separate, and private projections remain deferred under 0.3.

**8.1 progress (12 October 2026):** the approved general operation-outcome boundary, generic shuffle, sequential top/bottom library transfers, state-preserving in-place permutations and player-ordered search are implemented. Equal shuffles retain their semantic event; equal reorders remain unchanged. Shared movement validation runs before original replacement discovery and final reduction. Primitive-slice verification: 878 tests in 72 files, including 35 actual-server scenarios, both typechecks and production build. The subsequent ordered-search slice (`a676697`) passed 886 tests in 72 files, both typechecks and production build, including recovery/reconnect during a pending ordering request. See [operation outcomes](development/8.1-committed-operation-outcomes.md), [ordered library operations](development/8.1-ordered-library-operations.md) and [player-ordered search](development/8.1-ordered-card-search.md). The [reveal lifecycle design](development/8.1-reveal-lifecycle.md) is deferred until a concrete reveal-effect consumer establishes its needs. Simultaneous ordered transfers and cross-zone casting remain open; 8.1 is not complete.

**8.2 scope (12 October 2026):** Equipment/equip mechanics and new attachment operations are deferred until a concrete consumer needs them. The current nine-entry catalog has no Aura, Equipment or Fortification; existing attachment legality/cleanup serves seeded fixtures. The [attachment document](development/8.2-attachments.md) retains the future design for re-scoping. This deferral does not complete 8.2.

**8.3 review (12 October 2026):** the [family integration audit](development/8.3-family-integration-review.md) maps the current factory, entry/replacement, copiable-value, loyalty-cost, Battle-combat and face-model boundaries. Current catalog entries consume none of the proposed new family actions; fixture cleanup and damage tests do not establish their creation/action flows. The next family implementation slice remains unselected and 8.3 remains open.

**8.4 review (12 October 2026):** the [announcement integration audit](development/8.4-announcement-integration-review.md) traces working modes, grouped targets, distributions and combined payment, and maps missing declared variables, cost routes and stack-copy lifecycle. It also identifies omitted Planeswalker/Battle structural classification for 8.3. These new slices remain open and unapproved.

The [announced X candidate](development/8.4-announced-x.md) defines a bounded first slice for casting/non-mana activation, concrete mana/effect/count/division consumers, scalar choices and locked stack values. It is awaiting owner review; cost routes, stack copies and the other excluded contexts remain open.

**8.5 review (12 October 2026):** the [loader integration review](development/8.5-loader-integration-review.md) maps configured setup, lazy normalization, shared cache and missing capability/deck-selection boundaries. An isolated probe reproduced malformed ability/cost coercion, discarded supported fields, loss of structured ability effects and accepted map-key/ID mismatch. No production definition or loader behavior was changed. Existing-loader implementation remains open; playable catalog additions remain separately scoped.

| Slice | Deliverable | Acceptance |
|---|---|---|
| Library/hidden-zone choices | Search, reveal, shuffle, ordered movement, draw/discard, graveyard and exile selections, cast-from-zone permissions | Searches expose only authorized information; empty/optional choices complete; old object references remain invalid |
| Attachments | Aura casting/target legality, attach/unattach, equip abilities, host changes, attachment state-based checks | Illegal Aura targets fail appropriately; Equipment and Auras follow their distinct lifecycle cases |
| Additional card families | Tokens/copies, planeswalker loyalty actions, battles, artifacts/enchantments, double-faced/split/adventure-style data and timing | Representative fixtures prove each family's zones, characteristic changes, and actions |
| Stack breadth | Modes, X, variable target groups, divided effects, alternate/additional costs, copies and cast/activation permissions | Choice schema, payment, targeting, and resolution round-trip through live clients |
| Card catalog/decks | Validated card schema, metadata, deck loading/validation/selection; expand from the seven-card prototype | A capability manifest identifies unsupported mechanics instead of silently ignoring them |
| Custom ST01A | Re-audit the documented 24-card requirements: Scorch, chain prevention, reveal casting, equipment, discard costs, once-per-turn effects | Each custom mechanic has its own definition/profile and tests; reconcile actual source card data before declaring a card complete |

Maintain a card-to-mechanic-to-scenario matrix. Add representative cards as integration fixtures alongside each system, then grow the playable catalog. A count of imported card definitions is not evidence that their text is implemented.

## Milestone 9 — Broader coverage and durable operation

**Dependencies:** progressively after 1; engine-wide validation after 8. **Priority:** P2/P3.

- Extend turn machinery for extra/skipped turns and phases, extra combats, triggered step creation, and loop/choice handling. Broaden the keyword/mechanic catalog with scenarios and dependencies rather than a monolithic “support all cards” task.
- Add multiplayer identity/priority/APNAP/targeting and team/Commander/other format profiles when their rules and UI are explicitly specified. These are remaining roadmap scope, not implied by the current two-player implementation.
- Add deterministic command/event replay, durable versioned snapshots, restart recovery, per-room serialization, sequence validation/gap recovery, and state migration. Select persistence after the event/choice model stabilizes; Mongoose's presence alone is not an implementation.
- Add two-browser E2E coverage for timing, combat allocation, targeted triggers, replacements, hidden-information projection, reconnect, and game end. Include invariant/property tests for reducer conservation, nonnegative resources, target identity, checkpoint convergence, and replay equivalence.
- Measure coverage, establish useful thresholds around rules modules, add negative packet/illegal-action tests, and remove blueprint-cache mutation hazards from fixtures.
- Establish the active deployment path for the Node/Socket.IO server and built client. Update or retire the legacy `wrangler.jsonc` workflow once hosting is chosen. Production readiness includes recovery/load tests and operational logging.

**Gate:** feature manifest and scenario matrix disclose supported rules; scripted matches replay identically; reconnect/restart resumes choices and correct public views; a real browser suite drives the engine's advanced rules. Format-specific or exotic mechanics remain explicitly listed until implemented and verified.

## Dependency order and next implementation brief

```text
0 verified baseline + critical failures
  → 1 objects/events/checkpoints
  → 2 turn structure + land/mana economy
  → 3 cast/activate/choice/resolution
  → 4 trigger scheduling
  → 5 combat + damage
  → 6 layers + permissions
  → 7 replacements + broader SBAs
  → 8 zones/card families/content
  → 9 wider formats + durable operation
```

Integration and browser scenarios grow with every milestone; they are not postponed wholesale to milestone 9. Build small PRs within each milestone. After milestone 0, the next design brief should settle the **object-reference, event-batch, pending-choice, and priority-checkpoint contracts** together, because casting, triggers, damage, and replacement effects all depend on them.

Accepted implementations for F01/F03 and the client gates (0.1, 0.2, 0.4) are verified. The final gate passed 392 tests in 34 files, both typechecks and the production build on Node 24.19.0. F02/private snapshots and the general 0.5 framework remain deferred. Subsequent work must continue through the broader fidelity milestones; these immediate repairs alone do not fulfill the long-term engine target.
