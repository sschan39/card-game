# Workbook mechanics review

16 October 2026. Source inspected against engine baseline `b4a67ab`. **Analysis and proposals only; no mechanics are implemented by this document.** This supersedes the earlier assumption that the source inventory was only the 24 炎獸 cards. The [ST01A consumer report](vertical-refinement/07-st01a-card-consumers.md) remains the record of those eight loaded full/partial definitions. [History and scheduling gaps](history-and-scheduling-gaps.md) records the preceding discussion.

Current follow-up: [small card mechanics](vertical-refinement/09-small-card-mechanics.md) implements existence bonuses, source-specific discard actions/events and ordered ordinary triggers, with eight consumers. The baseline gaps below remain historical analysis where superseded; reveal, local results, outcome conditions and destruction-vs-death remain open.

## Recommendation

Continue one vertical consumer at a time. The next small engine change should let a normal triggered ability contain an ordered effect list, then use **諸界火術士** to prove friendly 幽爾 Creature attacks -> choose opposing Creature -> damage 2 -> draw 1 -> readable results on both clients. Its trigger watches any friendly 幽爾 attacker, including itself; it is not merely a self-attack trigger. This consumes the existing resolution machinery without introducing a new subsystem.

After that, add only the missing capabilities needed for conditional outcomes, 赤狼's bounded reveal, and confirmed Scorch rules. Other factions provide real requirements for later work; they do not authorize implementing every extension now. General X-turn timers and a whole-game history database are not the first requirement revealed by these cards.

## Source inventory and limits

Source: [`tem/六界之峰.xlsx`](../../tem/六界之峰.xlsx). Card columns are A name, B cost, C element, D race, E rules, F attack, G health, I rarity, J set and K type. The 虛界靈 rarity heading is in H while its row values are in I. Printed IDs are not supplied as a stable ID column.

References below abbreviate the sheet `BP01 - 元初大地` as `BP01`. Rules references mean `游戲規則!A1`.

| Sheet / inspected range | Named rows | Notes |
|---|---:|---|
| 炎獸!A2:K25 | 24 | Current loaded real-card slice comes from here. |
| 幻影木偶!A2:K24 | 23 | Graveyard, soul-death, equipment and conditional costs. |
| 風獸!A2:K24 | 23 | Reveal, fast summons, tap/ready restrictions and stored cards. |
| 冰龍!A2:K26 | 25 | Counter-granted prevention, equipment, response effects and combat rules. |
| 上使!A2:K24 | 23 | Healing, tokens, game limits and cards placed under a host. |
| 蒼巨人!A2:K25 | 24 | Milling, ritual, ownership/zone-holder differences and random effects. |
| 虛界靈!A2:K13 | 12 | Nine rows with effects; three named placeholders without rules. |
| BP01 - 元初大地!A2:K146 | 111 | Includes six repeated 虛界靈 rows, named unfinished designs and 34 rows without names. |
| 雙色補充包!A2:K13 | 12 | Six dual lands and six multielement characters. |

There are **277 named row occurrences**, not 277 complete unique cards. There are 270 distinct name strings; six 虛界靈 names repeat across sheets and the placeholder name 虛界 appears twice. Blank effects can mean a vanilla card or an unfinished design; do not classify them without the remaining data. BP01 rows 136–138 have names but no cost/rules. TRPG, 世界觀 and creature-template sheets are not treated as playable card definitions. `游戲規則!A1` is the separate rules source.

## Rules and source questions before implementation

These are unresolved requirements, not assumptions to hardcode:

