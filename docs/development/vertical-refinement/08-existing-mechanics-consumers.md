# Workbook consumers using existing mechanics

16 October 2026. Baseline `b4a67ab`, branch `codex/workbook-existing-consumers` in the existing checkout. Goal: implement complete workbook cards that fit existing mechanics and document the JSON structures they consume. Preserve previous partial cards without describing them as complete.

## Scope and execution record

- [x] Inspect the loader, registry, choices, costs, numeric contexts and all nine card-design sheets.
- [x] Set the six-color vocabulary: 炎 red, 魔 black, 風 green, 雷 yellow, 雪 white, 海 blue. Normalize workbook 木→風 and 寒→雪; 無 remains generic. Unknown 兵 remains unresolved.
- [x] Audit complete-card candidates and preserve blocked clauses instead of adding vanilla bodies or fake modes.
- [x] Observe 41 missing-definition failures, then add 33 definitions in `src/library/card_data.json`.
- [x] Add `workbookTestSetup` as an opt-in central 60-card setup; preserve default/ST01A setups.
- [x] Document new consumers in library README section 11 and examples 13–17.
- [x] Finish engine/server/client verification and independent review; fresh results recorded below.

The owner's six-color correction also replaces the old `colorless` pool key/`{C}` symbol with `yellow`/`{Y}` in types, parser, room initialization, client rendering and affected fixtures. This is a resource-vocabulary correction, not a seventh resource or a new effect mechanic. `elementColors` is centralized in `src/config.ts`. Existing live rooms/saved snapshots are not migrated: restart and create a fresh room. Uncolored-card protection quality remains independent of mana pool keys. Legacy ability-less lands retain their prototype fallback, now producing the sixth resource (yellow); every actual workbook land has an explicit printed mana ability.

## Complete new definitions: initial 33

Whole printed match behavior is authored using current turn/priority/damage rules. Construction limits remain instructions rather than a new deck validator; the setup includes one copy of 幻影魔城. No new reveal, attachment, counter, phase, cost or effect capability is introduced.

| Workbook source | Name | Catalog ID | Cost | Colors |
|---|---|---|---|---|
| BP01 - 元初大地!A5:K5 | 法蒂奧戰士 | `fatiao-warrior` | `{R}{R}` | red |
| BP01 - 元初大地!A24:K24 | 烈龍聚居地 | `blazing-dragon-habitat` | `{0}` | red |
| 幻影木偶!A3:K3 | 幻影地界兵 | `phantom-land-soldier` | `{B}` | black |
| 幻影木偶!A5:K5 | 幻影營長 | `phantom-captain` | `{B}{B}{1}` | black |
| 幻影木偶!A7:K7 | 赫拉充靈術 | `hera-empowerment` | `{B}` | black |
| 幻影木偶!A16:K16 | 幻影魔城* | `phantom-castle` | `{B}{B}` | black |
| 幻影木偶!A24:K24 | 幻影旅團地府 | `phantom-underworld` | `{0}` | black |
| 風獸!A2:K2 | 風靈獸 魔豆 | `wind-beast-bean` | `{G}` | green |
| 風獸!A3:K3 | 風靈獸 巧兔 | `wind-beast-rabbit` | `{G}` | green |
| 風獸!A4:K4 | 風靈獸 舞狐 | `wind-beast-fox` | `{G}{G}` | green |
| 風獸!A7:K7 | 諸界游歷者 | `worlds-traveler` | `{2}` | green |
| 風獸!A9:K9 | 初級風疲術 | `lesser-wind-fatigue` | `{1}` | green |
| 風獸!A11:K11 | 歐凱爾山脈 | `okair-mountains` | `{G}{1}` | green |
| 風獸!A12:K12 | 歐凱爾之墓 | `okair-tomb` | `{G}{G}{G}{G}{1}` | green |
| 風獸!A24:K24 | 萬獸聖國 | `beast-holy-land` | `{0}` | green |
| 冰龍!A2:K2 | 寒冬幼龍 | `winter-drake` | `{W}` | white |
| 冰龍!A26:K26 | 極光北地 | `aurora-northland` | `{0}` | white |
| 上使!A2:K2 | 天犬 | `sky-hound` | `{Y}` | yellow |
| 上使!A3:K3 | 小翼使者 | `winged-envoy` | `{Y}{Y}` | yellow |
| 上使!A24:K24 | 天使的聖地 | `angel-holy-land` | `{0}` | yellow |
| BP01 - 元初大地!A46:K46 | 諸界六皇 魔邪之基拉奧特 | `worlds-sin-emperor` | `{4}` | black |
| BP01 - 元初大地!A47:K47 | 冥者古地 | `nether-ancient-land` | `{0}` | black |
| BP01 - 元初大地!A50:K50 | 迅靈使者 | `swift-spirit-envoy` | `{G}{G}` | green |
| BP01 - 元初大地!A57:K57 | 風之呼喚 | `wind-call` | `{G}{G}` | green |
| BP01 - 元初大地!A58:K58 | 自然的賜予 | `nature-gift` | `{G}` | green |
| BP01 - 元初大地!A70:K70 | 神風鳥居 | `divine-wind-torii` | `{0}` | green |
| BP01 - 元初大地!A71:K71 | 凍土雪球 | `frozen-snowball` | `{0}` | white |
| BP01 - 元初大地!A93:K93 | 兵器之古戰場 | `ancient-weapon-battlefield` | `{0}` | white |
| BP01 - 元初大地!A116:K116 | 雷巾主陣 | `thunder-main-camp` | `{0}` | yellow |
| 雙色補充包!A3:K3 | 不死暮林 | `undying-dusk-forest` | `{0}` | black, green |
| 雙色補充包!A4:K4 | 烈風熔河 | `blazing-wind-river` | `{0}` | green, red |
| 雙色補充包!A5:K5 | 極北墳場 | `far-north-graveyard` | `{0}` | white, black |
| 雙色補充包!A6:K6 | 狂雷凍土 | `thunder-tundra` | `{0}` | yellow, white |

