# Complete red cards and Scorch

18 October 2026. Active goal: complete the **24 ST01A 炎獸 starter cards** plus their necessary mechanics, including Scorch; ask before deciding unclear wording. Baseline: `3888d7c`. Follow the approved [ownership plan](11-mechanic-ownership-plan.md), preserving current planning docs. No commit/push requested for this implementation.

## Scope and decisions

Workbook audit: **54 red-containing row occurrences / 53 distinct names**, including starter, BP01, two red Void spirits and multicolor cards. 虛界炎狼 亞里 appears twice with matching text. User clarified the implementation scope to the **24-card 炎獸 starter set only**. The table below retains only those 24 rows; the broader workbook review remains the reference for excluded BP01, Void and multicolor cards.

### Confirmed rulings

- **Creature Scorch:** continuously destroy a creature when its Scorch counters are at least its **current attack + maximum health**. Marked damage does not reduce this threshold. The rule is opt-in through `room.setup.scorch` / `st01aTestSetup.scorch: true`.
- **Artifact/Relic Scorch:** the destruction threshold is explicitly **deferred**. These cards may receive counters, but no guessed destruction rule applies. Keep this unresolved rule visible when authoring relic consumers.
- **Chain:** protected summons and abilities take effect immediately without using the stack. Friendly wolf summons and abilities receive the protection while the protecting wolf is on the battlefield. 諸界帝國反抗軍's attack destruction effect is immediate; remove its battle clause. Blocking remains normal.
- **Reveal order:** reveal → select the card / place Scorch → return the remainder → resolve on-reveal triggers. Self-claims may retrieve the revealed card from the deck bottom; 安度基特斯 may discard itself there. A selected card now in hand still produces its on-reveal trigger.
- **赤狼 selection:** revealing is optional. After revealing, taking an eligible card is also optional, even when a match exists.
- **强攻之怒焰狼:** draw once per placement event across all copies, not once per counter.
- **諸界烈刃:** equipment enters unattached. During its controller's own main phase, attaching or reassigning it to an owned creature is free. Draw then damage remains one ordered ability.
- **血炎神殿:** select the lowest remaining health; its controller chooses among ties.
- **血怒之馬甸尼:** the entry +3/+3 is permanent, and the condition governs the whole damage/buff sequence.
- **回復:** means untap. BP01 remains outside this implementation scope.
- **凱隆 destruction:** `ON_DESTROY` requires actual destruction into the graveyard, including Scorch and lethal-damage destruction. Sacrifice, generic graveyard movement, zero-health movement, indestructible, cancellation and exile redirection do not substitute for it.
- **烈焰狼王 usage:** one trigger per turn for this battlefield incarnation; leaving and returning resets the budget through its new zone revision. Draw requires this instruction's actual successful destruction into the graveyard.
- **極炎皇帝 damage:** one hit for three times the total Scorch counters on **all opposing battlefield cards**, including Artifacts/Relics. The damage target is restricted to the opposing player or one opposing Creature; Artifact/Relic and Land are not damage targets. Its friendly 炎獸 attack reveal counts 炎獸 Creatures or 炎兵 Spells once at reveal, places that many Scorch counters on one opposing Creature/Artifact, then returns all revealed cards before their triggers.

## Execution

- [x] Inspect source/workbook and inventory all red rows/duplicates.
- [x] Confirm the 24-card starter scope and the shared rulings recorded above; record the confirmed consumer rulings below.
- [x] Add actual counter-change events with causal source preserved through replacements; verify no fake event on cancellation/no change and an actual observer trigger.
- [x] Remove the provisional BP01 theatre consumer/phase-context addition after the user restricted scope; keep only starter dependencies.
- [x] Implement opt-in creature Scorch and its first consumers, reusing generic storage and destruction; defer Artifact/Relic destruction.
- [x] Add hand-source activation, mixed-speed modes, bounded reveal/results and reveal self-claims only where red consumers need them. Reveal is now authorized as a red-card dependency, not as a universal reveal subsystem.
- [x] Complete needed equipment, outcome dependencies, special-summon provenance, per-turn usage and attachment as confirmed starter dependencies.
- [x] Author and prove every in-scope card's whole text, including both-client source/effect logs and state. Mark partial cards honestly until all clauses work.
- [x] Run focused/full regressions, typechecks/build and read-only review; audit each source row before completion.

## Current starter catalog inventory

All 24 selected rows now have catalog definitions. Every selected definition is covered by the final regression. The completion audit below records the final combined verification. Artifact/Relic Scorch destruction is intentionally deferred wherever relevant. The old 65-card baseline and earlier support reports remain historical.

