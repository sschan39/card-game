# Small card mechanics implementation plan

16 October 2026. User-approved scope: implement the small additions in sequence, include ordered ordinary trigger effects, distinguish discard events by source, and defer reveal while auditing deck conflicts. Continue on `codex/workbook-existing-consumers` in the current checkout; preserve previous uncommitted work. No commit/push requested.

## Design and boundaries

Use the existing numeric-query registry, ordered stack cursor, resolution choices, zone moves, proposals/replacements, history, logs and client delta reducer. No separate resolver, reveal subsystem, private-information overhaul or global result store. Shared discard terminology: `DISCARD_FROM_HAND` and `DISCARD_FROM_LIBRARY`; semantic events `CARD_DISCARDED_FROM_HAND` and `CARD_DISCARDED_FROM_LIBRARY`; triggers `ON_DISCARD_FROM_HAND` and `ON_DISCARD_FROM_LIBRARY`. Both move causes remain `reason: discard`; replacement rules can distinguish `from`. Generic zone moves are not discards. Only actual hand/library-to-graveyard discard outcomes emit these events, preserving current destination semantics.

## Execution checklist

- [x] **1. Source-specific discard events first.** Update `game-event.types.ts`, `card.types.ts`, `applied-events.ts`, `trigger-manager.ts`, `turn-history.ts`, client labels and existing references. Red tests: same discard cause from hand vs library emits only its corresponding event/trigger; generic moves and cancelled/redirected moves do not masquerade as completed graveyard discards.
- [x] **2. Existence bonus.** Register `exists` beside `count` in `numeric-values.ts`, returning 0/1 from the same scope/context. Add 强權崛起 and 追求淨化之火 as ordinary ordered spells with `DRAW.amount = 2 + exists(scope)`. Test zero/one/multiple matches, either-player vs friendly scopes and resolution-time reevaluation.
- [x] **3. Library discard.** Register `DISCARD_FROM_LIBRARY` with an integer amount and existing player recipients. Take the top available cards (array end), retain exact identities/revisions, produce normal discard-caused library→graveyard moves and reuse replacement handling. No choice, shuffle or empty-library draw loss. Add 蒼海巡察組, 深淵幻士 and 諸界海之主. Test top order, short/empty deck, source-separated events and a replacement.
- [x] **4. Selected hand discard.** Register `DISCARD_FROM_HAND` and a resolution discard choice. The affected player chooses exactly `min(amount, available hand)` cards; preserve the existing continuation and original hand identities. Add 狂海幻力; test draw→discard order, short hand, invalid/duplicate answers, reconnect/resume and no replay of earlier instructions.
- [x] **5. Ordered ordinary triggers.** Normalize explicit ordered `effects` on triggered abilities and build one stack object through the existing target groups/cursor. Preserve existing single-effect definitions; do not invent modes or separate triggers. Cover normal and delayed trigger paths and numeric validation. Add 諸界火術士 and complete 幻海人 戈圖 once discard primitives exist. Verify source labels, ordered damage→draw, whole-object fizzle and choice continuation. Do not claim 天域門衛 complete without destruction-vs-death semantics.
- [x] **6. Consumers, examples and reveal audit.** Add the actual cards to the central opt-in deck, preserving 60 cards and the known opening. Document exact JSON inputs/limits. Audit whole-zone search vs top-N, array-end order, shuffle/reorder identity revisions, choice continuations, source/result retention, reveal events and existing sync/log paths. Implement no reveal behavior.
- [x] **7. Verification and review.** Run each focused red/green check with `vitest run <files> --config vitest.config.mts --maxWorkers 1`; then full serial regressions, both TypeScript checks, Vite build and diff check. Verify ordinary server actions on both clients and readable effects. Independent read-only review before completion. Record results here.

## Working acceptance examples

```text
hand → graveyard, reason discard    → CARD_DISCARDED_FROM_HAND
library → graveyard, reason discard → CARD_DISCARDED_FROM_LIBRARY
ordinary library transfer           → CARD_MOVED only
draw amount                        → 2 + exists(matching creatures)
draw three → hand discard choice    → discard two → spell finishes
friendly 幽爾 attack                → one trigger: damage two → draw one
```

Reveal is intentionally outside implementation scope. The deck-handling audit follows; final verification is recorded at the end.

## Reveal/deck audit — documentation only

The deck's exact server order is already suitable. Keep its top at the array end, as used by draw and `DISCARD_FROM_LIBRARY`; external ordering choices are top-to-bottom. A reveal should read `deck.slice(-N).reverse()` without removing/resetting cards. There is no need to replace the deck representation or add a permanent reveal database.

