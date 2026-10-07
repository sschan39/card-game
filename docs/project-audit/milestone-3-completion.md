# Milestone 3 completion audit

Audited 7 October 2026 against all six items and the gate in `../implementation-plan-2026-10-07.md`. Sources and scenarios below were inspected in the current checkout. This audit covers casting, activated abilities, choices, countering, and source information. Deferred turn/action-economy slices remain in Milestone 2; full trigger scheduling, combat, layers and replacement systems remain in later milestones.

## Requirements and evidence

| Requirement | Authoritative implementation | Executable evidence |
|---|---|---|
| 3.1 Stable ability IDs and one generic activation action | `card-parser.ts`, `activate-ability-handler.ts`, `option-service.ts`; selected blueprint definitions determine effects/costs | `activate-ability.test.ts`: duplicate IDs rejected, same-primitive abilities independently selectable, client-supplied definitions ignored, timing and priority validated |
| 3.1 Source reference, modes and target groups | Activation locates the current controlled source; mode selection and target planning capture canonical zone/revision references | `activate-ability.test.ts`: mode prompt pays nothing until answered and selected effects resolve; grouped target scenarios in `target-groups.test.ts` |
| 3.1 Hellkite end to end | Authored `firebreathing` ID, advertised menu option, generic server handler, stack resolution | `mana-options.test.ts`: real menu callback sends selected ID; `live-routing.test.ts`: advertised option activates through sockets, buff resolves while source remains |
| 3.2 Shared atomic announcement/payment | `action-choices.ts`, `action-costs.ts`, cast/activation/mana handlers; pure preview before commit | `action-costs.test.ts`: combined mana/life/tap/discard/sacrifice, untap, nested mana payment, rollback, casting-card reservation; `pending-choices.test.ts`: discard/payment choices do not pay early |
| 3.2 Illegal combinations pay nothing | Complete handler revalidation precedes request clearing and cost application | Whole-room equality assertions for invalid costs, selections and unavailable payment in `action-costs.test.ts`, `activate-ability.test.ts`, `target-groups.test.ts` |
| 3.2 Paid costs persist and source stays unless paid away | Costs precede stack insertion; counter removal does not refund; sacrifice is explicit cost movement | `countering.test.ts`: countered spell retains mana payment, lower ability counter retains source; `action-costs.test.ts`: combined paid costs persist after countering |
| 3.3 Every target group validated | `target-groups.ts`, `shared/target-legality.ts`, shared group descriptions and canonical pointers | `target-groups.test.ts`: multiple groups, missing/extra/duplicate/wrong groups, duplicate pointers with unrelated fields, shared named clauses |
| 3.3 Full supported current target legality | Structural filters plus characteristic power/toughness queries and shared permissions; engine target-rule extension hook | `target-groups.test.ts`: changed control/type/derived power/hexproof and extension permission invalidate; departed/returned UUID rejects old revision; creature-spell filters |
| 3.3 Targets distinct from nontargeted matching | `isExplicitTargeting`, target expansion, resolution selections with targeting disabled | `pending-choices.test.ts`: untargeted distribution and revision-bound resolution selection; `object-resolution.test.ts`: untargeted instructions survive partial legality |
| 3.4 Whole-object legality before destinations | `planStackResolution` checks all chosen targets once; sequential instructions precede structural movement | `object-resolution.test.ts`: all-illegal prevents every effect, targeted permanent goes to graveyard, partially legal groups and untargeted effects resolve, optional zero-target clause succeeds |
| 3.4 Sequential instructions preserve entry decision and original object identity | Locked targets retain legality decision; identity is checked between instructions | `object-resolution.test.ts`: no mid-resolution permission recheck, spell remains on stack during instructions, leave/return does not receive later effect |
| 3.5 Serializable room-owned requests and continuations | `choice.types.ts`, `choices.ts`, `action-choices.ts`, `resolution-choices.ts`, room fields, reducer and delta cases | `pending-choices.test.ts`: serialization resumes without replay, owner/stale/invalid answers rejected, unpaid cancellation, no unrelated commands or priority |
| 3.5 All named choice kinds | Announcement modes/targets/divisions/discard/payment; resolution optional/search/nontargeted selection/options/distribution/ordering | Individual named scenarios in `pending-choices.test.ts`; nested option choices retained; impossible requests skip or reject without deadlock; actual targets/divisions announced before resolution |
| 3.5 Reconnect and client controls | `ChoicePanel.tsx`, owner-only form, board/action gating, request-ID keyed local state | `client/pending-choices.test.ts`: owner rendering, waiting opponent, selection payload and exact allocations; `live-routing.test.ts`: reconnect restores prompt and real socket answer resumes resolution |
| 3.5 Checkpoint and queued trigger continuation | Room-owned pending trigger mutations survive pauses; SBAs wait until resolution completes | `pending-choices.test.ts`: deferred SBA, serialized triggers, queued trigger departure refresh before stack insertion |
| 3.6 Selected counter operations | `COUNTER_STACK` and `REMOVE_STACK`, generic COUNTER primitive, exact UUID removal, reducer and sync cases, typed `STACK_COUNTERED` event | `countering.test.ts`: immediate spell-to-graveyard, selected lower ability, ability-only filter rejects spells, resolution preserves newly added stack object |
| 3.6 Instant fixtures and visible stack selection | Instant fireball, counterspell and ability-counter fixture data; stack-type target filter | `live-routing.test.ts`: ordinary priority with debug off counters instant and both clients converge; `mana-options.test.ts`: actual stack callback submits selected counter target |
| 3.6 Source-independent resolution/current information/LKI | `source-information.ts`, activation/discovery snapshots, departure refresh, exact source zone/revision lookup, generic dynamic parameters | `source-information.test.ts`: live counters, source departure and return, sacrifice cost with static buff, dynamic life primitive, source permission revalidation |
| 3.6 Simultaneous versus sequential snapshots | MOVE_CARD source snapshots, per-event runtime contexts, shared SBA departure witnesses, post-discovery queued-source refresh | `source-information.test.ts`: simultaneous anthem/source deaths retain preceding power; ON_DIE and ON_DAMAGE_TAKEN sequential batches retain departure power 9 and resolve life 29, including departure event payload |
| 3.6 Source information survives synchronization/recovery | Source snapshots are plain data, MOVE_CARD updates surviving stack metadata, pending trigger metadata serialized | `live-routing.test.ts`: both clients receive departure power 7, reconnect restores it and ability resolves life 27; serialization scenarios in engine tests |
| 3.6 Resolved effects survive source departure | Independent resolved effects use `requiredZone: null`, controller snapshot and target revision; dependent static cleanup remains separate | `source-information.test.ts`: temporary buff survives departure, returned target excludes old buff, sacrifice snapshot includes static contribution |