| Question | Source evidence | Why it changes the design |
|---|---|---|
| Six energy elements and aliases | Canonical 炎/魔/風/雷/雪/海; workbook 木/寒 mean 風/雪. 冰龍!B7:B8 uses 兵. | Owner corrected the palette to red/black/green/yellow/white/blue. See [consumer implementation](vertical-refinement/08-existing-mechanics-consumers.md): old colorless resource is replaced by yellow, 無 stays generic. 海 authoring is now included where all printed effects fit current mechanics; 兵 remains unresolved. |
| Scorch threshold | Rules A1 Q1/Q7 say energy cost total; several cards say 能力總值; 炎獸!E15/E23 explicitly say two counters. | Confirm printed/effective/paid cost interpretation and whether the fixed-two clauses are intentional overrides. Never count the number of engine abilities as the threshold. |
| Creature health vs marked damage | Rules say damage reduces life; cards restore creature life or reach its maximum, e.g. BP01!E42. | Confirm whether damage clears at turn end, what health reduction changes, and how healing interacts with stat changes. Current engine uses toughness plus marked damage and clears damage at cleanup. |
| Destruction vs death vs 魂滅 | Rules Q3 requires destruction and graveyard; Q8 defines non-damage zero-health departure. | Current `ON_DIE` means Creature battlefield-to-graveyard, including causes other than destruction. It is not an exact alias for either custom term or for destruction of a Land/Artifact. |
| Attack sequence | Fast summon/untap/re-attack consumers appear in BP01!E49:E69; rules have attack/block response windows. | Confirm simultaneous attacker batches vs sequential attacks, attacking after untapping, summoning sickness and opportunities for newly summoned creatures. Current engine has one ordinary declaration batch, so an untap alone does not grant a second declaration. |
| Chain | Rules section 6/6a defines specific fast windows and opponent-first offer; 炎獸!E6:E9 suppress them. | This is not ordinary unrestricted MTG priority or a blanket ban on casting. Define response-opening and suppression scope. |
| Relative time and “cannot repeat” | 風獸!E15/E21/E22, BP01!E32; 炎獸!E6, 幻影木偶!E19. | Define whose boundary, expiry point, and shared/nonstacking group. Per-source once-per-turn is a different rule. |
| Game-once identity | Many sheets say 效果游戲一次. | Decide whether leaving/re-entering, another copy, and controller changes reset or share the budget. Stable UUID does not decide the rule by itself. |
| Source inconsistencies | BP01!K85 says 裝備 while its race/text describe a mana land; BP01!K86 says 地界 while text/F86 describe equipment. BP01!E61 discounts 魔 for a 迅靈 consumer; 冰龍!E22 specifies half damage without rounding. | Preserve the raw wording and obtain a decision. Do not silently normalize these into invented mechanics or costs. |
| Selection/target details | “lowest health”, “for each ... deal 5”, “opponent player / one card”, multiple selection categories. | Define ties, current vs maximum health, one multiplied hit vs repeated hits, allowed card types and target timing before choosing a schema. |

Additional base-game differences in `游戲規則!A1`: one mulligan; RPS winner chooses order; first-player attack skip; draw before ready; both players' unused energy clears at turn end; only effects explicitly addressing 地界 can affect them; a special starting-hand option for 虛界靈. The workbook specifies failed draw in the draw phase, while the engine's failed-draw loss also covers effect draws. “Five phases” is followed by six listed phases. These belong to a small explicit custom rules configuration, not card-name branches. Policy settings stay in `src/config.ts`; source wording belongs in data/docs.

## Existing pieces to reuse

Ordinary energy production/choice, casting, costs, target groups, choices/reconnect, ordered spell effects, entry/attack/block/death/life triggers, counter storage, static stats and ability grants, temporary stats, direct zone moves, library ordering/shuffle, replacement/prevention and manual combat allocation already exist in bounded forms. Keep their authoritative reducer/checkpoint boundaries.

The presence of a runtime field is not an authoring workflow. In particular: `attachedTo` has detachment/SBA consumers but no complete equip action; tokens have cleanup support but no authored creation action; non-hand/nonbattlefield zones are not fully admitted cast/activation sources; and `OperationOutcome` does not yet make earlier instruction results available to a later card instruction.

Low-extension candidates after the element mapping is settled include mana creatures, vanilla creatures, 諸界游歷者's tap/draw (風獸!E7), 初級風疲術 (風獸!E9), temporary attack bonuses and the draw/gain-life clauses of simple spells. These help build usable decks without expanding every mechanic first. “速：可以從手牌召喚此卡” can reuse instant admission for that creature; it does not by itself require a new summon system.

## Needed mechanics and the smallest useful approach