The source names/text/stats were compared directly with the extracted workbook rows. `2魔1無` is `{B}{B}{1}`, not four energy; `4木1無` is four green plus one generic. Generic-cost cards retain their printed color explicitly. 凍土雪球 is a free 2/2, not an invented paid creature.

## Existing structures and timing boundaries

- 法蒂奧戰士 uses separate self-entry and self-attack triggers of the same damage instruction. This does not add a general ordered compound trigger field.
- 幻影地界兵 searches its controller's graveyard for one Land and directly moves it to the battlefield. 巧兔 searches its controller's hand for zero or one Land. Neither action spends a normal land play; choices preserve the original UUID and advance zone revision.
- 風之呼喚 searches the whole library for a 迅靈 Creature, moves the chosen card to hand, then shuffles within one ordered spell. This is not top-N reveal or a reveal event consumer.
- 幻影魔城 statically grants normalized nested tap-to-draw abilities to friendly 幻影木偶 Creatures, including later entrants. The grant vanishes when its source leaves; an activated stack item already created remains independent.
- 迅靈使者 is instant-speed. Its intervening condition counts at least two friendly 迅靈 Creatures, including itself, at discovery and resolution. This uses the existing condition semantics; it is not a generalized source-exclusion filter.
- 魔邪之基拉奧特 counts friendly 幽爾 Creatures, including itself, for its entry draw. Its separate attack watcher applies a temporary toughness reduction; this is not damage or a new soul-death event.
- Four dual lands have the printed **on-configuration tap trigger**, with normal responses. They do not enter tapped atomically. A separate mana action chooses one of two colors and immediately produces one energy.
- 歐凱爾之墓's activation has no printed cost or limit. It remains free and repeatable; this pass does not invent balancing rules. All temporary GRANT_STATS instructions expire at turn cleanup.

## Candidate audit and deferrals

All nine design sheets are covered by the [workbook mechanics review](../workbook-mechanics-review.md). Existing complete cards (`empire-servant`, `musketeer-infantry`, `land-red`, `flame-fangs`) remain. Existing partial cards (`broken-fireball`, `fireball`, `worlds-rebel`, `awakened-blood-mountain`) retain their visible unsupported notes; they are not counted among the 33 new complete consumers.

