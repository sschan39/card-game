# ST01A card consumers

16 October scope follow-up: this report covers the 炎獸 consumer slice only. The [workbook mechanics review](../workbook-mechanics-review.md) inventories the other card sheets and records the new mechanics they would require; it does not change the support claims below.

15 October 2026. This is a narrow consumer record for the unlocked source workbook `tem/六界之峰.xlsx`, sheet `炎獸` (rows 2–25). It records what the current ordinary engine can run from authored card data and where a printed requirement stops at an explicit gap. It does not establish a full new custom-game profile.

The workbook uses its own game rules: a 60-card deck, at most three copies except land, opening hand of seven with mulligans, first-turn attack restrictions, and both players' mana clearing at end turn. In particular, its mana expiry rule takes precedence over a prior MTG-style phase-expiry proposal. `3無` in the source means any three energy.

The source’s Scorch references conflict: its rules material refers to energy total, while affected card text says `能力總值`. No threshold semantics were inferred from either phrase.

## Support matrix

| Source row / card | Current authored result | Support boundary |
|---|---|---|
| 2 / 阿基里斯爪牙 | Not included as a full consumer. The engine can offer an optional enter-the-battlefield target and add a named counter to an opposing Creature or Artifact. | `灼熱` destruction at the printed threshold is unsupported. No `能力總值` characteristic or custom state action exists. |
| 3 / 帝國奴僕 | `empire-servant`: full. One red energy cost; tap to add one red energy. | Ordinary activated mana ability. |
| 4 / 火槍團下等兵 | `musketeer-infantry`: full. One red energy, 4/5, no rules ability. | Ordinary creature data only. |
| 5 / 赤狼 | Not included. | The requested reveal of the top three, choosing a non-self 炎獸 card, moving it to hand, and placing the remaining revealed cards on the bottom in chosen order needs a bounded reveal window, source-ID exclusion, and remainder ordering contract. Current search sees the complete zone. |
| 6 / 强攻之怒焰狼 | Not included. | No Chain state/event exists. Counter changes have no authorable trigger, so the nonstacking draw when placing Scorch is also unavailable. |
| 7 / 睿智之怒焰狼 | Not included. | An ordinary activated ability is battlefield-only and an ordinary discard cost cannot discard its own hand source. Fast Scorch and Chain prevention have the same missing mechanics. |
| 8 / 諸界火術士 | Not included as a full consumer. Attack triggers can choose an opposing Creature and deal two damage. | The same trigger cannot honestly perform the mandatory follow-up draw as ordered instructions on one stack object. |
| 9 / 諸界帝國反抗軍 | `worlds-rebel`: partial. On attack, choose an opposing Artifact or Land and destroy it. | Its Chain-suppression instruction is annotated as unsupported. |
| 10 / 破裂火球 | `broken-fireball`: partial. Instant: deal three damage to an opposing player. | The reveal-by-炎獸 permission to put this card into hand is unsupported. |
| 11 / 火球術 | `fireball`: partial. Instant: deal five damage to an opposing player. | The main-speed Scorch-two mode is unsupported; a card has one cast-speed admission rule, and Scorch has no implementation. |
| 12 / 烈焰獠牙 | `flame-fangs`: full. Instant: destroy an opposing Land, then draw one card. | This is an ordinary multi-effect spell sequence, which existing spell effect lists resolve in order. |
| 16 / 被啓動的血炎山 | `awakened-blood-mountain`: partial. Optional draw one when an opponent loses life. | Its reveal-related instruction is annotated as unsupported. |
| 25 / 血炎山 | `land-red`: full. Land that taps for one red energy. | Ordinary land/mana ability. |

The catalog annotations are part of the consumer definitions: `【未支援…】` labels explain a missing printed mechanic instead of claiming that a partial card implements it.

The remaining source rows were also inspected and are deferred:

| Source row / card | Reason for deferring the card |
|---|---|
| 13 / 點火狼 | Scorch threshold and the restriction to targets without Scorch. |
| 14 / 炎極雇傭兵 | Activation by discarding its own hand source, special-summon provenance, and a compound destroy/draw instruction. |
| 15 / 烈焰弩炮 | Tap and energy costs already exist; its Scorch destruction rule does not. |
| 17 / 强權崛起 | The fixed extra draw depends on the existence of an 炎獸 Creature. Adding the number of such creatures would change the printed rule. No approximate implementation is included. |
| 18 / 炎極三公 凱隆 | Enter, attack and death triggers exist; their Scorch effect is deferred. |
| 19 / 炎極三公 安度基特斯 | Reveal permission, discarding from the revealed set, Scorch, and a compound instruction. |
| 20 / 諸界烈刃 | Equipment attachment is deferred; its compound attack trigger also exceeds the current one-effect trigger definition. |
| 21 / 烈焰狼王 凱普斯 | The draw depends on this effect actually destroying a card. An unconditional second trigger would change its behavior. |
| 22 / 極炎皇帝 阿基里斯 | Bounded reveal and ordered remainder, Scorch, and damage derived from Scorch totals. |
| 23 / 阿基里斯血炎神殿 | The full card needs Scorch; its lowest-health selection is not authored in this slice. |
| 24 / 諸界六皇 血怒之馬甸尼 | Conditional compound enter instruction (damage, then gain stats). The static 幽爾 attack bonus alone is expressible, but the full card is deferred. |