### 1. Ordered abilities and conditional instructions

**Consumers:** 諸界火術士 (炎獸!E8), 天域門衛 (上使!E5), 幻海人 戈圖 (蒼巨人!E5), 烈焰狼王 凱普斯 (炎獸!E21), 强權崛起 (炎獸!E17).

**Gap:** spells already have effect lists; ordinary abilities have one base effect. There is no ordinary per-instruction condition or authorable “the previous destruction actually succeeded” result. Replacing a compound ability with independent triggers or fake modes changes its meaning.

**Approach:** normalize an ordered ability list into the existing stack-effects/cursor flow, retaining compatibility with single `effectId` definitions. Reuse the same targets and continuation. Then add a bounded condition/result read for the concrete consumer. Check existence conditions at the defined instruction point; do not substitute creature count for a fixed extra draw. “Draw two, plus one if any exist” is not “draw two plus their count.” 强權崛起 says 場上, without 我方; BP01!E10 explicitly says 我方場上. Preserve that difference in controller criteria unless the source is corrected.

For conditional destruction, use actual committed operation results/events after replacement, not merely attempted targets, generic `committed`, or “the card left.” Regeneration, cancellation and an unrelated move must not create a false success. Decide how destruction redirected to exile counts under the custom rule. Keep all clauses in one ability object with ordinary response windows outside it, not between clauses. Reuse current resolution/checkpoint behavior rather than adding a second interpreter.

### 2. Local results and computed values

**Consumers:** 幻像祭壇 (幻影木偶!E12), 幻影魔神 赫拉尼亞 (幻影木偶!E22), 諸界六皇 萬智之德步尼 (蒼巨人!E24), 炎獄之主 洛基尼亞 (雙色補充包!E8), 張角's damage based on actually tapped altars (BP01!E113).

**Gap:** a later instruction cannot reference the exact cards previously revealed/milled, their retained cost/type values, or the number of resources actually paid. A player-announced binding cannot capture these values.

**Approach:** add an explicit small result context to the existing resolution/payment continuation when the first consumer needs it: exact `{uuid, zoneRevision}` sets, necessary snapshots and named numeric results. Record when a result is captured and retain it across choices/reconnect. Count the result set, not the whole graveyard or a later query of moved cards. Do not introduce persistent global variables or a game-wide event search language.

### 3. Shared criteria and numeric query extensions

**Consumers:** 赤狼's self exclusion; 風靈 cards' name substrings and distinct-name choices; cost-bound revival/ritual; 阿基里斯血炎神殿's lowest-health selection; 罪孽的過去 (BP01!E19).

**Gap:** target/search/count/static filters differ in supported fields. Missing requirements include name family, exclusion, counter/tapped state, cost value, extrema, and constraints over a selected set. Numeric expressions have count/field/add/multiply, but no sum over characteristics or explicit floor division.

**Approach:** extend the existing shared matching helpers only with fields needed by the selected consumer, so server validation and client highlights agree. Preserve OR within filter lists and AND across filters; mixed categories can require existing separate target/selection groups. Add `sum` and explicit integer division/rounding only with a consumer such as sum of friendly 烈龍 attack / 2, rounded down. Some “per N” text instead means repeated hits, whose trigger/prevention behavior differs from a multiplied hit; confirm it first.

Do not use unrestricted functions or evaluate card text. A `manaValue` query needs the confirmed printed/effective-cost definition. A `counterTotal` query needs the requested scope. Dynamic mana output, dynamic use limits and numeric payment selections each need their own consumer integration; supporting an expression in effect parameters does not establish them.

### 4. Bounded reveal, top-card milling and ordered remainder

**Consumers:** 赤狼 (炎獸!E5), 寒霜使者 (冰龍!E3), 幻影工兵 (幻影木偶!E4), 蒼海巡察組 (蒼巨人!E3), most faction searchers; draw from bottom in 聖能術 · 速 (上使!E11).

**Gap:** existing search selects from an entire zone. It cannot isolate top N, remember revealed/milled cards, select required categories from that set or finish an ordered remainder. The follow-up now distinguishes `CARD_DISCARDED_FROM_HAND` and `CARD_DISCARDED_FROM_LIBRARY`; top-card discard is implemented. Bounded reveal/select/remainder is still missing.

