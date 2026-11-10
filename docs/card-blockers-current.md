# Current workbook card blockers

Updated after the [Blue Giant mill delivery](#blue-giant-mill-consumers), following the [shared card infrastructure implementation](shared-card-infrastructure.md) and [counter/optional payment delivery](counter-payment-architecture.md). The original audit used engine snapshot `105dce59`; this ledger reflects effective-cost characteristics, deck policy, ordinary game usage, causal outcomes, atomic counter payments, shared captured-window visibility and explicit triggered-ability listener discovery.

Source: local ignored `tem/六界之峰.xlsx`, SHA-256 `27b91d995e22fb8540a04c78a73d41f64daa08b216b275aceb1f282723a64d7d`. Include 炎獸, 幻影木偶, 風獸, 冰龍, 上使 and 蒼巨人. BP01, 虛界靈 and 雙色補充包 remain excluded from new implementation. Existing excluded definitions are retained.

## What “unblocker” and “unblocked” mean

An **unblocker** is a delivered capability or explicit owner ruling that removes a specific dependency. It needs an actual parser-to-runtime consumer and evidence of the relevant behavior. A schema field, unused keyword, future design or generic interface alone is not an unblocker.

A **U — unblocked** card can have its complete printed behavior authored faithfully using existing supported consumers and accepted rulings: costs, timing, zones, targets, optional/mandatory choices, duration, identity and applicable deck restrictions. Composition must have evidence, not just independently plausible pieces. It still needs its production definition, manifest registration and card-specific release verification. “Unblocked” does not mean “already implemented.” Readiness here assumes the currently supported format profile; it does not certify every workbook-wide format rule.

Other labels, which can overlap:

- **B — confirmed technical blocker:** a missing runtime consumer, query/value operation, event, payment/lifetime contract or policy mapping. The row identifies it; not every B requires redesigning the engine.
- **W — wording/ruling dependency:** intended behavior is unsettled. Ask when implementing; do not turn an assumption into a requirement for new engine code.
- **P — composition/lifecycle proof missing:** related primitives exist, but the complete behavior has not been demonstrated. Investigation may clear it without code changes. This is deliberately distinct from a proven missing primitive.
- **Registered:** a matching name exists in the explicit catalog. This is a coverage fact, not certification of workbook fidelity or balance.

An ability is not ready merely because one clause works. A card moves to U only after every dependency is cleared; a registered card can still have fidelity gaps.

## Owner clarifications and implementation direction — 4 November 2026

The cost ruling and the shared implementation directions below are delivered. The owner has not yet settled a broad multi-source kill-credit rule; contributor receipts and lethal-making causes remain separately inspectable.

**Effective cost.** For 幻影木偶, every mana-cost query returns zero while it is in the graveyard and its printed phase/board conditions hold. This includes eligibility/threshold queries, not merely the amount paid to cast it. Leaving that zone or losing the condition restores the ordinary effective value. Use one room-aware effective-cost resolver and derive total mana value from its structured cost; preserve the printed blueprint separately for inspection or explicitly printed-cost queries. Cast payment starts from that effective cost, then applies payment adjustments once. This ruling does not itself grant ordinary graveyard casting. The shared query consumer and production phantom definitions are now implemented.

**Deck policy.** The implemented validation design uses an owned, schema-validated config file for format bounds and per-card numeric/unlimited/excluded exceptions. Compile it into the same shared validation policy for the builder and server; the server's policy remains authoritative when saving and starting a game. The existing format/eligibility JSON and pure validator are the starting point. Extend the numeric copy-limit mapping rather than give the builder independent hardcoded exceptions or trust a browser-supplied policy.

**Once per game.** Extend the room's structured use counters/history and existing usage identities, with a pure availability query. Use a stable ability identity plus an explicit scope (physical card, current incarnation, player or shared group). A physical-card key must survive zone changes; ordinary current-incarnation turn keys are not sufficient. Increment exactly once when the declared use is committed, not during availability queries. Specify trigger consumption separately (enqueue versus successful resolution). Reset game-period counts on a new match; reconnecting must not reset them. Reuse/generalize `gameRuleUses` and turn-history machinery instead of scanning display logs or adding a parallel modifier-only counter.

**Sources and causes.** Damage, rule/effect changes, state changes and departures should share a serializable cause/source contract. Extend the current event identities, `BatchCause`, source snapshots and proposed-event transaction. Preserve source card UUID/revision, ability and stack identity, controller-at-cause, parent/root cause, affected object identity, change reason and actual outcome. Changes from game rules can have a system cause without a source card. Carry causality through replacements and state-based lethal checks; keeping only the last source string on a damage event cannot reliably answer “this effect killed that creature.” Record actual damage after prevention, retain source information when the source leaves, and distinguish sacrifice/destroy/lethal departure. Contributions from multiple simultaneous or persistent causes need an explicit attribution rule rather than guessing from event order.

**SOUL.** The owner does not want a distinct soul-death type for now. For the relevant exile wording, represent it as “if this effect kills X, send X to exile.” This is a source-scoped outcome/destination rule, not a global rule that every kill exiles. Where the intended action is an exile destination, replace the lethal departure before a graveyard move; do not emit a fictitious graveyard arrival and exile afterward. A follow-up such as 鬼斧's bonus can query the attributed kill outcome independently of its final destination. Existing other zero-life rescue wording still needs its own interception behavior. The blocker family below is therefore **CAUSE**, not a new SOUL mechanic.

These shared consumers now have focused proofs. A dependent card still needs a complete recipe/composition check before moving to U. Kill outcomes retain both all contributor receipts and lethal-making causes after the victim leaves; current kill matching uses lethal-making causes, without treating the still-open broader credit ruling as settled.

## Current coverage

The explicit manifest contains **111 definitions**. The six included sheets have **142 named rows**, **85 with registered name matches** and **57 without a definition**. Of those 57, **2 are confirmed U and 55 remain deferred** for technical work, rulings or proof. The labels overlap, so they must not be added as mutually exclusive engine-blocker totals.

| Sheet | Named rows | Registered matches | No definition | Confirmed U | Deferred |
|---|---:|---:|---:|---:|---:|
| 炎獸 | 24 | 24 | 0 | 0 | 0 |
| 幻影木偶 | 23 | 10 | 13 | 2 | 11 |
| 風獸 | 23 | 12 | 11 | 0 | 11 |
| 冰龍 | 25 | 7 | 18 | 0 | 18 |
| 上使 | 23 | 12 | 11 | 0 | 11 |
| 蒼巨人 | 24 | 20 | 4 | 0 | 4 |
| **Total** | **142** | **85** | **57** | **2** | **55** |

Matching uses NFKC normalization and ignores whitespace and asterisks; source row numbers remain workbook row numbers. Only JSON imports explicitly listed in `cards/index.ts` count. Untracked duplicate files and excluded-sheet rows do not inflate coverage.

## Delivered unblockers and their limits

| Delivered capability | Now removes | Does not remove |
|---|---|---|
| Shared cross-zone filters/search | Color, type, tribe, name, condition and zone filtering; mandatory filtered take-one where supported | Permission to cast from a zone; arbitrary reveal workflows; source discovery/events; movement into someone else's hand |
| Strict rule contracts and functional families | Shared parsing and validated characteristic, permission, cast-cost and replacement rules | Arbitrary operations absent from consumers; combat restrictions; activation cost rewriting and dynamic ability-limit rewriting |
| Conditional characteristics and numeric queries | Conditional stats/keywords/types/colors and whole effective mana cost, phase/zone conditions, count/exists/counterTotal, add/multiply/round down | General division and collection sums; “the result card's mana value”; arbitrary name changes |
| Cast-cost modifiers | Conditional payment setters, reductions, increases and supported usage accounting | Changing the mana value read by other effects; granting graveyard cast permission; activation payments or color-conversion rights |
| Resolution-local mill result sets | Exact-card recovery; count actual milled arrivals; current versus recorded state after replacements | A new physical zone, under-host storage, reveal-result capture, iteration or arbitrary selected-card fields |
| Scoped mill amount | Additive quantity increases for matching sources, including later entrants for a turn-long rule | Milling cards outside an exact captured group |
| Bounded reveal improvements | Filtered mandatory/optional selection in the existing one-to-three-card take-to-hand/order-bottom consumer | Five/six/eight-card windows, top-selected/take-all/deploy/exile/mill-remainder workflows, reveal provenance or conditional repetition |
| Shared ordinary ability usage | Turn/game limits, physical/incarnation/controller identities, shared groups, immediate mana and trigger reservations | Dynamic numeric limits or changing another ability's declared limit |
| Shared counter, ritual and optional costs | Atomic source/controlled-battlefield counter costs and selected material destruction; optional `resources / pay_cost` branches with existing mana/life/discard/orientation/sacrifice costs | Selected exile, binding/storage and dynamic counter amounts |
| Captured windows and visibility | Up to configured 64 top-library cards for self/opponent, current/recorded queries, shared filters, independent selections, take-all, exact-remainder mill, per-viewer faces/count/order, reconnect history | Distinct-name selection, same-zone picked-card exclusion, recursive repetition and cross-owner hand destinations |
| Explicit event-card and watcher listeners | Before/after self-discard/mill/entry/departure snapshots; declared-zone observers including hand life-loss; retained reveal observations; effective granted abilities and shared scheduling/usage | New tap/draw-step events, event-subject targeting, selected-result values, healing modifiers, private-trigger rules or complete workbook recipes |
| Causal events and killed outcomes | Actual source/ability/root/parent data, contributor receipts, lethal-making causes, gated kill outcomes and source-scoped direct exile | Optional zero-life rescue; an owner ruling on every broad multi-source credit case |
| Config-driven copy exceptions | Twenty copies of 幻影木偶, singleton 幻影魔城/諸界海 and all six repeatable basic lands | Workbook-wide format/profile migration |
| Recent legal-action query, auto-pass and room lifecycle work | Better play/session behavior and action inspection | No card mechanic blockers are removed by those features alone |

Two newly proven recipes are **幻影木偶 鬼火** and **幻影魔鐮 鬼火**. The focused [composition tests](../tests/engine/card-blocker-probes.test.ts) exercise actual cast/entry, optional mill, attack, exact recovery, black/type exclusions, attachment/+2 attack, and removal of the granted ability when the weapon leaves. An older eligible graveyard card is never offered as a substitute. They remain absent from the live catalog in this audit.

Accepted rulings remain: 兵 is generic for now; unqualified life reduction is permanent maximum-life reduction; 生機木杖 grants +2 attack; 天域之門 alone has both battlefield sacrifice and hand-discard mana routes. Unspecified special-summon origins stay deferred. 冰陵之主's detailed wording stays for implementation.

### Counter-owned behavior needs its own proof

The [counter rule schema](counter-rules.md) now gives marked cards intrinsic effects through the existing modifier, attachment, and trigger consumers. Aurora prevents up to three damage once per battlefield incarnation. Frost gear caps at one per card and grants the equipped creature an attack draw. Focused engine checks cover recipient ownership, removing and reapplying Aurora, spent uses across turns and reload, and equipment reattachment. The remaining statuses include full card recipes and their other mechanic dependencies.

## Remaining capability families

| Code | Missing capability or decision boundary |
|---|---|
| COST | Card-specific color-conversion payment permissions, distinct from cast-price adjustment |
| VALUE | Selected-result-card fields, collection sums and general division |
| CAUSE | Shared source/cause attribution, lethal outcomes, source-scoped exile destinations and zero-life interception |
| REVEAL | Remaining distinct-name, same-zone selection/remainder and repetition consumers, plus complete recipe proofs; captured windows/visibility are delivered |
| USAGE | Dynamic limits, modifying other ability limits or nonstacking composition proof |
| EVENT | Remaining tap/draw-step events, event-subject targeting and card-specific event/provenance composition; explicit off-zone listener discovery is delivered |
| PAY | Selected exile and binding/storage payments; ritual materials, ordinary counter and optional resolution payments are delivered |
| ENTRY | Atomic tapped entry or summon-method provenance |
| TOKEN | Complete card-specific token recipes/proof; predefined creation and board-only lifecycle are delivered |
| EXPIRY | Battle/attack lifetime and skip-next-untap scheduling |
| HOST | Real cards stored under a host and host-bound release |
| COUNTER | Counter-owned granted behavior, identity and lifecycle proof |
| COMBAT | Attack/block prohibition, attack cancellation and scheduled phase termination |
| DAMAGE | True reduction, life floors and damage packet/assignment semantics |
| STACK | Selected ability-source linkage, retargeting and source follow-up actions |
| VIEW | Card holder versus owner, cross-player destination and visibility |
| IMMUNITY | Immunity to untargeted as well as targeted effects by source category |
| HEAL | Global healing-amount modification |
| RANDOM | Authoritative random reveal with downstream identity. Shared selection and random hand discard are delivered. |
| DRAW | Bottom/opponent-library draw semantics |

## Token creation follow-up

[Predefined tokens and board-only lifecycle](token-architecture.md) now clear the generic creation dependency. The 1/1 vanilla token uses subtype 上使, as ruled by the owner. Tokens still fire genuine death triggers for a settled graveyard-bound creature departure, while never occupying graveyard, hand, deck, exile or stack. They may carry normal printed abilities; cessation is not a removable/counterable on-death exile ability. No workbook definitions are registered by this infrastructure delivery, so normal coverage remains 72/142 plus one separately enumerated token template.

## Every missing in-scope row

The tables distinguish a confirmed missing consumer from a ruling that might require one. Whole-card U requires all clauses; a P is not a claim that a particular engine change is necessary.

### 幻影木偶

| Row | Card | Status | Families | Current disposition |
|---:|---|---|---|---|
| 8 | 赫拉鬼火術 | P | — | Attributed reduction kills and source-scoped direct exile now have shared consumers and focused proofs. Author the exact -2/-2 card recipe and verify its complete composition; no separate SOUL death type is needed. |
| 10 | 幻影木偶工廠 | P | REVEAL | Five-card capture, filtered exact-remainder milling and top ordering now have shared consumers, alongside ordinary once-per-game usage and modes. Prove the complete printed alternative-choice recipe before U. |
| 11 | 赫拉的營寨 | W/P | — | Life-loss, actual damage and effective maximum-life change events plus a shared turn budget now exist. Settle which creature life changes qualify and prove the complete combined draw recipe. |
| 12 | 幻像祭壇 | B | ENTRY | Exact milled-card recovery and black/type filters are now supported. Only atomic tapped entry remains; an entry trigger that later taps is observably different. |
| 13 | 幻影夢人 | B | EVENT | Need the draw-step trigger. Optional pay-two-life-then-draw now uses `resources / pay_cost`; ordinary life payment is no longer a blocker. |
| 14 | 幻影木偶 鬼斧 | P | — | The shared killed-outcome gate now supports a stat reduction followed by a success-only bonus. Still deliver the exact attack/target/buff composition proof for this card. |
| 15 | 幻影木偶 鬼火 | U | — | Existing optional mill result capture, black noncreature-type filter and exact-card recovery compose on entry and attack. Seven focused recipe tests cover this card and the scythe; definition/registration still to deliver. |
| 17 | 死亡組裝 | W/P | TOKEN | Predefined token creation and ordinary token attack abilities are supported. Still define/prove the named 7/6 token recipe and clarify whether all three friendly destructions must succeed before creation; the existing boolean any-success outcome is not an all-three prerequisite. |
| 18 | 幻影木偶軍團長 | B | EXPIRY | Graveyard deployment exists. The +4 bonus must expire at this battle's end; end-of-turn expiry is not equivalent. |
| 19 | 幻影木偶智者* | B/P | USAGE | The graveyard effective-cost setter is now supported. Nonstacking stat anthems across multiple copies still need their consumer/composition; ability usage groups do not deduplicate continuously applied stat deltas. |
| 20 | 赫拉幻影術 | W | VALUE | Effective mana-value filtering now sees graveyard setters. Clarify whether ignore all graveyard effects means explicitly selecting by printed cost or suppressing effects more broadly; those are distinct selection/permission policies. |
| 21 | 幻影魔鐮 鬼火 | U | — | Restricted attachment, +2 attack and granted attack-triggered exact-mill recovery compose with existing consumers; the grant stops when the weapon leaves. Live definition/registration still to deliver. |
| 22 | 幻影魔神 赫拉尼亞* | B/W | EVENT, VALUE | Self-discard discovery from hand/library now has an explicit before/after listener. Read the exact selected result card's mana value for the temporary reduction and prove the full recipe; mill membership alone is not a value accessor. Optional paid deployment exists; clarify trigger origin/timing when authored. |

### 風獸

| Row | Card | Status | Families | Current disposition |
|---:|---|---|---|---|
| 5 | 風靈獸 刃狼 | B | REVEAL | Five-card capture and configurable visibility now exist. Still need selection with distinct printed names and exact picked-versus-remainder handling when a selected card stays in the library. |
| 10 | 風靈再生 | B | EVENT, EXPIRY | Retained revealed-self discovery and the revealing source snapshot now exist. Prove source-name gating and exact self-recovery/exchange composition. Alternate +1 attack still requires battle expiry. |
| 14 | 風靈號角手 | W | — | Hand activation, self-discard payment, turn limit and name-substring selection exist. Owner explicitly deferred the unspecified special-summon origin. Choose the origin before deciding whether another engine change is needed; this is not a remaining filter blocker. |
| 15 | 風靈獸之子 | B | EXPIRY | Name-substring conditional +2/+2 is expressible. Tapping exists; skipping the target's next untap does not. |
| 17 | 獸帝的號令 | B/P | EVENT | Captured windows and optional pay-one-green branches now exist. Explicit revealed-self listeners now retain the observed incarnation. Prove deployment of that exact object and the intended completion-time trigger recipe; discovery alone does not grant a new movement permission. |
| 18 | 風靈獸 號角手姆拉德* | P | REVEAL | Five-card capture, optional free Land/Artifact deployment from that exact set and ordered-bottom current remainder are supported. Prove the full printed recipe before U. |
| 19 | 風靈獸 旗手納馬蘭 | B/W | EVENT | Conditional removal of abilities from tapped opposing creatures is expressible. Need a tap event; clarify 回復 (untap or life recovery) and scope before implementing the response. |
| 20 | 風靈獸之怒 | B | EVENT | Tapping two opposing creatures and retained revealed-self discovery are supported. Prove source-name gating and recovery of the exact observed incarnation; do not retarget a newer incarnation by UUID. |
| 21 | 風靈獸 狂獅大將軍哈爾 | B | EXPIRY | Multi-target tapping and eight damage exist. Need skip-next-untap. Once-per-game ordinary activation is supported. Ordinary once-per-game usage is now available; the remaining listed behavior still needs implementation. |
| 22 | 風靈戰皇 里昂·加拉爾 | B | EVENT, EXPIRY | Need targeting the entering event card with its +1/+1 counter and skip-next-untap for the three marked opponents. Board-filter support alone does not identify the triggering entrant. |
| 23 | 風靈獸 大酋長里昂 | B/W | HOST, USAGE | Real cards stored under this host, host-bound retrieval and per-turn mana uses equal to stored-card count are missing. Clarify whether the starting-step deposit is optional once per turn. |

### 冰龍

| Row | Card | Status | Families | Current disposition |
|---:|---|---|---|---|
| 3 | 寒霜使者 | B | REVEAL | Capture and top/bottom ordering exist. A chosen card put on top stays in the same library incarnation, so current-set membership alone does not exclude it from the remainder. Need an explicit picked-subset/exclusion contract, not whole-library fallback. |
| 4 | 封印的極光龍像 | B | COMBAT | Need authored attack/block prohibition conditional on counters. Cast/activate permission rules are not combat restrictions. Also establish the counter-placement event's subject for the threshold tracker. |
| 6 | 冰風守護者 | B/P | COUNTER, STACK | The one-time Aurora shield is available. Retargeting a pending effect to this creature still needs support. Protection keywords do not redirect a selected stack object. |
| 9 | 冰龍魔杖 | W | — | Restricted attachment, attack counters, bounce and atomic counter payment now exist. Clarify whether 此卡 means the staff or equipped host for placement/payment before authoring the complete recipe. |
| 10 | 冰龍呼喚 | B/W | REVEAL | Captured filtered selection/order exists. Conditional repetition of the whole workflow still needs a bounded repeat consumer and a ruling on once-again versus recursive repetition. |
| 11 | 極光之盾 | B/W | DAMAGE | Need life-total floor across qualifying decreases, including direct life loss. Prevention alone is insufficient. Clarify behavior when life already starts below five. |
| 14 | 霜月守護者 | B/W | COMBAT | Need cancel-this-attack semantics; spell/ability countering does not cancel combat. Define whether this removes one attacker or ends the whole battle when implementing. |
| 15 | 冰陵之主 | B/W | DAMAGE | Counter/subtype-filtered rule scope and friendly attack/draw exist. True flat damage reduction is absent; prevention of one point is a different operation. Resolve friendly versus all marked ice dragons and reduction wording at implementation, as previously deferred. |
| 16 | 極北王冠 | P | — | Ordinary once-per-game usage is implemented. Restricted attachment, life condition, tap payment and bottom moves already exist. Prove/register the complete Crown recipe before U. |
| 17 | 極光之壁 | B/P | COUNTER, COMBAT | The one-time Aurora shield is available. Spell countering exists; ending the attack phase after the current battle needs a scheduled combat transition. |
| 18 | 極北之指引者 萊莘德雅 | B/W | EVENT | Two independent captured-category selections are supported. Explicit off-battlefield listener discovery is delivered. Settle the departure/source-zone ruling and prove the self-summon plus complete reveal recipe when authoring. |
| 19 | 極光封 | B/W | STACK | Creature-ability countering exists. Need resolving the selected stack ability's source for bottom movement and clarify whether 其 refers to that creature. Countering alone cannot select its associated source. |
| 20 | 極光龍宮 | B/W/P | COUNTER | The one-time Aurora shield is available. The special-summon origin remains explicitly deferred. Shared selected-counter payment is delivered. |
| 21 | 極光龍后 亞雅隆 | B/W/P | COUNTER | Need full per-recipient prevention grant semantics. Clarify the first ability's activation condition/timing; the workbook labels this apparent 4/8 creature as Land. Turn-long untargetability is already expressible. |
| 22 | 極北龍帝 亞瑟 | B/W | DAMAGE, VALUE | Count and multiply exist. Need defined per-dragon damage assignment and half-damage arithmetic/rounding; clarify repeated five-damage packets versus one summed packet and odd damage. |
| 23 | 巨龍之墓 | B/W/P | COUNTER, CAUSE | The one-time Aurora shield is available. Replacing a zero-life state-based departure with optional artifact destruction and healing remains. Ordinary damage regeneration is not this replacement; clarify what life recovery means after max-life reduction. |
| 24 | 寒巢之主 亞蕾雅 | B | EXPIRY | Charge, creature entry and atomic four-counter payment now exist. Need battle-lifetime protection for both players, rather than a turn-long approximation. |
| 25 | 諸界六皇 冬機之卡斯拿斯 | B/W | IMMUNITY, EVENT | Need immunity against opposing spell/creature effects, not just targeting. Also tap-triggered recovery during opponent attack phase; clarify 回復 and qualifying source effects. |

### 上使

| Row | Card | Status | Families | Current disposition |
|---:|---|---|---|---|
| 8 | 亞拉里亞最終兵器 天域神城 | P | TOKEN | The predefined 1/1 vanilla 上使 token and creation effect are implemented. Prove/register the complete card recipe before U. |
| 11 | 聖能術 · 速 | B | DRAW | Need drawing specifically from library bottom; ordinary DRAW consumes the top. |
| 12 | 亞拉里亞的終末 | B | PAY | Global opposing destruction exists. Need an atomic exile payment selecting the named emperor with at least five charge counters. Ordinary once-per-game usage is now available; the remaining listed behavior still needs implementation. |
| 13 | 天域之獸 | P | REVEAL | A recorded captured-window yellow-card count can determine life gained while ordinary search selects from the same current set. Prove/register the full printed yellow-land recipe before U. |
| 14 | 天域三侯 坡加 | B/W | HOST, PAY | Take-all-spells capture handling exists. Under-host land storage/release, the 縛鎖1 payment contract and the stored-land source ruling remain. |
| 16 | 天域三侯 伊雲 | P | REVEAL | Eight-card capture, take-all-spells search, exile of the exact current remainder and once-per-game entry usage are supported. Prove/register the complete recipe before U. |
| 17 | 雷霆之門 | P | TOKEN | Mana generation, healing triggers, ordinary game-period usage and predefined 1/1 上使-token creation are implemented. Prove/register the complete card recipe, including its use identity, before U. |
| 18 | 亞拉里亞的截擊 | B/W | STACK | Ability/spell countering exists. Need associated-source selection and source-zone-aware discard/destruction; clarify which effects are counterable and what happens to a source already gone. |
| 20 | 天使的皇座 | B/W | HOST, USAGE, PAY | Need under-host storage/release, 縛鎖3 and reversible changes to ability 1's use limit. Shared groups can enforce the common 2/3 budget; changing ability 1's limit still lacks a consumer. |
| 21 | 天使女帝 蝶后 | B | EVENT, HEAL | The hand-zone life-loss watcher is now supported. Prove its self-discard/payment composition and add the global healing-amount modifier; existing damage modifiers do not change healing amounts. |
| 22 | 大天使 費蘭尼 | B | VALUE, EXPIRY | Setting life to 30 is expressible through current life arithmetic. Still need integer floor(life/5), and bonus expiring after this attack. Ordinary once-per-game usage is now available; the remaining listed behavior still needs implementation. |

### 蒼巨人

| Row | Card | Status | Families | Current disposition |
|---:|---|---|---|---|
| 15 | 深海之墓 | B | IMMUNITY | Own-hand-count conditions and graveyard targeting restriction are expressible. Conditional hand immunity must also cover untargeted opposing effects; Hexproof/Shroud alone do not. |
| 16 | 永恆魔洋 | B/W | RANDOM, VALUE | Need server-authoritative random opposing-hand reveal and passing its exact name into a turn-long cast/deploy prohibition. Clarify what 使用 covers. Fixed authored cast restrictions already exist. |
| 22 | 幻變之海 洛基尼亞 | B/W | VIEW | Opponent-library capture and visibility now exist. Moving its selected opponent-owned creature into your hand still needs holder-versus-ownership semantics. Current moves use the owner destination; do not change ownership silently. Opponent-creature-count mill already exists. |
| 23 | 蒼海帝 洛基 | B | VIEW, COST | Atomic four-counter payment is delivered. Need opponent-library draw into your hand with reveal and card-specific blue-as-any-color payment. Generic reductions/setters are not color-conversion permission. |

## Blue Giant mill consumers

The [six new blue cards](../tests/engine/blue-workbook.test.ts) cover captured reveals, source discard triggers, combat-phase cast restrictions, game-once graveyard land recovery, and [scoped mill bonuses](continuous-effects-engine.md#mill-quantity). 塔薩 and 海耶 reveal six, take their chosen cards, and discard the remaining revealed cards as part of Reveal. The temple bonus applies to numbered mill instructions, including 海耶's separate opponent mill.

The [60-card blue example](decks/blue-giant-workbook.json) uses 24 lands and 36 native blue nonlands under the workbook copy limits. 蒼海巡察組 supplies early mill, 幻變神殿 and 海歸的幻術者 increase it, and 深淵幻士 turns giant attacks into additional mill triggers. The workbook's blue sheet now supplies 18 nonland names, allowing 54 native nonland slots at three copies each. 蒼海王子 and 深淵巨人 use the [shared ritual material payment](counter-payment-architecture.md#ritual-materials) and their special-summon entry triggers.

萬智之德步尼 is a mill finisher whose attack rounds down to complete pairs. 耶夢加得 uses the shared random hand discard and keeps its separate attack mill.

## Aurora and frost gear consumers

極光冰龍, 巨龍的祝福, and 霜月門衛 are registered and verified through casting, trigger resolution, target selection, mana activation, and the equipped attack draw. Their mechanics use the [existing counter rules](counter-rules.md). The [60-card Aurora example](decks/aurora-workbook.json) combines 24 lands and 36 nonlands, uses the workbook's three-copy default and the printed land exceptions, and pays for every spell with cold or generic energy. Its Ice Dragon core has nine dragons and six Aurora placement cards. A single three-copy Equipment makes the frost gear draw a secondary plan.

## Gaps in registered cards and format policy

The 85 registered matches are not a second list of fully faithful cards. Existing gaps remain visible here:

- **Copy policy resolved:** all six basic lands are repeatable. 血炎山 already used the unlimited `land-red` definition; the five other missing unlimited mappings are now configured. 幻影魔城/諸界海 are singleton and the newly registered 幻影木偶 allows twenty copies, through the shared config/validator.
- **Scorch on artifacts:** nine registered definitions explicitly retain `【暫緩：遺跡的灼熱破壞門檻】`. The accepted creature threshold uses current attack plus maximum life; the relic threshold still needs its own ruling. Their registration does not clear that caveat.
- **Excluded dual lands:** six registered dual lands use an entry-tap trigger rather than atomic tapped entry. They belong to the excluded supplement, so the audit records the fidelity gap without silently widening implementation scope.
- **Workbook format:** the workbook describes default three copies, at least sixty cards without an upper limit, and opening-seven/mulligan behavior. The current standard profile uses four copies and 60–250 cards; opening/setup rules are configured separately. Profile/setup alignment is separate work, not solved by registering definitions. U above is relative to the supported profile, not a claim that global workbook rules have been migrated.

A complete fidelity certification of the 85 registered matches is outside this missing-row audit. The historical inventory records their source text and coverage; the gaps above prevent interpreting coverage as a fidelity percentage.

## Next largest blocker and delivery order

The [captured-window and visibility foundation](card-window-design.md) is now delivered. Of the thirteen formerly blocked reveal rows, **six move to P for complete card-specific proof**, **three retain specific reveal-consumer blockers** (distinct-name selection, same-zone picked/remainder separation, repetition), and **four retain other technical/ruling dependencies**. This is not a claim that all thirteen full cards are implemented.

The remaining PAY rows stay at five: 亞拉里亞的終末 (selected exile), 天域三侯 坡加 / 天使的皇座 (binding/storage), and 蒼海王子 / 深淵巨人 (ritual materials). No new workbook definitions are registered by this infrastructure delivery; coverage remains **72/142** and the two Ghostfire recipes remain confirmed U.

1. Prove full recipes newly supported by capture, then author/register those whose printed wording and all dependencies are settled.
2. Prove the card recipes using the delivered Aurora/霜器 and event-source discovery infrastructure. Add the remaining event/value/target consumers where needed.
3. Add explicit selected-subset identity/exclusion and distinct-name selection, then define bounded repetition with its owner ruling.
4. Continue combat lifetimes, host storage, ritual/random/cross-owner and immunity behavior. 冰龍魔杖 still needs the staff/host wording ruling.

Deferred wording stays for the corresponding card implementation. These are the remaining delivery dependencies, not mechanics silently approximated by this batch.

### Listener delivery — 5 November 2026

The [strict listener schema and runtime consumer](trigger-listener-architecture.md) clear off-zone discovery as a generic engine blocker. `event_card` uses the subject's selected before/after snapshot; `watcher` uses declared active zones in the existing event window. Forty-two focused tests include real mill/discard/death/reveal pipelines, granted ability ordering, shared usage and pending-event deduplication. This is not a complete re-audit of the eleven formerly EVENT-tagged rows: their ledger tags also track other event consumers, value operations, targeting, wording and recipe proof. Coverage and the two confirmed U recipes remain unchanged; no new workbook cards were registered.

### Trigger consolidation — 5 November 2026

All 59 shipped trigger declarations are now explicit, and the three older turn-limit declarations use ordinary usage contracts. Candidate providers share one event context, evaluator and target-eligibility gate. Listener membership/characteristics can come from before the event, while board/player conditions inspect after-state: the newly milled card counts toward a five-card graveyard condition. No legal required target means no pending ability, occurrence record or spent budget; optional targets and untargeted effects remain eligible. Delayed registrations share those rules without losing their independent lifetime. This cleanup adds no new workbook cards or capability-family claims; the full recipe/ruling requirements above still apply.

## Audit evidence and ownership

Use the existing owners when delivering a missing slice:

| Boundary | Current implementation / contract |
|---|---|
| Catalog coverage and parsing | [Explicit manifest](../packages/engine/src/library/cards/index.ts), [public parser](../packages/engine/src/rules/parse.ts), [authoring contract](../packages/engine/src/library/README.md) |
| Filters and numeric values | [Shared card queries](../packages/engine/src/shared/card-query.ts), [numeric expressions](../packages/engine/src/shared/numeric-values.ts), [numeric schema](../packages/engine/src/types/numeric-value.types.ts) |
| Reveal choices | [Bounded reveal consumer](../packages/engine/src/engine/bounded-reveal.ts), [reveal tests](../tests/engine/bounded-reveal.test.ts) |
| Cost and usage boundaries | [Action payments](../packages/engine/src/engine/action-costs.ts), [cast pricing](../packages/engine/src/rules/runtime/costs.ts), [ability turn history](../packages/engine/src/engine/turn-history.ts) |
| Granted behavior and replacements | [Characteristic layers](../packages/engine/src/engine/characteristic-layers.ts), [replacement rule discovery](../packages/engine/src/rules/runtime/event-replacements.ts), [state-based departures](../packages/engine/src/engine/state-based-planner.ts) |
| Deck policy | [Eligibility schema](../packages/protocol/src/decks/eligibility.ts), [authored exceptions](../packages/protocol/src/decks/config/eligibility.json), [validator](../packages/protocol/src/decks/deck.ts), [format](../packages/protocol/src/decks/config/standard-v1.json) |
| Exact mill composition | [Resolution result design](resolution-results-architecture.md), [result tests](../tests/engine/resolution-results.test.ts), [new full recipes](../tests/engine/card-blocker-probes.test.ts) |

## Verification

The explicit manifest now has **98** definitions and matches **72/142** included workbook rows; **70** lack definitions. The earlier payment delivery registered 幻影女王 赫拉 and 天使皇 亞拉里亞. This follow-up adds captured windows, base card visibility, scoped observation grants, exact-remainder milling and projected history without adding definitions. Existing definitions and presets are preserved.

Payment verification covers atomic combinations, overlapping inventory, stale/foreign selections, cancellation, source revisions, mana generation, continuation reconstruction, exact debits, production cards and opaque player projections. Payment validation is recorded in [the payment guide](counter-payment-architecture.md#verification); capture/visibility validation is recorded in [the capture guide](card-window-design.md#ownership-verification-and-remaining-scope). All workspace typechecks pass. No browser smoke test, full-game socket test or full suite was run. The prior infrastructure delivery's 231 checks and original audit's 73 checks remain historical.