| Candidate/family | Why it is excluded from this pass |
|---|---|
| 海 cards | Earlier color-related deferral lifted on 16 October after confirming 海→blue. Eight complete consumers are added below; [the next pass](09-small-card-mechanics.md) adds source-specific discard consumers. Reveal, rituals and other unsupported clauses still defer the remaining cards. |
| 冰霜巨人 / 霜月門衛 | Printed cost includes 兵, whose meaning is unresolved. Do not turn it into generic mana. |
| 冰霜征服者 瑟倫 | Needs one **same** permanent to be both 冰器 and Equipment. Existing subtype lists mean OR, not AND. Separate existence counts would accept two different cards. Do not broaden the condition just to make it fit. No actual equipment consumer is authored yet. |
| 諸界火術士 / 天域門衛 | At this pass, ordinary triggers had one effect. [The next pass](09-small-card-mechanics.md) adds ordered triggers and completes 諸界火術士. 天域門衛 still needs destruction-vs-death semantics. |
| 風靈獸 飛鼠 | Conditional entry search-then-shuffle needs the condition to govern the whole sequence. Separate shuffle trigger or unconditional search changes printed behavior. |
| 幻海人 戈圖 / 狂海幻力 | Completed in [the next pass](09-small-card-mechanics.md) using selected hand discard and ordered instructions. Generic MOVE_ZONE to graveyard remains distinct from source-specific discard events. |
| 迅靈神殿 | Special summon's source zone is unspecified. Do not guess hand, library or graveyard. |
| 風翼之靈 風神子 | Own-attack-phase casting gate is not an authored condition available today. |
| 迅風之地 / 風靈戰皇 / similar “that entered creature” effects | Automatic event-subject effect recipient is missing; a fresh arbitrary target is a different effect. |
| 冥者 / 魂滅 cards | Distinct soul-death event/cause, conditional outcomes, name filters or selected costs are required. Ordinary death is not silently substituted. |
| 火/風 conditional draw spells | 强權崛起 and 追求淨化之火 are completed in [the next pass](09-small-card-mechanics.md) with an existence query returning 0/1, rather than a raw creature count or announced X. |
| Equipment / reveal / Scorch / Aurora / Void / rituals / stored-under-card / Chain / game-once families | See the source-referenced mechanics review. They remain deferred; runtime type names or generic mutation support alone do not make the full card authorable. |
| Empty rows, named placeholders, BP01 rows 85–86 swapped types, 雷巾祭壇 token-only row | Missing/inconsistent source definition or token creation needs resolution; do not invent ordinary free-castable cards. |

## Verification: initial 33-card pass

Completed 16 October 2026:

- Test-first evidence: 41 missing-definition failures and the six-color mismatch were observed before adding definitions/resource updates. Independent review then found yellow missing from inferred colors. Its regression returned `[]` instead of `["yellow"]` before the fix; inference now uses shared `MANA_COLORS`.
- Full serial regression: **87 files, 1,139 tests passed**, including 47 workbook consumer cases and the fresh real-server two-client scenario. This full run preceded the six added inference cases/final inference correction; the follow-up **43 color/layer/protection tests passed** against that correction.
- Final corrected source: server TypeScript build, client TypeScript check and production Vite build passed. `git diff --check` passed.
- All **17 annotated JSONC examples** parse and normalize with the actual loader. All 49 catalog definitions normalize; the opt-in deck contains exactly 60 valid IDs and every one of the 33 new definitions.
- Fresh two-client flow: normal room creation/RPS, land play, 魔豆 cast, turn handoff, untap/mana production, 風之呼喚 payment, whole-zone search selection, move to hand, shuffle, spell to graveyard and empty stack. Both client reducers receive public state and the search choice; the owner receives the chosen card and the opponent receives its updated hand count under existing sync rules. No blueprint edits, direct state preparation, debug resolutions or synthetic events are used in this scenario. This is socket/client-reducer proof, not a new browser-click automation harness.
- Unit consumers cover entry/attack damage with lethal graveyard departure, tribe buffs and cleanup expiry, recovery, optional land placement, search/shuffle order, conditional-trigger recheck, static grant departure, ordinary tap-to-draw, immediate mana outputs, dual-land tap/choice behavior, paid turn limits and the literal free repeatable activation.
- The actual current XLSX was reread and matched the inspected extraction. All 33 printed costs were independently compared to authored symbols; names/text/stats and element aliases were checked against source rows. The workbook itself is unchanged.
- Independent read-only review checked source fidelity, exclusions, JSON formats, the six-color migration and client contracts. No remaining actionable findings after the inference fix. No commit or push was requested or performed.