**Approach:** a resolution-local top-N result, explicit public reveal event when relevant, existing choice panels for selection/order, and existing zone/library operations to finish. Handle a library shorter than N. Leave cards in their real zone while revealed; information changes must not create fake occupants or zone revisions. `OperationOutcome` can emit a real reveal event even if no card moved. For milling, capture cards before moving and publish actual committed outcomes; decide custom mill/discard event semantics separately from ordinary MTG discard.

Start with 赤狼's plain reveal/select/bottom flow. The next consumer establishes when revealed-card self-permissions are offered: during that window or after its parent resolves. Do not silently let queued reveal triggers and the parent select the same card twice. This is an explicit continuation/choice contract, not a whole-zone search workaround or an automatic need for a permanent reveal database.

### 5. Off-zone effects, paid resolution choices and summon provenance

**Consumers:** 睿智之怒焰狼 / 炎極雇傭兵 (炎獸!E7/E14); 幻影木偶 (幻影木偶!E2); 風靈獸 巧兔 (風獸!E3); 赫拉幻影術 (幻影木偶!E20); 幻影魔神 (幻影木偶!E22).

**Gap:** ordinary activation starts on the battlefield; its discard cost selects other hand cards. Source-zone access, source-self discard, choosing a card and paying its effective cost during resolution, and triggered self-access from hand/graveyard need explicit support. Free placement is not necessarily casting.

**Approach:** carry allowed source zones through normal option/admission/payment paths; add the selected source-self cost through the existing atomic payment planner. For graveyard summon, distinguish paying a selected effective cost, casting without a cost, and directly placing a permanent. Reuse existing payment/choice continuation, not recursive fake player commands. Record entry provenance (normal/special, origin, relevant cause) on the event/current incarnation so cards can filter it. Observe departing/revealed event-card abilities in the required zones, including when the source is no longer on the battlefield.

An effect-placed land should use the existing zone move, not pretend it consumed an ordinary land play. Conditional graveyard costs need cost modifiers/admission rather than rewriting the printed blueprint.

### 6. Different main/fast instructions and cost modification

**Consumers:** 火球術 (炎獸!E11), 風靈再生 (風獸!E10), 聖能術 · 速 (上使!E11), 罪孽的過去 (BP01!E19), next-summon discounts in 虛界靈!E10 and BP01!E36/E61.

**Gap:** current modes append effects after a single card-speed gate. Printed-cost overrides, conditional/off-zone discounts and “next matching summon” reductions are not a shared cost-modifier contract.

**Approach:** select the existing instruction mode before final timing validation and allow its defined timing, preserving a shared cost/payment route. Do not grant every mode instant timing. Add a scoped cost adjustment used by preview and actual payment, with a concrete matching source/element/family, floor-at-zero policy, expiry and consumption on a successful qualifying action. Rejected actions do not consume it. Do not implement a general action graph or special mana parser per card.

### 7. Counter mechanics: Scorch, charge and Aurora

**Consumers:** 阿基里斯爪牙 / 點火狼 / 烈焰弩炮; 極光冰龍 (冰龍!E5); 天使皇 亞拉里亞 (上使!E23); nonremovable +2/+2 counters (BP01!E41).

**Gap:** named counter storage exists, but no ordinary counter-placement trigger or counter-cost selection; thresholds/benefits are not generated by an arbitrary counter name. Target predicates cannot yet express all counter restrictions.

**Approach:** derive canonical counter-change events from actual committed changes, with before/after, amount and source/cause. Add counter removal as an atomic cost when a real charge consumer is selected. Define confirmed Scorch behavior in the custom rule data/hook using generic counters and the chosen threshold characteristic, not a universal Scorch check for every MTG room. Its checkpoint destruction must use the existing destruction pipeline. Only expose counter tags/rules that have consumers.

