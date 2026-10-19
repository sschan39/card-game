# Mechanic ownership implementation plan

> For future implementation: use executing-plans and implement one approved consumer at a time. This document plans ownership; it does not authorize the mechanics listed as future work.

**Goal:** Add real card mechanics without turning GameEngine, the effect registry or room history into catch-all systems.

**Architecture:** Card data declares behavior. Pure queries and domain planners calculate it; typed mutations commit it; actual committed events drive history and triggers. Each retained fact has an explicit owner and lifetime.

**Tech stack:** Existing TypeScript engine, immutable reducer, serializable choices, Socket.IO deltas and Vitest. No new dependency or plugin framework.

**Subsequent approved scope:** the bounded 24-card ST01A implementation now uses these owners. See [Red starter and Scorch](12-red-cards-and-scorch.md) for the confirmed rulings and current verification. The “current” and “future” observations below describe the baseline when this plan was written.

18 October 2026. Baseline commit: `3888d7c` (`feat: add workbook consumers and streamline engine execution`). That commit contains the current card work and cleanup. Fresh pre-commit evidence: 89 test files / 1,212 tests passed; server/client typechecks and staged whitespace check passed. The initial run hit the server startup hook timeout during concurrent typechecks; the unchanged full suite passed when run alone. No push requested. This plan was written after the commit.

## 1. Where code belongs

| Work | Existing owner / extension location | Boundary |
|---|---|---|
| A card expressible using current effects | `src/library/card_data.json`, normalized by `card-parser.ts`; document in library README/JSONC examples | Compose effects, filters, triggers and parameters. No catalog-ID branches in engine code; rulesText remains display text. |
| Look up a concrete selected card | Existing `findTargetCard` in `src/shared/target-legality.ts` | Reuse its supported pointer/zone semantics; do not add another hand/battlefield/deck search in every effect. |
| Enumerate/filter current cards | `roomCards` in `continuous-effects.ts`, `scopeMatches` in `effect-scopes.ts`, resolved characteristics from `CardCharacteristicService` | Pure reads. Keep the domain's zone/controller/identity semantics explicit. Reuse filter predicates where they mean the same thing; do not merge targeting, searching and selection constraints merely because they all filter cards. |
| Read a number from state or an event | `numeric-values.ts`, with context supplied by `numeric-characteristics.ts`, `rule-conditions.ts` or `effect-resolver.ts` | Extend a named query only when a consumer needs a new read. A query never changes state, asks for input or records a use. Existing `field`, `count`, `exists` and arithmetic already cover many cases. |
| A simple data change | Small adapter in `effect-registry.ts` returning existing `GameMutation[]` | Use existing ADD_COUNTER, MOVE_CARD, life, stat and other operations. Never mutate `room` or call another effect's resolver as an alternate execution pipeline. |
| A domain operation with its own rules | Existing domain file: `library-operations.ts`, `zone-transitions.ts`, `action-costs.ts`, `damage-service.ts`, etc. | Keep the registry adapter thin when selection, ordering, payment or invariants need their own implementation. A short, obvious adapter can stay inline. |
| A genuinely new named mechanic | Proposed `src/engine/mechanics/<mechanic>.ts`, created only with its first approved consumer | Pure mechanic-specific decisions/adapters. Share rules between cards, not a file named after one card. Use existing proposals, operations, choices and checkpoints. Do not create an empty mechanics directory or a universal mechanic loader now. |
| New authoritative state transition | Typed addition in `src/types/game-mutation.types.ts`, implemented by `game-reducer.ts` or its focused domain reducer | Add an operation only for a new state concept. Changing a rule's number does not justify another mutation type. Preserve old state references. |
| An invariant that must hold at a rules checkpoint | Focused planner called from `state-based-planner.ts`; sequencing stays in `rules-checkpoint.ts` | Consequences are normal mutations. No side effects during scans and no new recursive checkpoint loop. Custom invariants need explicit room-rule applicability. |
| A trigger on something that happened | Canonical event in `applied-events.ts` or the operation outcome; matching/discovery in `trigger-matching.ts` / `trigger-manager.ts` | Derive actual outcomes after replacement/prevention. Discovery queues through the existing trigger scheduler. Do not emit success when an effect merely proposes a change. |
| Prevent or replace a proposed operation | `replacement-rules.ts` and `proposed-events.ts` | Prevention belongs before commitment. A post-damage trigger cannot prevent damage already dealt. Reuse the existing pending replacement continuation. |
| Ask a player during resolution | `resolution-choices.ts`, with retained data in `choice.types.ts` | Resume the same cursor; retain exact identities and values needed later. Dispatch stays generic in `choice-continuation.ts`. |
| Setup or configurable defaults | `src/config.ts`; snapshot room-affecting settings at room creation | Do not scatter settings across handlers or reread mutable global defaults for an already-running room. Printed card numbers remain card data. |
| Transport, readable logs and UI | `sync-service.ts`, existing client delta reducer and `stack-description.ts` | Transport authoritative outcomes and describe source/ability/effect. Client code does not implement destruction thresholds, spend limits or decide trigger success. |

