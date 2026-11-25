# Workbook card readiness — 3 November 2026

**Current blocker status:** see [the current card blocker ledger](card-blockers-current.md). Tables and verification counts below describe their original delivery snapshots.

**Historical assessment:** the counts below describe commit 488195e. See the [subsequent data-only implementation and complete in-scope dispositions](workbook-data-only-batch-2026-11-03.md) for the ten added cards, clarified terms and explicit BP01/Void/dual-color exclusions.

The [shared-query follow-up](card-query-architecture.md) subsequently removes the basic zone/filter blockers and adds another five cards.

The [rule-contract follow-up](rule-contract-architecture.md#what-this-removes-from-the-blocker-list) adds conditional modifiers, cast pricing and passive event-replacement authoring. It adds no workbook cards; its blocker table distinguishes supported mechanics from remaining wording and engine work.

**Reviewed commit:** 488195e. Read-only workbook assessment; no cards/rules were changed. Local source: tem/六界之峰.xlsx (ignored author workbook, not a committed repository dependency). SHA-256: 27b91d995e22fb8540a04c78a73d41f64daa08b216b275aceb1f282723a64d7d.

## What the numbers mean

79 registered JSON definitions exist: 71 map by normalized printed name to workbook rows, seven are development fixtures and one is Crimson Hellkite. The nine populated card sheets contain 277 named rows and 270 distinct normalized labels, including duplicate Void entries and placeholders. 71 rows match definitions; 206 named rows do not. BP01 also has 34 unnamed draft rows, excluded from these counts.

Matching means a definition exists, not complete fidelity. Nine mapped definitions explicitly mark deferred Scorch relic handling; six dual lands need atomic entry timing review; other source/rule differences are listed below. Do not label all 71 fully ready.

**Verification:** 145 passing checks across six focused files: workbook-consumers, st01a-consumers, starter-hand-consumers, bounded-reveal, equipment and small-card-mechanics. No long socket suite, browser interaction or new per-card exhaustive certification. Those tests prove the exercised slices, not every workbook interaction.

## Sheet coverage

| Workbook sheet | Named rows | Existing definitions | No matching definition |
|---|---:|---:|---:|
| 炎獸 | 24 | 24 | 0 |
| 幻影木偶 | 23 | 5 | 18 |
| 風獸 | 23 | 9 | 14 |
| 冰龍 | 25 | 2 | 23 |
| 上使 | 23 | 3 | 20 |
| 蒼巨人 | 24 | 10 | 14 |
| 虛界靈 | 12 | 0 | 12 |
| BP01 - 元初大地 | 111 | 12 | 99 |
| 雙色補充包 | 12 | 6 | 6 |

## Ready foundation

Existing consumer evidence covers mana producers, ordinary creatures, typed/color/tribal targets, ordered draw/discard/mill/search/shuffle, temporary buffs, attack/entry/death triggers, optional choices, bounded reveal/reorder, selected counter effects, basic equipment and general replacement/prevention infrastructure.

Examples to build on: 帝國奴僕, 火槍團下等兵, 天犬, 風靈獸 魔豆/巧兔/舞狐, 諸界游歷者, 法蒂奧戰士, 幻影地界兵, 蒼海巡察組, 幻海人下士, 狂海幻力, 追求淨化之火 and 諸界烈刃. Read their consumer tests; these are not substitutes for tests of a newly authored card.

## Best first missing-card batch

| Card | Source | Existing pattern to reuse | Remaining work |
|---|---|---|---|
| 冰霜巨人 — conditional, not ready yet | 冰龍 row 8 | Vanilla creature stats | Its printed cost is 3寒2兵. Clarify 兵 before authoring; do not silently convert it to generic mana. |
| 幻影工兵 | 幻影木偶 row 4 | Self mill then filtered graveyard recovery | Ordered effects, black-creature filter, empty/eligible-choice tests |
| 諸界風靈使 | 風獸 row 8 | 赤狼-style top-three reveal | 幽爾 filter, optional selection/remainder order tests |
| 影木劍 | 幻影木偶 row 9 | Equipment host restriction + attack stat reduction | Phantom-puppet host filter, granted trigger, detach/reassign tests |
| 炎極兵刃 | BP01 row 9 | Equipment + attack draw | 炎獸 host filter and attack-trigger tests |
| 天域長槍 | 上使 row 9 | Equipment + ordered gain-life/draw | Printed attack modifier, host lifecycle and order tests |
| 吞雷聖劍 | 上使 row 19 | Tribal equipment + gain-three/draw | 上使 host filter and ordered consumer tests |
| 天域門衛 | 上使 row 5 | Block/destroy triggers + life/draw | Exact destruction versus death scope, two timing tests |

These are authoring candidates after reading the full row, not pre-implemented or guaranteed data-only. Confirm printed costs/stats and response timing as part of each batch.

## Resolve format and source differences first

- Workbook rule cell 游戲規則!A1 says default three copies, minimum 60 with no upper bound, opening seven and a mulligan. Current standard-v1 allows four copies, caps 250 and ordinary engine defaults open five. One mulligan and winner choosing first/second are not established by current game setup.
- Most printed unlimited lands are not in the current unlimitedCopies exception list: only land-red is unlimited. 幻影魔城 and 諸界海 print singleton limits that current eligibility does not encode. 幻影木偶 prints a special twenty-copy limit and is not authored yet.
- Current accepted Scorch creature threshold is attack plus maximum health; workbook text varies between energy value and fixed counters. Preserve the accepted interpretation until the owner decides otherwise. Relic threshold remains explicitly deferred on nine cards.
- Dual-land entry TAP is currently a trigger. Literal enters-tapped behavior requires atomic entry handling, not only rewriting the card text.
- Workbook customs differ from MTG-style priority/combat/turn machinery. Choose a versioned format/rules profile; do not silently change every rule while importing cards.
- Blank effects/placeholders are design questions, not engine tasks. Duplicate Void entries must be reconciled before assigning canonical IDs.
- Cost symbol 兵 appears in 霜月門衛 (1寒1兵) and 冰霜巨人 (3寒2兵), outside the current six colors/generic-cost mapping. Its meaning must be specified before these cards are treated as simple consumers.

## Mechanics to add or validate in separate slices

| Slice | Workbook consumers | Needed boundary |
|---|---|---|
| Void zone / starting selection | 虛界靈 sheet and BP01 Void support cards | New zone/lifecycle, starting-hand choice, activation permission and game UI |
| Graveyard casting / ritual summons | 幻影木偶/幻影巨人, 山谷巨龍, 冥者殿戰神 | Zone-aware timing/costs, material selection, summed requirements, provenance |
| Soul destruction | 冥者 series | Workbook rules Q8 define non-damage zero-life departure. Map this explicitly onto the current damage/toughness/SBA model, retain a semantic reason and implement its trigger consumers; do not treat every death as 魂滅. |
| Aurora / equipment counters | 極光冰龍, 巨龍的祝福, 霜月門衛 | Counter-granted rules and once-per-turn prevention; reuse generic replacements, do not rebuild damage |
| Per-game / special expiry | 風靈獸 狂獅大將軍哈爾, 極北王冠, next-turn freezes | Usage identity, reset semantics, combat/next-turn durations, skip untap |
| Stored cards under a host | 風靈獸 大酋長里昂, 天域三侯, 傀儡酋長 | Owned under-card zone, selection/release, host leave/re-entry and visibility |
| Tokens / created altars | 亞拉里亞最終兵器 天域神城, 雷巾祭壇 producers | Token creation/blueprints, cleanup, counts and serialization |
| Advanced combat / retargeting / dynamic ability text | Mandatory defenders, 冰風守護者, Void support effects | Explicit legal-action/UI contracts and regressions; not blanket JSON approximation |

Suggested order: format/eligibility decisions → first small card batch → remaining single-primitive consumers → shared mechanics slices → complex Void/ritual/hosted-card families. Use Scenario Lab fixtures per batch and short relevant socket checks only where a new interaction boundary needs them.

## Complete named-row inventory

Statuses below are definition coverage. Notes are source-review flags and routing hints, not automatic proof that a suggested mechanic is absent or sufficient. Existing definitions require an interaction audit before a full workbook-fidelity claim. The global format gaps apply even when a row has no individual deck note.

### 炎獸

| Row | Card | Definition | Coverage / next work |
|---:|---|---|---|
| 2 | 阿基里斯爪牙 | [achilles-minion](../apps/server/src/catalog/cards/st01a/achilles-minion.json) | Known partial: relic Scorch destruction; use accepted creature threshold, not stale workbook threshold |
| 3 | 帝國奴僕 | [empire-servant](../apps/server/src/catalog/cards/core/empire-servant.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 4 | 火槍團下等兵 | [musketeer-infantry](../apps/server/src/catalog/cards/core/musketeer-infantry.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 5 | 赤狼 | [red-wolf](../apps/server/src/catalog/cards/st01a/red-wolf.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 6 | 强攻之怒焰狼* | [strong-ignition-wolf](../apps/server/src/catalog/cards/st01a/strong-ignition-wolf.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 7 | 睿智之怒焰狼* | [wise-ignition-wolf](../apps/server/src/catalog/cards/st01a/wise-ignition-wolf.json) | Known partial: relic Scorch destruction; use accepted creature threshold, not stale workbook threshold |
| 8 | 諸界火術士 | [worlds-pyromancer](../apps/server/src/catalog/cards/st01a/worlds-pyromancer.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 9 | 諸界帝國反抗軍 | [worlds-rebel](../apps/server/src/catalog/cards/core/worlds-rebel.json) | Source reconciliation: workbook says battle/effect Chain suppression; definition describes effect suppression |
| 10 | 破裂火球 | [broken-fireball](../apps/server/src/catalog/cards/core/broken-fireball.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 11 | 火球術 | [fireball](../apps/server/src/catalog/cards/core/fireball.json) | Known partial: relic Scorch destruction; use accepted creature threshold, not stale workbook threshold |
| 12 | 烈焰獠牙 | [flame-fangs](../apps/server/src/catalog/cards/core/flame-fangs.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 13 | 點火狼 | [ignition-wolf](../apps/server/src/catalog/cards/st01a/ignition-wolf.json) | Known partial: relic Scorch destruction; use accepted creature threshold, not stale workbook threshold |
| 14 | 炎極雇傭兵 | [flame-mercenary](../apps/server/src/catalog/cards/st01a/flame-mercenary.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 15 | 烈焰弩炮 | [flame-ballista](../apps/server/src/catalog/cards/st01a/flame-ballista.json) | Known partial: relic Scorch destruction; use accepted creature threshold, not stale workbook threshold |
| 16 | 被啓動的血炎山 | [awakened-blood-mountain](../apps/server/src/catalog/cards/st01a/awakened-blood-mountain.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 17 | 强權崛起 | [rise-of-power](../apps/server/src/catalog/cards/st01a/rise-of-power.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 18 | 炎極三公 凱隆 | [chiron](../apps/server/src/catalog/cards/st01a/chiron.json) | Known partial: relic Scorch destruction; use accepted creature threshold, not stale workbook threshold |
| 19 | 炎極三公 安度基特斯 | [andu-gittes](../apps/server/src/catalog/cards/st01a/andu-gittes.json) | Known partial: relic Scorch destruction; use accepted creature threshold, not stale workbook threshold |
| 20 | 諸界烈刃 | [worlds-flameblade](../apps/server/src/catalog/cards/st01a/worlds-flameblade.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 21 | 烈焰狼王 凱普斯* | [wolf-king-keps](../apps/server/src/catalog/cards/st01a/wolf-king-keps.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 22 | 極炎皇帝 阿基里斯 | [flame-emperor-achilles](../apps/server/src/catalog/cards/st01a/flame-emperor-achilles.json) | Known partial: relic Scorch destruction; use accepted creature threshold, not stale workbook threshold |
| 23 | 阿基里斯血炎神殿 | [achilles-blood-temple](../apps/server/src/catalog/cards/st01a/achilles-blood-temple.json) | Known partial: relic Scorch destruction; use accepted creature threshold, not stale workbook threshold |
| 24 | 諸界六皇 血怒之馬甸尼* | [bloodrage-maadini](../apps/server/src/catalog/cards/st01a/bloodrage-maadini.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 25 | 血炎山 | [land-red](../apps/server/src/catalog/cards/core/land-red.json) | Defined baseline: consumer/regression evidence still required for each added interaction |

### 幻影木偶

| Row | Card | Definition | Coverage / next work |
|---:|---|---|---|
| 2 | 幻影木偶* | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 3 | 幻影地界兵 | [phantom-land-soldier](../apps/server/src/catalog/cards/workbook/phantom-land-soldier.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 4 | 幻影工兵 | Not defined | Reviewed first-batch candidate: author canonical JSON plus focused tests; not implemented yet |
| 5 | 幻影營長 | [phantom-captain](../apps/server/src/catalog/cards/workbook/phantom-captain.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 6 | 幻影巨人 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 7 | 赫拉充靈術 | [hera-empowerment](../apps/server/src/catalog/cards/workbook/hera-empowerment.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 8 | 赫拉鬼火術 | Not defined | Implement workbook Q8 non-damage zero-life departure reason and consumers |
| 9 | 影木劍 | Not defined | Reviewed first-batch candidate: author canonical JSON plus focused tests; not implemented yet |
| 10 | 幻影木偶工廠 | Not defined | Once-per-game tracking and identity/reset semantics |
| 11 | 赫拉的營寨 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 12 | 幻像祭壇 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 13 | 幻影夢人 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 14 | 幻影木偶 鬼斧 | Not defined | Implement workbook Q8 non-damage zero-life departure reason and consumers |
| 15 | 幻影木偶 鬼火 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 16 | 幻影魔城* | [phantom-castle](../apps/server/src/catalog/cards/workbook/phantom-castle.json) | Deck legality: printed one-copy restriction is not encoded by current generic eligibility |
| 17 | 死亡組裝 | Not defined | Token creation/lifecycle |
| 18 | 幻影木偶軍團長 | Not defined | Combat-instance duration/cancellation |
| 19 | 幻影木偶智者* | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 20 | 赫拉幻影術 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 21 | 幻影魔鐮 鬼火 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 22 | 幻影魔神 赫拉尼亞* | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 23 | 幻影女王 赫拉 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 24 | 幻影旅團地府 | [phantom-underworld](../apps/server/src/catalog/cards/workbook/phantom-underworld.json) | Deck legality: printed unlimited copies missing from current exception list |

### 風獸

| Row | Card | Definition | Coverage / next work |
|---:|---|---|---|
| 2 | 風靈獸 魔豆 | [wind-beast-bean](../apps/server/src/catalog/cards/workbook/wind-beast-bean.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 3 | 風靈獸 巧兔 | [wind-beast-rabbit](../apps/server/src/catalog/cards/workbook/wind-beast-rabbit.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 4 | 風靈獸 舞狐 | [wind-beast-fox](../apps/server/src/catalog/cards/workbook/wind-beast-fox.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 5 |  風靈獸 刃狼 | Not defined | Name-substring filters |
| 6 | 諸界商人 | [worlds-merchant](../apps/server/src/catalog/cards/workbook/worlds-merchant.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 7 | 諸界游歷者 | [worlds-traveler](../apps/server/src/catalog/cards/workbook/worlds-traveler.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 8 | 諸界風靈使 | Not defined | Reviewed first-batch candidate: author canonical JSON plus focused tests; not implemented yet |
| 9 | 初級風疲術 | [lesser-wind-fatigue](../apps/server/src/catalog/cards/workbook/lesser-wind-fatigue.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 10 | 風靈再生 | Not defined | Combat-instance duration/cancellation; Name-substring filters |
| 11 | 歐凱爾山脈 | [okair-mountains](../apps/server/src/catalog/cards/workbook/okair-mountains.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 12 | 歐凱爾之墓 | [okair-tomb](../apps/server/src/catalog/cards/workbook/okair-tomb.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 13 | 風靈先知 | Not defined | Name-substring filters |
| 14 | 風靈號角手 | Not defined | Name-substring filters |
| 15 | 風靈獸之子 | Not defined | Next-turn/skip-untap expiry; Name-substring filters |
| 16 | 生機木杖 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 17 | 獸帝的號令 | Not defined | Name-substring filters |
| 18 | 風靈獸 號角手姆拉德* | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 19 | 風靈獸 旗手納馬蘭 | Not defined | Name-substring filters |
| 20 | 風靈獸之怒 | Not defined | Name-substring filters |
| 21 | 風靈獸 狂獅大將軍哈爾 | Not defined | Once-per-game tracking and identity/reset semantics; Next-turn/skip-untap expiry |
| 22 | 風靈戰皇 里昂·加拉爾 | Not defined | Next-turn/skip-untap expiry |
| 23 | 風靈獸 大酋長里昂 | Not defined | Under-card storage/release and host lifecycle |
| 24 | 萬獸聖國 | [beast-holy-land](../apps/server/src/catalog/cards/workbook/beast-holy-land.json) | Deck legality: printed unlimited copies missing from current exception list |

### 冰龍

| Row | Card | Definition | Coverage / next work |
|---:|---|---|---|
| 2 | 寒冬幼龍 | [winter-drake](../apps/server/src/catalog/cards/workbook/winter-drake.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 3 | 寒霜使者 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 4 | 封印的極光龍像 | Not defined | Counter-granted abilities/prevention; reuse existing replacement pipeline; Dynamic text/ability policy change |
| 5 | 極光冰龍 | Not defined | Counter-granted abilities/prevention; reuse existing replacement pipeline |
| 6 | 冰風守護者 | Not defined | Counter-granted abilities/prevention; reuse existing replacement pipeline; Retargeting already-announced effects |
| 7 | 霜月門衛 | Not defined | Clarify printed 1寒1兵 cost; Counter-granted abilities/prevention; reuse existing replacement pipeline |
| 8 | 冰霜巨人 | Not defined | Clarify printed 3寒2兵 cost before simple-creature authoring; Reviewed first-batch candidate: author canonical JSON plus focused tests; not implemented yet |
| 9 | 冰龍魔杖 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 10 | 冰龍呼喚 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 11 | 極光之盾 | Not defined | Life floor/setting semantics |
| 12 | 巨龍的祝福 | Not defined | Counter-granted abilities/prevention; reuse existing replacement pipeline |
| 13 | 冰霜之魂 | Not defined | Counter-granted abilities/prevention; reuse existing replacement pipeline |
| 14 | 霜月守護者 | Not defined | Combat-instance duration/cancellation |
| 15 | 冰陵之主 | Not defined | Counter-granted abilities/prevention; reuse existing replacement pipeline |
| 16 | 極北王冠 | Not defined | Once-per-game tracking and identity/reset semantics |
| 17 | 極光之壁 | Not defined | Counter-granted abilities/prevention; reuse existing replacement pipeline; Combat-instance duration/cancellation |
| 18 | 極北之指引者 萊莘德雅 | Not defined | Counter-granted abilities/prevention; reuse existing replacement pipeline |
| 19 | 極光封 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 20 | 極光龍宮 | Not defined | Counter-granted abilities/prevention; reuse existing replacement pipeline |
| 21 | 極光龍后 亞雅隆 | Not defined | Counter-granted abilities/prevention; reuse existing replacement pipeline |
| 22 | 極北龍帝 亞瑟 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 23 | 巨龍之墓 | Not defined | Counter-granted abilities/prevention; reuse existing replacement pipeline |
| 24 | 寒巢之主 亞蕾雅 | Not defined | Combat-instance duration/cancellation; Life floor/setting semantics |
| 25 | 諸界六皇 冬機之卡斯拿斯 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 26 | 極光北地 | [aurora-northland](../apps/server/src/catalog/cards/workbook/aurora-northland.json) | Deck legality: printed unlimited copies missing from current exception list |

### 上使

| Row | Card | Definition | Coverage / next work |
|---:|---|---|---|
| 2 | 天犬 | [sky-hound](../apps/server/src/catalog/cards/workbook/sky-hound.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 3 | 小翼使者 | [winged-envoy](../apps/server/src/catalog/cards/workbook/winged-envoy.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 4 | 天域巡邏兵 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 5 | 天域門衛 | Not defined | Reviewed first-batch candidate: author canonical JSON plus focused tests; not implemented yet |
| 6 | 天域地界使 雷拉 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 7 | 天域尋索者 耶拉* | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 8 | 亞拉里亞最終兵器 天域神城 | Not defined | Token creation/lifecycle |
| 9 | 天域長槍 | Not defined | Reviewed first-batch candidate: author canonical JSON plus focused tests; not implemented yet |
| 10 | 天域之門 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 11 | 聖能術 · 速 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 12 | 亞拉里亞的終末 | Not defined | Once-per-game tracking and identity/reset semantics |
| 13 | 天域之獸 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 14 | 天域三侯 坡加 | Not defined | Under-card storage/release and host lifecycle |
| 15 | 天域三侯 萊拉 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 16 | 天域三侯 伊雲 | Not defined | Once-per-game tracking and identity/reset semantics |
| 17 | 雷霆之門 | Not defined | Token creation/lifecycle; Once-per-game tracking and identity/reset semantics |
| 18 | 亞拉里亞的截擊 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 19 | 吞雷聖劍 | Not defined | Reviewed first-batch candidate: author canonical JSON plus focused tests; not implemented yet |
| 20 | 天使的皇座 | Not defined | Under-card storage/release and host lifecycle; Dynamic text/ability policy change |
| 21 | 天使女帝 蝶后 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 22 | 大天使 費蘭尼 | Not defined | Once-per-game tracking and identity/reset semantics; Combat-instance duration/cancellation; Life floor/setting semantics |
| 23 | 天使皇 亞拉里亞 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 24 | 天使的聖地 | [angel-holy-land](../apps/server/src/catalog/cards/workbook/angel-holy-land.json) | Deck legality: printed unlimited copies missing from current exception list |

### 蒼巨人

| Row | Card | Definition | Coverage / next work |
|---:|---|---|---|
| 2 | 蒼海城貴族 | [sea-city-noble](../apps/server/src/catalog/cards/workbook/sea-city-noble.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 3 | 蒼海巡察組 | [sea-patrol](../apps/server/src/catalog/cards/workbook/sea-patrol.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 4 | 幻海人 塔薩 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 5 | 幻海人 戈圖 | [phantom-sea-gotu](../apps/server/src/catalog/cards/workbook/phantom-sea-gotu.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 6 | 幻海人下士 | [phantom-sea-corporal](../apps/server/src/catalog/cards/workbook/phantom-sea-corporal.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 7 | 深淵幻士 | [abyss-illusionist](../apps/server/src/catalog/cards/workbook/abyss-illusionist.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 8 | 海歸的幻術者 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 9 | 沉沒的巨船 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 10 | 狂海幻力 | [raging-sea-power](../apps/server/src/catalog/cards/workbook/raging-sea-power.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 11 | 海底深淵 | [sea-depths](../apps/server/src/catalog/cards/workbook/sea-depths.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 12 | 諸界海 | [worlds-sea](../apps/server/src/catalog/cards/workbook/worlds-sea.json) | Deck legality: printed one-copy restriction is not encoded by current generic eligibility |
| 13 | 蒼海王子 | Not defined | Ritual material selection, summed cost, summon provenance |
| 14 | 深淵巨人 | Not defined | Ritual material selection, summed cost, summon provenance |
| 15 | 深海之墓 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 16 | 永恆魔洋 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 17 | 魔海尖塔 | Not defined | Once-per-game tracking and identity/reset semantics |
| 18 | 海神呼喚者 海耶 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 19 | 諸界海之主 | [worlds-sea-lord](../apps/server/src/catalog/cards/workbook/worlds-sea-lord.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 20 | 幻變神殿 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 21 | 海神之怒 耶夢加得 | Not defined | Name-substring filters |
| 22 | 幻變之海 洛基尼亞 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 23 | 蒼海帝 洛基 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 24 | 諸界六皇 萬智之德步尼* | Not defined | Once-per-game tracking and identity/reset semantics |
| 25 | 蒼海領地 | [sea-domain](../apps/server/src/catalog/cards/workbook/sea-domain.json) | Deck legality: printed unlimited copies missing from current exception list |

### 虛界靈

| Row | Card | Definition | Coverage / next work |
|---:|---|---|---|
| 2 | 虛界炎狼 亞里 | Not defined | Void-zone lifecycle/selection/activation and UI |
| 3 | 虛界人偶 幻影 | Not defined | Void-zone lifecycle/selection/activation and UI |
| 4 | 虛界風獸 牙芽 | Not defined | Void-zone lifecycle/selection/activation and UI |
| 5 | 虛界冰龍 里奧 | Not defined | Void-zone lifecycle/selection/activation and UI; Counter-granted abilities/prevention; reuse existing replacement pipeline |
| 6 | 虛界天使 麗拉 | Not defined | Void-zone lifecycle/selection/activation and UI |
| 7 | 虛界巨人 拉斯 | Not defined | Void-zone lifecycle/selection/activation and UI |
| 8 | 虛界烈龍 波盧 | Not defined | Void-zone lifecycle/selection/activation and UI |
| 9 | 虛界冥者 幽倫 | Not defined | Void-zone lifecycle/selection/activation and UI |
| 10 | 虛界碧靈 | Not defined | Void-zone lifecycle/selection/activation and UI |
| 11 | 虛界 | Not defined | Incomplete source: specify the card/effect before implementation; Void-zone lifecycle/selection/activation and UI |
| 12 | 虛界人將 張梁 | Not defined | Incomplete source: specify the card/effect before implementation; Void-zone lifecycle/selection/activation and UI |
| 13 | 虛界 | Not defined | Incomplete source: specify the card/effect before implementation; Void-zone lifecycle/selection/activation and UI |

### BP01 - 元初大地

| Row | Card | Definition | Coverage / next work |
|---:|---|---|---|
| 2 | 虛界焰靈 | Not defined | Void-zone lifecycle/selection/activation and UI; Dynamic text/ability policy change |
| 3 | 法蒂奧之龍 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 4 | 列龍之呼求者 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 5 | 法蒂奧戰士 | [fatiao-warrior](../apps/server/src/catalog/cards/workbook/fatiao-warrior.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 6 | 諸界古龍 | Not defined | Under-card storage/release and host lifecycle |
| 7 | 山谷巨龍 | Not defined | Ritual material selection, summed cost, summon provenance; Under-card storage/release and host lifecycle; Mandatory attack/block legality |
| 8 | 列龍杖 | Not defined | Mandatory attack/block legality |
| 9 | 炎極兵刃 | Not defined | Reviewed first-batch candidate: author canonical JSON plus focused tests; not implemented yet |
| 10 | 追求淨化之火 | [pursuit-of-purifying-fire](../apps/server/src/catalog/cards/workbook/pursuit-of-purifying-fire.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 11 | 炎極兵陣 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 12 | 過去之故事劇場 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 13 | 烈龍守衛 | Not defined | Life floor/setting semantics |
| 14 | 烈焰智者 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 15 | 烈龍的護焰使者 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 16 | 虛界的血炎戰獸 | Not defined | Void-zone lifecycle/selection/activation and UI; Once-per-game tracking and identity/reset semantics |
| 17 | 原初之戰場 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 18 | 善惡之烈龍 隆 · 德拉貢 | Not defined | Mandatory attack/block legality |
| 19 | 罪孽的過去 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 20 | 淨化的未來 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 21 | 淨化之火 法迪爾奧拉 | Not defined | Ritual material selection, summed cost, summon provenance; Under-card storage/release and host lifecycle; Mandatory attack/block legality |
| 22 | 烈焰的守護者 法迪爾 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 23 | 炎極三公 奧德修斯 | Not defined | Under-card storage/release and host lifecycle |
| 24 | 烈龍聚居地 | [blazing-dragon-habitat](../apps/server/src/catalog/cards/workbook/blazing-dragon-habitat.json) | Deck legality: printed unlimited copies missing from current exception list |
| 25 | 冥者殿女僕 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 26 | 虛界之幻影木偶 | Not defined | Void-zone lifecycle/selection/activation and UI; Dynamic text/ability policy change |
| 27 | 冥者殿小鬼 | Not defined | Implement workbook Q8 non-damage zero-life departure reason and consumers |
| 28 | 冥者殿守衛 | Not defined | Implement workbook Q8 non-damage zero-life departure reason and consumers |
| 29 | 冥者殿圖書管理人 | Not defined | Implement workbook Q8 non-damage zero-life departure reason and consumers; Name-substring filters |
| 30 | 幻影信差 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 31 | 冥者巨靈 | Not defined | Name-substring filters |
| 32 | 幻影木偶 穆頓 | Not defined | Under-card storage/release and host lifecycle; Next-turn/skip-untap expiry |
| 33 | 冥者聖地 | Not defined | Implement workbook Q8 non-damage zero-life departure reason and consumers; Name-substring filters |
| 34 | 冥能的代價 | Not defined | Name-substring filters |
| 35 | 冥者的接力 | Not defined | Name-substring filters |
| 36 | 冥者殿巫師 | Not defined | Implement workbook Q8 non-damage zero-life departure reason and consumers; Name-substring filters |
| 37 | 冥者殿祭司 | Not defined | Implement workbook Q8 non-damage zero-life departure reason and consumers |
| 38 | 冥者殿戰神 | Not defined | Ritual material selection, summed cost, summon provenance; Implement workbook Q8 non-damage zero-life departure reason and consumers |
| 39 | 赫拉操控術 | Not defined | Combat-instance duration/cancellation; Life floor/setting semantics |
| 40 | 冥者殿 | Not defined | Implement workbook Q8 non-damage zero-life departure reason and consumers; Name-substring filters |
| 41 | 冥者守護狼 赫爾森 | Not defined | Implement workbook Q8 non-damage zero-life departure reason and consumers |
| 42 | 幻影木偶 殲滅者 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 43 | 冥者頭顱 | Not defined | Implement workbook Q8 non-damage zero-life departure reason and consumers; Name-substring filters |
| 44 | 冥者之門 刻耳柏洛斯 | Not defined | Implement workbook Q8 non-damage zero-life departure reason and consumers; Name-substring filters |
| 45 | 冥者術神 黑帝斯 | Not defined | Implement workbook Q8 non-damage zero-life departure reason and consumers; Name-substring filters |
| 46 | 諸界六皇 魔邪之基拉奧特 | [worlds-sin-emperor](../apps/server/src/catalog/cards/workbook/worlds-sin-emperor.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 47 | 冥者古地 | [nether-ancient-land](../apps/server/src/catalog/cards/workbook/nether-ancient-land.json) | Deck legality: printed unlimited copies missing from current exception list |
| 48 | 虛界之風靈獸 | Not defined | Void-zone lifecycle/selection/activation and UI; Dynamic text/ability policy change |
| 49 | 風翼嬰靈 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 50 | 迅靈使者 | [swift-spirit-envoy](../apps/server/src/catalog/cards/workbook/swift-spirit-envoy.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 51 | 風之巫女 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 52 | 風靈獸 飛鼠 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 53 | 風翼之獸 天狐 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 54 | 風翼之靈 風神子 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 55 | 虛界之風靈神樹 | Not defined | Void-zone lifecycle/selection/activation and UI; Once-per-game tracking and identity/reset semantics |
| 56 | 迅靈神殿 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 57 | 風之呼喚 | [wind-call](../apps/server/src/catalog/cards/workbook/wind-call.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 58 | 自然的賜予 | [nature-gift](../apps/server/src/catalog/cards/workbook/nature-gift.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 59 | 迅風之靈 羽葉 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 60 | 風織者 霞綾 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 61 | 風神使者 哈耶比 | Not defined | Under-card storage/release and host lifecycle |
| 62 | 風靈虛界獸 | Not defined | Void-zone lifecycle/selection/activation and UI; Once-per-game tracking and identity/reset semantics |
| 63 | 迅風之地 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 64 | 風神之子 阿吽 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 65 | 風神化身 伊弉諾 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 66 | 風神的息吹 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 67 | 風神雷魔 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 68 | 原始風神 伊邪那岐 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 69 | 諸界六皇 疾風之華舒福 | Not defined | Once-per-game tracking and identity/reset semantics |
| 70 | 神風鳥居 | [divine-wind-torii](../apps/server/src/catalog/cards/workbook/divine-wind-torii.json) | Deck legality: printed unlimited copies missing from current exception list |
| 71 | 凍土雪球 | [frozen-snowball](../apps/server/src/catalog/cards/workbook/frozen-snowball.json) | Defined baseline: consumer/regression evidence still required for each added interaction |
| 72 | 虛界之凍土龍 | Not defined | Void-zone lifecycle/selection/activation and UI; Dynamic text/ability policy change |
| 73 | 冰荒機械師 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 74 | 寒霜守護者 凱爾森 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 75 | 凍土冰龍 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 76 | 冰霜導師 菲洛莫 | Not defined | Copy selected ability and expire grants |
| 77 | 暗冰巨龍 辛德雅 | Not defined | Counter-granted abilities/prevention; reuse existing replacement pipeline; Mandatory attack/block legality |
| 78 | 寒冬護符 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 79 | 塞爾維亞 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 80 | 冰封神器 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 81 | 霜凍之鏈 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 82 | 虛界之冰龍 塞爾雅 | Not defined | Void-zone lifecycle/selection/activation and UI; Mandatory attack/block legality |
| 83 | 冰霜守衛者 庫爾 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 84 | 冰霜征服者 瑟倫 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 85 | 霜巨人的兵器鑄造場 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 86 | 冰霜戰錘 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 87 | 霜巨神 瓦爾迪斯 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 88 | 創世巨錘 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 89 | 霜巨之息 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 90 | 遠古冬靈 尤米海爾之心 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 91 | 原初之霜巨人 尤米海爾 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 92 | 原初凍土王 尤米海爾 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 93 | 兵器之古戰場 | [ancient-weapon-battlefield](../apps/server/src/catalog/cards/workbook/ancient-weapon-battlefield.json) | Deck legality: printed unlimited copies missing from current exception list |
| 94 | 虛界之天靈 | Not defined | Void-zone lifecycle/selection/activation and UI; Dynamic text/ability policy change |
| 95 | 雷巾鼓獸 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 96 | 諸界雷巾兵 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 102 | 亞拉里亞的警告 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 112 | 雷巾大祭師 張曼成 | Not defined | Ritual material selection, summed cost, summon provenance |
| 113 | 元初雷魔之首 張角 -化神型態- | Not defined | Once-per-game tracking and identity/reset semantics |
| 114 | 雷巾天將 張寳 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 115 | 雷巾統帥 張角 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 116 | 雷巾主陣 | [thunder-main-camp](../apps/server/src/catalog/cards/workbook/thunder-main-camp.json) | Deck legality: printed unlimited copies missing from current exception list |
| 136 | 海皇道統 季雄 | Not defined | Incomplete source: specify the card/effect before implementation |
| 137 | 海皇道公 張強 | Not defined | Incomplete source: specify the card/effect before implementation |
| 138 | 海皇道霸王 葉歡 | Not defined | Incomplete source: specify the card/effect before implementation |
| 140 | 虛界炎狼 亞里 | Not defined | Void-zone lifecycle/selection/activation and UI |
| 141 | 虛界人偶 幻影 | Not defined | Void-zone lifecycle/selection/activation and UI |
| 142 | 虛界風獸 牙芽 | Not defined | Void-zone lifecycle/selection/activation and UI |
| 143 | 虛界冰龍 里奧 | Not defined | Void-zone lifecycle/selection/activation and UI; Counter-granted abilities/prevention; reuse existing replacement pipeline |
| 144 | 虛界天使 麗拉 | Not defined | Void-zone lifecycle/selection/activation and UI |
| 145 | 虛界巨人 拉斯 | Not defined | Void-zone lifecycle/selection/activation and UI |
| 146 | 雷巾祭壇 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |

### 雙色補充包

| Row | Card | Definition | Coverage / next work |
|---:|---|---|---|
| 2 | 魔炎深淵 | [demon-flame-abyss](../apps/server/src/catalog/cards/workbook/demon-flame-abyss.json) | Timing review: TAP entry trigger is not atomic enters-tapped |
| 3 | 不死暮林 | [undying-dusk-forest](../apps/server/src/catalog/cards/workbook/undying-dusk-forest.json) | Timing review: TAP entry trigger is not atomic enters-tapped |
| 4 | 烈風熔河 | [blazing-wind-river](../apps/server/src/catalog/cards/workbook/blazing-wind-river.json) | Timing review: TAP entry trigger is not atomic enters-tapped |
| 5 | 極北墳場 | [far-north-graveyard](../apps/server/src/catalog/cards/workbook/far-north-graveyard.json) | Timing review: TAP entry trigger is not atomic enters-tapped |
| 6 | 狂雷凍土 | [thunder-tundra](../apps/server/src/catalog/cards/workbook/thunder-tundra.json) | Timing review: TAP entry trigger is not atomic enters-tapped |
| 7 | 巨浪雷陣 | [great-wave-thunder-array](../apps/server/src/catalog/cards/workbook/great-wave-thunder-array.json) | Timing review: TAP entry trigger is not atomic enters-tapped |
| 8 | 炎獄之主 洛基尼亞 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 9 | 傀儡酋長 里昂 | Not defined | Under-card storage/release and host lifecycle |
| 10 | 血怒之風靈王 阿基里斯 | Not defined | Next-turn/skip-untap expiry |
| 11 | 寒魔女王 赫拉尼亞 | Not defined | Not defined: map exact effect/timing/targets to existing primitives; add consumer tests |
| 12 | 大天使龍 亞蕾雅 | Not defined | Counter-granted abilities/prevention; reuse existing replacement pipeline |
| 13 | 神海天使 亞拉里亞 | Not defined | Once-per-game tracking and identity/reset semantics |

## Unnamed BP01 draft rows

97, 98, 99, 100, 101, 103, 104, 105, 106, 107, 108, 109, 110, 111, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 139. These require names/effects/specification before canonical IDs are allocated.