Reproduce with the bundled runtime (or an equivalent configured Node): `vitest run --config vitest.config.mts --maxWorkers 1`; focus the new consumers with `vitest run tests/engine/workbook-consumers.test.ts tests/engine/six-colors.test.ts --config vitest.config.mts --maxWorkers 1`. The full suite includes real socket servers, so it needs permission to launch child processes/write its temporary cache in restricted environments.

## 海 follow-up: eight more complete consumers

The owner clarified that 海 should be blue and asked whether it was unsupported. Blue was already present in the corrected six-color vocabulary; the deferral was a previous content-scope decision, not an engine limitation. This follow-up lifts that deferral for complete cards requiring no new mechanics. No engine/type/loader/client behavior is changed in this follow-up.

| Workbook source | Name | Catalog ID | Cost | Printed color |
|---|---|---|---|---|
| 蒼巨人!A2:K2 | 蒼海城貴族 | `sea-city-noble` | `{U}` | blue |
| 蒼巨人!A6:K6 | 幻海人下士 | `phantom-sea-corporal` | `{U}{U}{1}` | blue |
| 蒼巨人!A11:K11 | 海底深淵 | `sea-depths` | `{U}{U}` | blue |
| 蒼巨人!A12:K12 | 諸界海 | `worlds-sea` | `{0}` | blue |
| 蒼巨人!A25:K25 | 蒼海領地 | `sea-domain` | `{0}` | blue |
| 風獸!A6:K6 | 諸界商人 | `worlds-merchant` | `{2}` | green |
| 雙色補充包!A2:K2 | 魔炎深淵 | `demon-flame-abyss` | `{0}` | red, blue |
| 雙色補充包!A7:K7 | 巨浪雷陣 | `great-wave-thunder-array` | `{0}` | blue, yellow |

There are now **41 added complete workbook definitions** (33 + 8). The central opt-in deck stays at 60 cards: replace eight filler lands with these eight cards, include blue basic lands in the filler cycle, and retain the opening seven used by the existing fresh-server test. 諸界海 has one copy, respecting its printed construction instruction without adding a validator.

幻海人下士 uses the existing legacy ordered `onEnterEffects`, which can recover one own graveyard Land and then draw within one self-entry trigger. The draw does not require a successful land recovery. 海底深淵 uses the same move/search as a sorcery spell. These placements spend no normal land play. 諸界商人 and 諸界海 offer all six colors but produce only one chosen energy; they remain green and blue cards respectively. Dual lands retain normal entry-tap trigger timing. No milling, reveal, discard, ritual, token or color-conversion mechanic is added.

Example 18 and library README section 11 explain the entry list and six-output mana selection. Remaining 海 cards are excluded for their actual unsupported effects (e.g. milling, reveal, conditional discard, rituals or game-once effects), not their color. BP01 海 placeholders remain incomplete designs.

Follow-up verification, 16 October 2026:

- Red: 21 new 海 cases failed on the missing definitions while the original 47 workbook cases passed.
- Green: **90 selected tests passed** across four files (38 unrelated tests skipped by the name filter). This includes all 68 workbook cases, six-color inference/payment/rendering coverage and actual-server scenarios, including the fresh workbook search game and the existing complete ST01A match.
- 海-specific checks cover all six output choices on both universal producers, blue-specific casting versus insufficient/wrong-color payment, summoning-sickness restrictions, blue basic-land production, both outputs on both 海 dual lands, recovery without spending a land play, and the corporal's ordered recovery→draw with and without an eligible graveyard land.
- Server build, client typecheck and production build passed. All **18 annotated examples** and **57 catalog definitions** parse/normalize. The deck remains 60 valid cards and includes all 41 new definitions; 諸界海 appears once.
- Independent follow-up review found no actionable issues: verified blue costs/outputs, singleton/subtype data, entry-tap semantics and ordered legacy self-entry recovery→draw including an empty search. No additional engine mechanic or change to the earlier six-color implementation was needed.