GameEngine continues to own the command boundary and sequence existing systems. MutationCommitter owns commitment and publication. Neither receives an `if card.id === ...`, a counter-name switch, a new mechanic countdown or a history query specific to one card.

If several consumers need a selection not covered by the current helpers, introduce a focused pure `src/engine/card-queries.ts`. Do not create it for a one-off `find`, or make it a mutable “game data service.” Add only the predicate actually missing: for example exact-name exclusion, rather than a generic query language with no consumer.

## 2. Where retained data belongs

| Lifetime / question | Owner | Rules |
|---|---|---|
| Printed definition: “place one Scorch counter” | Blueprint / card JSON | Parameters and supported mechanic declarations; never live progress or player selections. |
| Counter physically on this permanent | `CardInstance.state.counters[counterType]` | Existing generic storage. Existing zone resets apply; stable UUID does not imply that counters survive a zone change. Confirm any exception before implementing it. |
| Damage this turn / ordinary per-turn state | Existing card state and turn cleanup | Use the existing domain field. Do not mirror damage in a generic custom counter map. |
| Events and uses this turn | `GameRoom.turnHistory` via `turn-history.ts` | Current-turn records, occurrence counts, player attribution, uses and land plays. Counts are events, not summed amounts: damage 3 plus damage 4 is two events, not seven damage. |
| Once-per-game or another genuinely game-long fact | Proposed typed `GameRoom.gameUsage` or a specifically named fact, only when required | Store the fact outside resettable turnHistory; define initialization and reset. Do not keep all previous turns just to remember one use. |
| Which cards this instruction processed / a value captured once | The stack resolution and its serialized `ResolutionContinuation` | A future local-results addition belongs here. It must survive choice/reconnect and expire when the resolution ends. Do not store a revealed set in global history. This result facility is not implemented yet. |
| The event that caused a trigger | Existing `triggeringEvent` and retained source information on its stack object | Read the retained event; do not query “last event” from the live room after later events happen. |
| “After three matching events since registration” | The particular delayed registration/effect instance, if selected | Progress and expiry belong to that registration. Do not use the room's all-turn event count as an implicit baseline. Existing delayed registrations have no such progress field today. |
| Why a command or effect succeeded | Committed batches, backend JSONL, readable client log | Diagnostic evidence, not live rules storage. Never reread JSONL from a card ability. |

Room and card types define serializable shapes; reducers are the only writers of committed game state. No `room.custom: Record<string, any>`, arbitrary property paths for writes, hidden module-level per-room counters, event-bus listeners that directly mutate rooms, or duplicate client copies of mechanic authority.

For any longer-lived usage key, explicitly choose the identity policy: physical card UUID, UUID plus zone revision, player, or an authored shared rule group. The existing per-turn helper keys by UUID + zone revision + ability ID. Reusing that key automatically for a game-once rule could incorrectly reset its budget after a zone change. Display names are not keys.

## 3. Named counters: storage is separate from meaning

