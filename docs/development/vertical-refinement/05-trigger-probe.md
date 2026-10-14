# Single-card trigger probe

14 October 2026. One authored `trigger-probe` creature, multiple copies and ordinary lands consume the existing engine. No card-name branches or additional mechanics were added. Normal development setup remains unchanged; the separate `triggerTestSetup` lives in `src/config.ts`.

## Gaps recorded first

| Request | Current gap | Decision |
|---|---|---|
| Aura | Seeded attachment legality/cleanup exists, but ordinary Aura casting has no attach operation. Raw card normalization also does not preserve attachment requirements. An unattached Aura is removed by state-based actions. | Unsupported as a normal playable consumer; do not pretend a creature is an Aura or add attachment mechanics here. |
| Trigger when another ability resolves | `STACK_RESOLVED` exists for diagnostics but has no authored trigger/discovery mapping. | Unsupported directly. Test the supported effect-result chain instead. |
| Unconditional compound triggered/activated instructions | Ordinary abilities author one base effect. Spell/entry effect lists and modal effect lists exist. | Test compound spell instructions; do not claim ordinary multi-effect ability arrays are supported. Modal combinations are outside this probe. |

## Card and checks

The creature is 3/5, costs one red mana and has eight separately identified triggers plus one activated ability. Spell instructions draw one card then gain one life. Entry/block gain one life; attack makes a targeted opponent lose one life; death draws one card. It watches another friendly creature being cast, entering or dying, and its controller drawing. One red mana activates targeted creature destruction. Life-gain effects have no watcher, so the draw chains terminate.

| Case | Outcome and evidence |
|---|---|
| Cast versus entry | Passed. A battlefield watcher fires on another creature's committed cast; the new card does not watch itself from the stack. Compound instructions resolve before the separate entry triggers. |
| Self entry, attack, block, death | Passed through ordinary two-player socket actions and browser controls. Attack asks for its target before stack placement. Death retains departed source information. |
| Friendly creature / draw watchers | Passed. Second cast produces cast/entry watchers and an ordering choice. Opponent and noncreature entry negative checks produce no false friendly watcher. |
| Compound effects | Passed for spell instructions: draw then life change, followed by trigger scheduling. This occurs at resolution, not immediately on cast. |
| Trigger chain | Passed: removal → two death triggers → draw → surviving draw watcher → life gain. The dead source's own trigger still resolves. |
| Target revalidation | Passed: two activated abilities target the same creature; only the top one kills it, the older one fizzles with `object_failed`, with no extra death/draw. Stale-target case is automated socket evidence. |
| Creature combat | Passed: both 3/5 creatures assign three damage and survive with three marked damage. Existing nonlethal regression separately checks retention through reconnect and clearing at cleanup. The card UI does not display marked damage. |
| Client receipt | Passed: both socket clients receive the same trigger stack objects and public results. Both actual browser console logs contain the same trigger UUID and origin event UUID. |
| Ordering/reload | Passed in the browser: select draw/entry ordering; reload with three stack objects pending, then resolve with ordinary priority passes. |
| Aura/direct ability-resolved consumer | Unsupported as above; not implemented. Other registry effects/trigger categories were not exhaustively tested by this card. |

## Pipeline proof

`committed event → EventBus emission → TriggerManager receipt/discovery → queued trigger → ordering/targets → committed stack insertion → published delta → client application → priority passes → effect result`

Queueing is not resolution success. The socket test checks the exact origin `eventUuid`, both clients' stack UUIDs, a committed `STACK_UPDATED` event for each trigger, its resolution report, and actual state effects. No synthetic emission, modified blueprint, injected battlefield or debug resolve/end-turn shortcut is used in that walkthrough. Engine unit fixtures are explicitly separate.

`logging.appliedEvents` enables existing emission logs plus compact `trigger:received` and `trigger:queued` entries. Existing client `delta:applied` logs now include `triggerStack` with ability/stack/origin IDs. Normal applied-event logging stays off; no new logger subsystem or success event was introduced. `discovered` counts ordinary card triggers; separately registered delayed triggers also produce queued logs when accepted.

Concrete browser run: room `0fc74be0-973f-439f-aeb5-0d75125482c0`. One death draws a card and produces `probe-draw`:

| Stage | Recorded identity/result |
|---|---|
| `CARD_DRAWN` emitted | `7264f1d5-6040-40bd-9bdc-6d95b37e017f:2` |
| `trigger:received` | Same event UUID, `discovered: 1` |
| `trigger:queued` | Same event UUID; `probe-draw`; stack `9f785628-c4d0-4723-9df5-3d61d742b2c2` |
| Both browser clients apply delta #98 | Both log that exact stack/origin UUID pair; command `bc450151-1c71-438b-bf03-5975f80c1443` |
| Effect resolves | `STACK_ITEM_RESOLVED`, same stack UUID, `MODIFY_LIFE`, `fizzled: false`; resolution event `2d521d85-4773-493c-b8da-77e05fcac13a:5` |
| Whole death chain completes | Player A hand 5→7, life 28→30, library 16→14, graveyard 3→4; empty stack; surviving creature remains on battlefield. |

Browser combat in that room completed both manual damage choices before removal. The initial room also confirmed targeting/ordering/reload but expired after both browser sessions disconnected; no success is inferred from that unfinished damage choice. The fresh run completed the chain.

## Repeat

Build normally, then start a separate local server with the centralized deck:

```powershell
$env:PORT = '3001'
node -e 'const {gameConfig,triggerTestSetup}=require("./dist/config");gameConfig.setup=triggerTestSetup;gameConfig.logging.appliedEvents=true;require("./dist/server");'
```

Open two independent tabs at `http://localhost:3001/`. Create/join and finish RPS. Each opening hand contains three probes and two lands. Use normal land/mana/cast controls. Cast one probe each, then a second friendly probe on the next turn. Choose trigger ordering and pass priority to resolve. Attack with the ready probe, choose opponent, block with the opposing probe, resolve the block trigger and allocate three damage each. Activate removal on the second friendly probe, order death triggers, and resolve the resulting draw watchers. Compare `triggerStack` IDs in both console logs with server emission/receipt/queue logs.

Coverage: `tests/engine/trigger-probe.test.ts`, `tests/client/trigger-proof.test.ts` and the authored-probe walkthrough in `tests/server/live-routing.test.ts`, alongside canonical events, scheduling and trigger-manager suites. Prior combat retention coverage is preserved.

Final verification: 83 tests passed in six files; server and client type checks passed; production client/server builds passed; diff whitespace check passed. Independent read-only review found no blocking issues. This is focused verification of this consumer and surrounding regressions, not a claim that every engine effect has been exercised.

Player-facing follow-up: log entries and stack rows now share a small instruction formatter: card name, `onPlay`/`onDeath`/`onAnotherEnter`/`activate` label, effect amounts and selected targets. For example, `Trigger Probe · onDeath: { draw 1 → You }`. Compound instructions are separated by semicolons. Leaving the stack is labeled `Left stack`, since a public stack removal alone does not prove successful resolution. No new card schema or engine event is needed. Remaining presentation gaps: marked damage is invisible on cards and the target prompt exposes `effect-0`.