| Existing owner | What works | What a future reveal must add/avoid |
|---|---|---|
| `zone-transitions.ts` | Exact UUID plus zone revision on real moves | Do not reveal by moving into hand/exile and back. Those are real moves, reset state, increment revisions and can trigger unrelated events. |
| `library-operations.ts` | Exact permutation shuffle/reorder; explicit top/bottom placement | Reordering/shuffling within the library does not change zone revision. A reference proves the card is the same library occupant, not that it is still among the top N. Retain the revealed set and its order explicitly. |
| `resolution-choices.ts` | Serializable search/ordering/selection continuation | Search examines an entire zone. It cannot serve as a bounded reveal by filtering the current whole deck after another instruction. Restrict options to the captured set. |
| `effect-resolver.ts`, `choice.types.ts` | One ordered cursor, resume after choices, no replay of earlier effects | Current continuation has the stack object, cursor and effect statuses, not named shared card-result sets. Add a local revealed-set result only when implementing the first consumer. |
| `game-event.types.ts` / operation outcomes | Events can represent meaningful committed operations; reveal need not move a card | No authored reveal operation/public reveal event exists. Do not fabricate CARD_MOVED/CARD_DRAWN for information-only disclosure. Reveal-triggered cards remain deferred. |
| `sync-service.ts`, server snapshots | Existing card/choice/delta paths can transport selected information | Opponent deck deltas are dropped; raw snapshots and choice continuations are not a consistent reveal-visibility contract. A future reveal needs an explicit public subset/result and reconnect behavior. This audit does not authorize a private-view/security overhaul. |
| Current remainder operations | Ordered subsets can move/reorder at top or bottom | There is no shared “revealed cards minus chosen cards” result for the next instruction. Preserve captured identities/order, revalidate real zone moves and finish the remainder once. Do not rediscover a new top-N set after choosing. |

Start a future reveal consumer with 風之巫女's top-three / select 迅靈 / return remainder flow. 赤狼 additionally needs self-name exclusion. Resolve when reveal-triggered self-claims may consume a card before allowing two consumers to claim the same revealed card. Those are explicit follow-up decisions, not implemented extension hooks.

## Actual consumers

| Source | Card | ID | New capability consumed |
|---|---|---|---|
| 炎獸!A17:K17 | 强權崛起 | `rise-of-power` | 2 + existence of 炎獸 Creatures on either battlefield |
| BP01 - 元初大地!A10:K10 | 追求淨化之火 | `pursuit-of-purifying-fire` | 2 + existence of friendly 烈龍 Creatures |
| 蒼巨人!A3:K3 | 蒼海巡察組 | `sea-patrol` | Entry discard top two from opponent library |
| 蒼巨人!A7:K7 | 深淵幻士 | `abyss-illusionist` | Friendly 蒼巨人 attack → opponent library discard one |
| 蒼巨人!A19:K19 | 諸界海之主 | `worlds-sea-lord` | Attack → library discard twice current friendly 幽爾 count |
| 蒼巨人!A10:K10 | 狂海幻力 | `raging-sea-power` | Draw three → choose/discard two from hand |
| 炎獸!A8:K8 | 諸界火術士 | `worlds-pyromancer` | Any friendly 幽爾 attacks → one targeted damage-two/draw-one trigger |
| 蒼巨人!A5:K5 | 幻海人 戈圖 | `phantom-sea-gotu` | Optional whole entry draw-two/discard-one group; attack library discard two |

No partial clause was hidden to count these cards as complete under current engine rules. 天域門衛 remains deferred because custom destruction vs ordinary death still needs its own semantics; ordered instructions alone do not settle that distinction. New field spellings are documented in library README section 12 and examples 19–23.

## Verification completed, 16 October 2026

- Test-first evidence: source/event/query tests and ordered-choice tests failed before implementation; the eight-card consumer cases then produced 15 missing-definition failures before adding the cards. Focused engine and workbook checks finished with 105 passing tests across two files.
- Final full serial regression: **88 files, 1,204 tests passed**. This includes the fresh actual-server/two-client scenario using normal actions: both players summon 蒼海巡察組, each discards the opponent's top two library cards; 狂海幻力 draws three and pauses for two selected hand discards; 諸界火術士 attacks, targets an opposing creature, deals two damage, sends the lethal target to graveyard and draws one. Both clients receive the source-specific outcomes, resulting state and readable ordered trigger description.
- That live scenario caught a client label saying “modify stats” for damage. The formatter now says “damage 2”; the final full run includes the corrected assertion. Hand-discard events total two and library-discard events total four after setup; the ordered trigger reports `MODIFY_STATS` then `DRAW`.
- Server TypeScript build, client TypeScript check and production Vite build passed. All **65 catalog definitions** and **23 annotated examples** parse/normalize. Both opt-in presets contain 60 valid cards; normal room defaults remain unchanged. Final diff whitespace check passed.
- Independent read-only review covered discard proposal/replacement outcomes, choice ownership and cursor resume, existence evaluation, and normal/delayed ordered-trigger scheduling. Its documentation finding was corrected in the action/trigger tables and workbook review. The older consumer report now links to this pass instead of presenting completed cards as current gaps.
- Reveal remains documentation-only. No reveal, off-zone discard-self activation, general local result store, destruction-vs-death semantics or activated-effect-list support was added. Changes remain uncommitted.