Current ADD_COUNTER / REMOVE_COUNTER store arbitrary named values on battlefield cards. They do not implement Scorch, charge-cost payment, Aurora, nonremovable counters or a counter-placement trigger. Existing explicitly implemented counter rules, such as +1/+1 characteristic changes, are separate consumers of that storage.

Example ownership for a future confirmed Scorch consumer:

```text
Card definition: place 1 named counter on an admitted target
  → effect adapter plans ADD_COUNTER
  → existing proposed-event replacements decide the actual change
  → reducer commits the new counter total
  → actual counter-change event/history/trigger discovery, when added
  → mechanic consequences at their defined rules point
  → normal DESTROY_CARD proposal if destruction is required
  → normal replacement/death/trigger/delta/log flow
```

The mechanic does not edit the graveyard, publish a fake death, or call GameEngine again. Destruction uses the current destruction pipeline, including its existing replacement handling. Numeric thresholds read resolved characteristics or a confirmed cost-value definition, not the number of ability entries in JSON.

Timing decides the integration point:

- **Always true invariant:** “a permanent with at least this many counters is destroyed” belongs in a checkpoint planner. Check already-present counters and later threshold changes, not only fresh placement.
- **Event response:** “when a counter is placed, draw a card” belongs in trigger discovery from the committed counter event.
- **Cost:** “remove two charge counters to activate” belongs in atomic cost planning/payment, not the effect that resolves afterward.
- **Prevention:** a counter-qualified shield belongs in the replacement/prevention path, including its own consumption/usage fact.

The workbook has unresolved Scorch wording: rules notes use total energy cost, some cards say 能力總值, and others specify a fixed two. Before a Scorch implementation, decide printed/effective/paid cost, fixed-two overrides, and whether the threshold is continuously enforced or evaluated only on placement. This is a card-rule decision, not a reason to invent an extensibility framework.

Custom rules must not silently run in every MTG-style room. When the first custom invariant is approved, add only its necessary central config selection and an immutable room rules snapshot. A complete selectable-profile system is not a prerequisite. Card-specific printed thresholds stay in typed card definitions; shared game defaults belong in config. No scattered feature flags.

## 4. Room history and event progress

Keep `recordRuleEvent` as the current-turn fact projection called by MutationCommitter. If game-long usage is needed, use a focused `src/engine/usage-limits.ts` to share key/check/record planning between activation and trigger discovery; do not duplicate game-once checks in every handler. Update current per-turn callers and pending-use reservations together when introducing that scope.

Add quantity aggregation only for an actual consumer. A damage-total consumer can require a typed total projection or a pure aggregate over existing retained records, depending on its scope and access pattern; it does not automatically require a permanent event archive. Name whose damage is counted, the retention window and whether source/controller/recipient attribution is intended.

Only committed semantic outcomes update event-driven progress. Rejected commands, cancelled changes, replayed serialization and read-only option requests do not count. An ordinary ability-use budget is consumed at its defined commitment/discovery point, which may precede resolution; a countered ability need not refund its use. Specify that point rather than treating “success” as a universal timing rule.

For simultaneous events, preserve the existing event-context/history behavior and explicitly test whether the consumer counts individual events, cards or one batch. Avoid assuming that an occurrence-count comparison implements an independent N-event timer.

## 5. Adding one mechanic: concrete work sequence

These are future execution gates, not missing implementation in this planning task.