Aurora needs a counter-qualified prevention rule and its own per-turn use key; an ordinary post-damage trigger would be too late to prevent lethal damage. Resolve whether the first eligible event consumes it automatically or the player may choose. Counter-granted abilities/bonuses should derive from actual counter presence and disappear with it. Distinguish a one-use-per-turn 3-point prevention from a 3-point shield pool spread across a turn. Fixed-two Scorch and nonremovable counters remain semantic questions until confirmed.

### 8. Usage budgets, nonstacking and effect progress

**Consumers:** 幻影木偶工廠 / 天域三侯 伊雲 / 大天使 費蘭尼 game-once text; 天使的皇座 (上使!E20) shares its ②/③ turn budget; 强攻之怒焰狼 (炎獸!E6) says 不能重複; 炎極三公 奧德修斯 (BP01!E23) has an ordered effect progression.

**Gap:** only per-source-incarnation, per-ability turn uses exist. Game-once, shared ability groups, nonstacking across sources and a cycling/progression rule are not equivalent.

**Approach:** extend the existing usage check with the smallest explicit scope/group key required by the next consumer. Keep game-scoped facts outside `turnHistory`; do not key them by labels. Record uses after commitment/discovery as appropriate and reserve pending uses consistently. Clarify reset/identity policy before reusing stable UUIDs. Nonstacking needs its own authored group/applicability rule, not `limitPerTurn: 1` on every copy. Clarify whether 奧德修斯 cycles, stops, resets, or allows selection before adding a stage counter.

### 9. Relative lifetimes, readiness and combat restrictions

**Consumers:** 風靈獸之子 / 狂獅大將軍 (風獸!E15/E21), 幻影木偶 穆頓 (BP01!E32), “this battle” bonuses (幻影木偶!E18, 風獸!E10), no-block/forced-block and forced-first-attack effects in BP01.

**Gap:** end-of-turn/permanent/source/attachment lifetimes do not express combat end or another player's next start. Preventing a ready action is not just a duration. Existing combat hooks are extension seams, not authored rule definitions for every restriction.

**Approach:** first add the concrete boundary/one-opportunity record required: affected exact incarnation, whose boundary, whether the current occurrence counts, and removal/consumption rule. Reuse that small boundary matcher for effect expiry and delayed actions, while keeping their meanings distinct. The ready planner consults a skip-ready record before untapping. Combat restrictions consume the existing whole-declaration validators/damage hooks; manual allocation remains manual.

Do not build a universal N-turn/N-event scheduler now. Define attack-loop semantics before implementing untap/re-attack, “must block if able,” or “attack first.” Ending one combat and ending the remaining attack phase are separate operations, not changing `phase` to an arbitrary value.

### 10. Equipment and cards held under a host

**Consumers:** 諸界烈刃 (炎獸!E20), 幻影木偶 equipment, most 冰器 cards; 天使的皇座 / 縛鎖 (上使!E14/E20), 風靈獸 大酋長里昂 (風獸!E23), 傀儡酋長 (雙色補充包!E9).

**Gap:** complete attach/equip admission, conditions, capacities and wearer-trigger routing are missing. Cards placed under a host are not the same as equipment attached to a creature.

**Approach:** equipment uses an explicit exact-incarnation relation and ordinary choices/costs, grants scoped stats/abilities to its wearer, and lets existing attachment SBAs clean up invalid relations. Define whether “this creature” means the wearer, and the effect's damage/source origin. Confirm equip timing/cost/default capacity before implementing.

Stored cards need a real off-battlefield location/relation, retaining owner and host incarnation; they must not be fake battlefield permanents. Counts and release effects read that relation. Decide default handling when the host leaves, which only some cards explicitly override. Keep storage distinct from equipment so moving a land beneath a host cannot leave its ordinary mana ability active.

### 11. Void zone and activation from it

**Consumers:** 虛界靈!E2:E10, BP01!E16/E55/E62/E82 and abilities changing a Void spirit's use limit.

**Gap:** `CardZone` and all ordinary source lookups have no 虛界 zone. Static `activeZones` alone does not create a legal location or activation path.