Paths in the implementation column are under `src/engine/` unless qualified; test paths are under `tests/engine/` unless client/server qualified. Socket scenarios are in `tests/server/live-routing.test.ts` and client menu scenarios in `tests/client/mana-options.test.ts`.

## Final gates

On bundled Node 24.19.0, after the final runtime edits:

- `node node_modules/vitest/vitest.mjs run`: **614 passed, 52 files, exit 0**. Includes real source-server Socket.IO scenarios.
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`: **exit 0**.
- `node node_modules/typescript/bin/tsc --noEmit -p src/client/tsconfig.json`: **exit 0**.
- `npm run build`: **exit 0**, TypeScript compilation and Vite client build.

Independent review identified two trigger LKI gaps in sequential batches. Both produced red regression results before the fix; the final tests and follow-up review confirm corrected results. Review reported no remaining important findings. The audit also added explicit activated-mode and exact resolving-object removal scenarios.

The Milestone 3 gate is proven: paid costs persist when countered; rejected actions pay nothing; abilities resolve after source departure; same-primitive abilities remain independently selectable; target type/control changes invalidate appropriately; all-illegal and partially legal cases differ; Hellkite activation works through client callbacks and real sockets.

No full MTG coverage claim is made. Full trigger ordering/target-choice scheduling, general characteristic layers, replacements, hidden client projections, full catalog content and deferred Milestone 2 economy features retain their existing roadmap ownership.