- [ ] **Select one complete real-card consumer.** Record source row/text, all clauses, the absent primitive and the rule timing. Reuse existing operations before proposing a new one. If the card also needs an unresolved nonstacking/Chain/reveal clause, keep it visibly partial or choose another consumer; do not count one implemented clause as a complete card.
- [ ] **Choose ownership with sections 1–2.** List the exact adapter, domain module, state type, mutation, event and UI description affected. State when each retained value is created, updated and removed. No new room field for a value that can be read directly or retained only on the resolving stack object.
- [ ] **Write behavioral tests before production changes.** Use existing fixtures/public engine commands. Verify actual state, source event and downstream trigger resolution; verify the prior room stays unchanged. For choices, round-trip the pending room and resume without replaying prior instructions.
- [ ] **Implement the narrow domain rule and adapters.** Add a new domain module only when existing domain operations do not own the behavior. A new mutation requires its reducer and sync mapping; a new query requires syntax validation and the correct consumer context. No arbitrary write-by-path action or general plugin loader.
- [ ] **Connect existing event/choice/checkpoint paths.** Keep canonical event definitions in `game-event.types.ts` and actual-event derivation in the existing publication path. Keep history projection in its fact owner; add trigger mappings only when the consumer needs them. A mechanic-specific choice should reuse the existing cursor/continuation unless it truly introduces a new rules decision type.
- [ ] **Add the real card and annotated example.** Update `card_data.json`, `src/library/README.md`, `card_data.example.jsonc` and the central opt-in test setup. Name the source, trigger and actual effect in readable client logs. Document any unsupported clause instead of hiding it as a mode.
- [ ] **Prove the vertical flow.** Test ordinary server commands through both clients: legal action, choice, actual mutation/event, trigger resolution and final delta. Include source/target leaving its zone if relevant. Keep frontend rules decisions out of the client.
- [ ] **Verify and commit that slice.** Run focused tests, both typechecks and full serial regression when shared engine paths change. Commit the mechanic and its consumer together after review. Do not bundle unrelated future extension hooks.

Use these existing commands from the repository root, with the configured Node runtime on PATH:

```powershell
node node_modules/vitest/vitest.mjs run tests/engine/small-card-mechanics.test.ts --config vitest.config.mts --maxWorkers 1
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p src/client/tsconfig.json
node node_modules/vitest/vitest.mjs run --config vitest.config.mts --maxWorkers 1
node node_modules/vite/bin/vite.js build
git -c core.safecrlf=false diff --check
```

The focused test file above is an existing example, not a requirement to put every future mechanic into it: Scorch would use `tests/engine/scorch.test.ts`; generic counter events would use `tests/engine/counter-events.test.ts`; game-long usage would use `tests/engine/usage-limits.test.ts`. Include the consumer in `tests/server/live-routing.test.ts` using normal commands. Do not run CPU-heavy builds/typechecks concurrently with the server startup test.

## 6. Suggested next slices and explicit deferrals

1. **Existing primitives first:** additional cards that only need a supported filter, numeric expression, ordered effects or simple data change remain catalog work. Do not wait for new architecture to author them.
2. **First approved counter consumer:** settle its rule wording, then add actual counter-change semantics and only the consequence it needs. A future counter event should report actual before/after/delta and counter type; if a watcher needs causal source/controller attribution, carry that provenance explicitly rather than guessing from the target. Test zero changes, removals clamped to available counters, replacement cancellation/redirection and simultaneous threshold consequences.
3. **A concrete game-once consumer:** add typed usage storage and a shared key/check/commit helper only when all its other required mechanics are available. Test turn changes, zone changes under the chosen identity policy, pending trigger reservations and reconnect. Do not implement a permanent history archive for this.
4. **Keep reveal and local result sets deferred:** the ownership is now specified, but no new result store/reveal subsystem is authorized by this plan. When selected, use the audit in `09-small-card-mechanics.md`; preserve exact top-N identities/order locally rather than rediscovering the deck after a choice.

General X-turn timers, arbitrary event countdowns, equipment, a database/history archive and a universal custom-profile loader remain separate consumer-driven work. Nothing in this plan adds them preemptively.

## 7. Alternatives and review check

Keeping all new logic in GameEngine or the registry is initially shorter but repeats the ownership problem. Building a generic mechanic/plugin framework now adds unused lifecycle and registration machinery. The selected approach reuses current boundaries and extracts a focused rule only when its first consumer requires it.

Before accepting a future slice, check: does GameEngine still just coordinate; is each read pure; is each change a typed immutable operation; is a rule fact stored at the smallest correct lifetime; does a special counter's policy live outside generic storage; and can both clients show what actually happened? If a slice fails one of these, correct that boundary before expanding its card coverage.