**Approach:** add the actual zone to the existing move/reset/serialization/UI vocabulary, then enable explicitly admitted abilities there through the shared activation/payment flow. Add the opening-hand substitution only with the setup consumer. Set whether entry charges, counters and source limits reset under the confirmed zone rule; ordinary stable UUID + revision rules still apply. Do not model Void as exile with an invisible flag.

### 12. Tokens, ritual and selected-resource costs

**Consumers:** 天域神城 / 雷霆之門 (上使!E8/E17), 死亡組裝 (幻影木偶!E17), ritual creatures (蒼巨人!E13/E14; BP01!E7/E21/E38/E112), 雷巾祭壇 (BP01!E96/E113).

**Gap:** token cleanup is not a creation effect. Costs can sacrifice the source but cannot generally select several permanents, pay their destruction/tapping/exile/counters, or test their combined energy value.

**Approach:** create a token from a data blueprint with a genuinely new UUID through the reducer; record actual creation/entry. Define whether named altar copies are tokens or other created cards. Extend the existing cost planner with the first needed selection/resource payment, exact references and atomic validation. “Destroy three” as an effect is not automatically a cost; “destroy total value greater than 3” must not be silently changed to sacrifice or >=3. Record actual paid selections/counts for subsequent damage. New token creation is dis
### 13. Damage, health protection, 魂滅 and actual removal causes

**Consumers:** 赫拉鬼火術 / 幻影木偶 鬼斧; 極光之盾 (冰龍!E11); 巨龍之墓 (冰龍!E23); healing bonuses / set life to 30 (上使!E21/E22); 冥者 cards.

**Gap:** current post-move death events do not distinguish the custom causes. No authored general creature-heal action, health floor, numeric healing boost or zero-health rescue offering exists. Zero toughness and lethal damage already take different engine paths, which should be preserved rather than conflated.

**Approach:** carry committed cause/provenance through reduction, replacement and departure. Derive the confirmed 魂滅 semantic event from non-damage zero-health departure; ordinary damage death, explicit destruction and sacrifice stay distinguishable. Exiling a would-be soul-death recipient belongs in the pre-commit replacement path, not an impossible attempt to target a card after its departure/reset. A last-moment optional rescue must be offered by the existing SBA/replacement continuation before irreversible removal; an ordinary death trigger is too late.

After health semantics are settled, add a proper creature-heal operation rather than a positive toughness buff or negative damage. Floors/boosts modify the proposed operation before final damage/life events; merely healing afterwards can lose the game or fire incorrect triggers. “Life cannot fall below 5” must cover the confirmed damage/life-payment cases and whether costs can be paid at that floor. Do not create separate effect pipelines per faction.

### 14. Chain, targeting events and effect immunity

**Consumers:** 炎獸 Chain suppression; 冰風守護者 (冰龍!E6); 極光之壁 / 極光封 (冰龍!E17/E19); 諸界六皇 冬機之卡斯拿斯 (冰龍!E25); hand/graveyard protection (蒼巨人!E15).

**Gap:** existing countering can address stack spells/abilities, but subtype admission such as “summon-time creature ability,” target-redirection choices, response-opening suppression, and “cannot be affected” are not covered by basic target legality. A blanket cast prohibition, Hexproof or removing abilities would change those rules.

**Approach:** settle Chain timing as a custom priority policy consuming the existing stack/priority state. Preserve a reason/context for each opened response opportunity and authored suppression criteria. Expose targeted/selected metadata only at an actual announcement boundary, not on browser highlight or proposal preview. Redirection must update the whole selected target group and revalidate; never just rewrite one pointer in an effect.

Extend counter targets with the smallest required ability/event classification and preserve the countered source's exact reference for a following bounce/destroy. Effect immunity must distinguish targeted vs nontargeted effects, opponent source and operation scope; do not equate it with Shroud. Deep targeting work remains a separately reviewed slice, as previously requested.

### 15. Player zones, randomness and energy spending permissions

**Consumers:** 幻變之海 洛基尼亞 / 蒼海帝 洛基 (蒼巨人!E22/E23), 永恆魔洋 (蒼巨人!E16), 海神之怒 (蒼巨人!E21), 神海天使 (雙色補充包!E13), dynamic/multicolor producers (風獸!E6, BP01!E68/E69).