## Existing contracts used

The implemented entries use existing card data and normal engine paths only:

- cards, cast requirements, mana costs, types, stats and effects: `src/library/card_data.json`;
- target selection and target groups for attack triggers, including opposing Artifact/Land filters: `src/engine/trigger-scheduler.ts`;
- ordinary effects for destruction, drawing, mana and player damage: `src/engine/effect-registry.ts`;
- deterministic ST01A-only setup: `src/config.ts`.

This does not make every workbook rule part of the ordinary engine. The included cards run under the current engine’s established turn, stack, priority, targeting and resolution rules; the workbook remains the source for printed card text and its explicitly identified custom rules.

## Playable setup

`st01aTestSetup` is opt-in and leaves the default deck unchanged. It contains 60 cards: one of each of the seven included nonland definitions and 53 copies of 血炎山. The seven-card opening hand contains three lands, 帝國奴僕, 火槍團下等兵, 破裂火球 and 烈焰獠牙. The fixed subsequent draws make the other consumers available without debug actions; this is a repeatable test deck rather than a balanced deck list.

After building the server and client, select that central setup when starting a separate local server:

```powershell
$env:PORT = '3003'
node -e 'const {gameConfig,st01aTestSetup}=require("./dist/config");gameConfig.setup=st01aTestSetup;require("./dist/server");'
```

Open `http://localhost:3003/` in two sessions and create/join a room normally. The profile changes only the deck and opening hand size; it does not claim custom turn, Chain or mulligan rules.

## Gaps recorded before mechanic work

### Scorch and Chain

Generic counters can be added, removed and stored, but no `灼熱` event, threshold, threshold characteristic, or destruction rule is authorable. Likewise, current permissions concern casting and activation; they do not define Chain, decide which effects count as Chain, or suppress one. These need explicit custom semantics before any implementation.

### Reveal, top-of-library and reveal permissions

Current resolution search selects from a whole zone. It does not form a private/revealed top-three set, filter one card by “not this card”, retain an ordered remainder, or grant a card access because another card revealed it. Those are separate visibility, ordering and casting/access contracts.

### Compound triggered instructions

An ordinary spell has an ordered `onCastEffects` list, which is why 烈焰獠牙 can destroy then draw. An ordinary triggered ability has one authored effect. It cannot represent `deal 2 damage, then draw 1` as one trigger without either making fake modes/options or splitting it into two independent triggers. The latter changes stack order and response opportunities, so it is not an honest representation. No such workaround is used here.

### Mixed timing modes and cross-zone costs

Modes select effects after a card has passed its single cast-speed admission rule; they do not give one mode main timing and another instant timing. Ordinary activation also begins on the battlefield, and ordinary discard costs exclude the source card in hand. These contracts prevent 火球術’s full dual mode and 睿智之怒焰狼’s requested hand-discard activation.

## Verification record

The actual-definition engine tests cover printed costs/stats, generic energy, mana activation, both damage spells, ordered destroy/draw, opponent-only Artifact/Land attack targets, and accepting/declining the life-loss draw.

The fresh-room socket scenario casts all seven nonland definitions, uses ordinary lands and mana, passes priority, declares combat and answers trigger choices. It observes both `attack-destroy` and `opponent-life-loss-draw` on both clients. It reaches a winner from 20 starting life on the first player's fifth turn, then verifies frozen terminal state, rejected post-game commands and reconnect. No room preparation, blueprint replacement, synthetic trigger emission or debug resolution is used. The isolated scenario passed in 53.73 seconds.

Browser check on port 3003: two new sessions created/joined room `78617c20-091f-47ee-8681-4d118e77485a`, completed RPS, received the printed seven-card hand, played 血炎山, produced red energy and cast 火槍團下等兵. Both screens displayed the resolved 4/5 creature after ordinary passes. The partial reveal note on 破裂火球 and complete destroy/draw text on 烈焰獠牙 were present in the card tooltips. The complete winner scenario above is a socket test, not a claim of a complete manual browser match.

Server compilation, client type checking and the production client build passed. No production file under `src/engine` or `src/types` was changed for these consumers.

Final regression run: **85 files, 1,090 tests passed** with one worker (174.58 seconds), including the 11 real-card engine cases and the complete socket match. Independent read-only review found no consumer-scope correctness issues. Diff whitespace checks passed.

The first two-worker full run passed 1,083 tests and failed seven socket cases. The new full-match case exceeded its 90-second budget; its long-lived setup override then affected later setup-dependent cases. The override now ends immediately after room creation, and the new long case has a 180-second budget. Other failures were socket wait/test timeouts. The serial rerun above passed without changing engine behavior. This timing evidence does not establish a smooth late-game client experience; accumulated history remains a performance follow-up.

The later [workbook consumer pass](08-existing-mechanics-consumers.md) expands beyond ST01A using existing mechanics. Its new complete definitions are tracked separately from the partial cards above.