| Source | Printed name | Current catalog ID / status |
|---|---|---|
| 炎獸!2 | 阿基里斯爪牙 | `achilles-minion` — implemented and regression-covered |
| 炎獸!3 | 帝國奴僕 | `empire-servant` — implemented and regression-covered |
| 炎獸!4 | 火槍團下等兵 | `musketeer-infantry` — implemented and regression-covered |
| 炎獸!5 | 赤狼 | `red-wolf` — implemented and regression-covered |
| 炎獸!6 | 强攻之怒焰狼 | `strong-ignition-wolf` — implemented and regression-covered |
| 炎獸!7 | 睿智之怒焰狼 | `wise-ignition-wolf` — implemented and regression-covered |
| 炎獸!8 | 諸界火術士 | `worlds-pyromancer` — implemented and regression-covered |
| 炎獸!9 | 諸界帝國反抗軍 | `worlds-rebel` — implemented and regression-covered |
| 炎獸!10 | 破裂火球 | `broken-fireball` — implemented and regression-covered |
| 炎獸!11 | 火球術 | `fireball` — implemented and regression-covered |
| 炎獸!12 | 烈焰獠牙 | `flame-fangs` — implemented and regression-covered |
| 炎獸!13 | 點火狼 | `ignition-wolf` — implemented and regression-covered |
| 炎獸!14 | 炎極雇傭兵 | `flame-mercenary` — implemented and regression-covered |
| 炎獸!15 | 烈焰弩炮 | `flame-ballista` — implemented and regression-covered |
| 炎獸!16 | 被啓動的血炎山 | `awakened-blood-mountain` — implemented and regression-covered |
| 炎獸!17 | 强權崛起 | `rise-of-power` — implemented and regression-covered |
| 炎獸!18 | 炎極三公 凱隆 | `chiron` — implemented and regression-covered |
| 炎獸!19 | 炎極三公 安度基特斯 | `andu-gittes` — implemented and regression-covered |
| 炎獸!20 | 諸界烈刃 | `worlds-flameblade` — implemented and regression-covered |
| 炎獸!21 | 烈焰狼王 凱普斯 | `wolf-king-keps` — implemented and regression-covered |
| 炎獸!22 | 極炎皇帝 阿基里斯 | `flame-emperor-achilles` — implemented and regression-covered |
| 炎獸!23 | 阿基里斯血炎神殿 | `achilles-blood-temple` — implemented and regression-covered |
| 炎獸!24 | 諸界六皇 血怒之馬甸尼 | `bloodrage-maadini` — implemented and regression-covered |
| 炎獸!25 | 血炎山 | `land-red` — implemented and regression-covered |

## Deferred rule and scope

Artifact/Relic Scorch destruction remains deferred. Counters may be placed and counted, but no health, energy-cost or fixed destruction threshold is inferred for them. The Emperor's damage target is already restricted to player/Creature, so no unanswered damage-target ruling remains. BP01, Void access, rituals, stage sequencing and mandatory-block mechanics remain outside the selected 24-card starter scope.

## Implementation chronology and evidence

- Counter-event tests first produced three missing-event failures, while zero/cancelled changes already produced no event. A source-control-change case then failed (attributed to player2 instead of the player1 ability controller); explicit initiating-controller provenance now fixes that case without changing the source snapshot.
- Counter events preserve causal information through serialized replacement decisions, report clamped removals, update turn history and produce a resolving observer trigger. Source-free rules changes do not invent an actor. No new counter storage or generic plugin layer was introduced.
- Initial focused checks: 108 tests in five files passed, including the temporary BP01 theatre. After scope clarification, the BP01 card/tests and phase-context addition were removed; the unchanged 65-card catalog and 24 annotated examples normalize.
- Post-scope full serial regression: **90 files / 1,220 tests passed**. Both TypeScript checks passed. Read-only review then found missing known-source attribution in damage-derived counter mutations; the three damage-keyword branches now retain it. Its new Wither batch regression failed before the fix and passed afterward. Follow-up damage/counter checks: 24 passed in three files; combat/replacement/client checks: 25 passed in four files. Server TypeScript was rechecked after the fix. Review confirmed the finding is addressed. The full run precedes that narrow follow-up; final whole-starter verification remains open.
- Next, opt-in creature Scorch was added in `src/engine/mechanics/scorch.ts` and the state-based planner. It checks current attack plus maximum health continuously and uses normal destruction. Artifact/Relic counters remain allowed without a destruction threshold.
- The source catalog now includes `AchillesMinion` / `achilles-minion` with optional entry Scorch 1, and `IgnitionWolf` / `ignition-wolf` with optional entry Scorch 3 targeting a card with zero Scorch. `TargetingDefinition.counter` supports `{ type, min, max }`; selection and revalidation share the counter target filter. This records those authored consumers, not proof of every starter card's whole text.
- Latest focused Scorch-stage verification: **44 tests in three files passed** (`scorch.test.ts`: 13, counter events: 9, effect resolver: 22), and the server TypeScript check passed. These checks follow the historical full run above; there is no final full-suite claim for the current changes.
- Subsequent starter work now implements hand activations and ordered activated effects; Fireball per-mode speed; immediate Creature actions and explicit immediate abilities; shared-per-event observers; bounded reveal and self-claims; equipment; actual destruction triggers; local outcome guards; live counter totals; summon provenance; and Maadini's conditional whole sequence. The inventory above reflects the fresh catalog, including `flame-emperor-achilles`. The final combined validation and both-client source/log audit remain open.