**Gap:** private-zone arrays currently belong to the card's owner. Taking an opponent-owned card into one's own hand therefore needs an actual zone-holder distinction. Random selection and temporary ability to spend sea energy as another element are not ordinary generic costs. Mana abilities currently require fixed positive output; ordinary effect numeric support does not automatically make their amount dynamic or produce several colors at once.

**Approach:** only when selecting that sea consumer, distinguish immutable ownership from current zone holder and controller in zone lookup/move/reset and the client hand. Do not alter ownership to fake drawing an opponent's card. Prepare and record a random selection once, as shuffle already does, so reconnect/resume does not reroll. Retain revealed name/reference for a temporary same-name restriction.

Scoped spend-as permissions apply to the selected card/action through normal payment validation until their expiry; do not globally convert the pool. Dynamic and six-color production should extend the current mana planner with retained concrete outputs, preserving its immediate non-stack behavior. Resolve the six resource IDs first. This does not require a new permissions/security or private-view project.

## One-at-a-time delivery order

This is a proposed sequence, not approval to implement all items. Each row ends with a real card, ordinary UI choices, correlated readable logs and a useful negative scenario.

| Next slice | Concrete consumer and finished behavior | Boundary |
|---|---|---|
| 1. Ordered triggered effects | 諸界火術士: each friendly 幽爾 Creature attack produces one trigger, choose opposing Creature, damage 2 then draw 1 | No reveal, new history store, equipment or Chain suppression. Prove watcher filters, stale-target behavior and one stack object per trigger. |
| 2. State/outcome conditions | 强權崛起's fixed conditional extra draw, then 烈焰狼王's draw only on actual destruction | First state condition, then actual-result dependency; preserve replacement semantics. |
| 3. Bounded reveal/result set | 赤狼: actual top three, exclude 赤狼, choose eligible 炎獸, order remaining bottom | No whole-zone substitute. Reactive reveal consumers come only after their timing is agreed. |
| 4. Scorch vertical | 阿基里斯爪牙: optional placement, actual counter event, confirmed threshold destruction | Requires threshold decision. Next consumes no-existing-counter restriction and shared draw only as separate small slices. |
| 5. Complete existing partial fire cards | 火球術's separate main/fast timing; then hand-discard Scorch on 睿智之怒焰狼 | Reuse payment/targets; Chain clause stays visibly partial until its profile is settled. |
| 6. Next faction by one consumer | E.g. 幻影工兵 for mill/recover, or 風靈獸之子 for skip-next-ready | Implement only that selected dependency through the existing client/server flow. |

Once-per-game limits have many actual consumers and should be added when the first game-once card is selected. Equipment, Void, ritual, counter-prevention, hosted cards and sea ownership effects are real future needs, but are larger separate vertical slices. Do not silently bundle them into the first compound-effect change.

## Options considered

1. **Small shared additions driven by one card, recommended.** Preserves existing choices, resolver, event/logging paths and avoids idle extension code. Record a clear unsupported clause until its slice is done.
2. Build the entire custom rules profile and every faction mechanic first. Broader fidelity sooner in theory, but too much unused machinery and too little visible play for the owner's stated preference.
3. Encode approximations with independent triggers, fake modes, card-ID branches or text parsing. Rejected: these can make a demo run while changing the card's actual timing/outcomes.

## Analysis verification and implementation acceptance

This review read all named rows and placeholders in the nine card sheets, plus `游戲規則!A1`, and compared the requirements to current parser/types, effects, numeric queries, choices, zone operations, event derivation, history, combat and replacement contracts. Counts distinguish rows from unique names and incomplete designs. The workbook is unchanged. This is not a new claim that all listed cards are playable or tested.

For any later slice: verify actual authored card data, normal source admission/cost, proposals vs committed outcomes, exact object revisions, one continuous resolution/choice path, both clients and clear card/trigger/effect names in logs. Add positive and relevant negative/replacement cases for the chosen mechanic. Keep settings centralized, preserve manual combat decisions, and update the catalog format reference only after the new syntax actually exists.