### Focused coverage leading to the final run

Focused runs recorded by the implementing agents cover the following paths. They are not a substitute for the final serial regression, both typechecks, production build and read-only review; the earlier 90-file / 1,220-test full run does not describe this current diff. No commit or push was made.

| Consumer / behavior | Focused test file(s) |
|---|---|
| Actual counter changes, causal controller and continuous Creature Scorch | `counter-events.test.ts`, `scorch.test.ts` |
| Hand ownership, atomic source discard, retained source and ordered activation | `hand-activation.test.ts`, `starter-hand-consumers.test.ts` |
| Fireball slow/fast modes and Artifact counter placement without guessed destruction | `mixed-mode-timing.test.ts` |
| Immediate casts/abilities, optional/replacement continuations, normal blocking and real Strong wolf shared draws | `immediate-actions.test.ts`, `shared-trigger.test.ts` |
| Exact top three, ordered bottom return, selected-hand/bottom self-claims, Andu actual-discard guards and Emperor frozen count | `bounded-reveal.test.ts` (11 focused tests passed before the final combined run) |
| Unattached equipment, free main-phase attach/reassign and ordered draw/damage | `equipment.test.ts` |
| Actual destroy/discard success, indestructible, cancellation, exile replacement and serialized decisions | `resolution-outcomes.test.ts` (5 focused tests passed) |
| Real Wolf King cast/entry/target/destroy/draw, failed destruction, countering, target fizzle and same-card reentry | `wolf-king-keps.test.ts` (7 focused tests passed) |
| Chiron destruction and Temple remaining-health ties/revalidation, attack Scorch and Artifact deferral | `chiron-temple.test.ts` |
| Live numeric total of named counters within a filtered board | `counter-total.test.ts` |
| Maadini friendly-type condition, whole ordered damage/permanent buff, recheck and departure reset | `maadini.test.ts` (3 focused cases reported; included in the final combined run) |
| Emperor one-hit attack damage, admitted player/Creature targets and friendly-attack reveal | `flame-emperor.test.ts` (3 focused cases reported; final combined verification pending) |

The latest reveal/outcome run passed **16 tests in two files**; the latest Wolf King/outcome run passed **12 tests in two files**. These overlap and must not be summed as separate unique tests. Authoring documentation now shows the exact supported fields and examples rather than presenting the former deferred primitives as still missing.


## Completion audit

18 October 2026. Completed under the confirmed 24-card scope and explicit Artifact/Relic Scorch deferral. No commit or push was made.

| Requirement | Final evidence |
|---|---|
| All selected workbook consumers | All 24 catalog IDs above are present in the central 60-card `st01aTestSetup`; its room snapshot enables Scorch and preserves the existing opening. All 79 catalog definitions normalize. |
| Exact authoring format and limitations | All 32 commented examples parse and normalize. The library reference covers the new fields, their lifetimes and their actual consumers. |
| Gameplay behavior | **106 test files / 1,330 tests passed** in one final serial run (215.80 seconds). Includes the consumer files above, replacements, target revalidation, counter/SBA damage, payment, cleanup and terminal flow. |
| Frontend/backend delivery | The actual server with two Socket.IO clients proves immediate summon/entry, hand-discard Scorch destruction, clear card/trigger/effect summaries, reveal receipts and subsequent claims. A fresh ST01A match reaches game over using ordinary commands without editing game state. Equipment and every individual starter clause have focused engine coverage; this does not claim a live match exercised all 24 distinct cards. |
| Build | Server and client TypeScript checks passed; server compilation and production Vite build passed (100 modules, 292.99 kB JS / 91.55 kB gzip). |
| Review | Independent read-only review found a stale reveal self-claim. Claims now require the post-disposition source zone/revision; Broken Fireball and Andu zone-round-trip regressions first failed, then passed. Review confirmed the fix. Immediate summaries now mark skipped/fizzled effects using actual resolution results. No remaining Important findings were reported. |
| Deferred scope | Relics can receive and contribute Scorch counters, but have no invented Scorch destruction threshold. Emperor damage targets only the opposing player or an opposing Creature. BP01 and other factions remain excluded. |

The earlier partial verification notes are chronological evidence; this final audit supersedes their pending full-run status.
