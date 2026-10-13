# V3 — Existing choices as a playable consumer

Status: implemented and verified, 13 October 2026. Planning baseline `8798da1`, implementation baseline `6771c32`. [Vertical plan](README.md), [execution record](03-playable-choice-consumer-plan.md). Engine contracts: [numeric bindings](../8.4-announcement-bindings.md), [payment routes](../8.4-cost-routes.md), [pending choices](../3.5-pending-choices.md).

## Scope

Make the existing scalar/list/target/discard/payment flow usable through the actual loaded deck and ChoicePanel. Add at most one generic development demonstration spell in `src/library/card_data.json`; its mechanics use existing definitions and handlers only. No variable target counts, stack copies, optional cost modifiers, text interpretation or new UI workflow.

Example definition: declare X from 0 to 4; pay X generic mana or two life, plus one red mana and a mandatory discard either way; target the opponent; resolve an existing life/damage numeric effect using retained X. This deliberately consumes current numeric bindings, alternative/mandatory costs, exact targets and atomic payment in one understandable action. It is not a named-card engine mechanic.

## Boundaries and flow

| Module | Responsibility |
|---|---|
| JSON definition and config | Executable data using explicit declarations/legacy supported ability forms; repeatable demonstration hand with mana and a discard candidate |
| Existing parser/announcement adapter | Preserve the declared meaning and derive the one selected concrete cost |
| Existing action choices and ChoicePanel | Number → route → target → discard → payment; show current choice, range, selected values and cancel |
| Existing handlers/stack/resolver | Pay once, retain X, revalidate exact targets and apply existing effect |
| Existing socket/store | Restore owner prompt after reload/reconnect and keep the other session waiting |

```text
Loaded development spell → choose X → choose payment route → choose target
  → select mandatory discard → choose explicit mana allocation
  → normal atomic commit/stack → both players pass → retained-X resolution
```

Explicit allocation is the existing `choosePayment` action flag. Expose a small "choose mana payment" control in the existing action/target confirmation path; default automatic supported payment remains available. Do not add a second payment dialog. A payment-route option should show its relevant cost and the common mandatory extra, rather than requiring a developer-authored label to carry all semantics. Add only a small shared cost-description helper if current duplicate formatting actually obstructs this consumer.

## Cancellation/error/reconnect expectations

Cancel local targeting before sending: no action/payment. Cancel a server announcement: close the saved draft and pay nothing. An invalid answer retains its prompt with a visible reason. Reload during a discard/payment prompt: the owner returns to that prompt, the other player sees waiting, and later commitment pays once. Reconnection need not recreate unsent local target selections.

Default logs identify choiceId/kind, range or expected allocation total, selected count and accepted/rejected result. Detailed payload inspection remains available centrally. UI messages use card/action terminology; IDs are diagnostic details.

## Implementation/acceptance checkpoint

After item approval, write detailed steps around the actual browser gaps. Expected modifications are one demonstration definition and development setup, existing cost descriptions/action controls/ChoicePanel, and any proven parser field loss for that definition. Do not turn this into a full catalog-validator redesign.

Extend `tests/engine/cost-routes.test.ts`, `tests/client/pending-choices.test.ts`, client action controls and one real-server scenario around the loaded definition rather than only replacing in-memory blueprints. Check X=0 and one positive X, both payment routes, cancellation, one invalid answer and reconnect while unpaid. Reuse existing deeper validation tests.

Browser acceptance: complete both routes through visible controls, cancel once, reload once during payment, and observe matching zones/life/stack/mana in both sessions. The definition must load through the normal parser and setup pipeline. Record steps and logs here; no debug room mutation or React-private callback invocation qualifies as the visible consumer.

## Stop boundary

Stop before a handler branches on the demonstration ID, silently drops a mandatory mechanic, or the UI fabricates committed state. Bring a missing shared consumer boundary back for review instead of patching the sample.

## Implemented contracts

`choice-practice` is one JSON definition loaded through the normal factory/parser. It declares X=0–4, base X generic mana, alternative two life, mandatory one red mana and one discard, and MODIFY_LIFE by -X against the opponent. The engine contains no branch for its ID. `src/config.ts` replaces two development library slots with this definition; the deck stays nine cards and the basic four-card opening hand stays unchanged. Both players draw a consumer normally on their first turn, with another copy available on a later draw.

`describeActionCost` in `src/shared/action-cost-description.ts` serves existing options and complete route previews. Route labels materialize X and include shared mandatory extras. An impossible route displays Unavailable with its reason without blocking a valid alternative. Selecting it still returns the normal announcement rejection and retains the prompt. No parser or payment/rules contracts changed.

ContextMenu and TargetSelector expose the existing `choosePayment` flag. It belongs to the current action draft; opening another menu starts with automatic payment. The flag applies to ordinary casts/activations, not unrelated land/mana options. ChoicePanel displays the range, source name, retained numbers and required mana; zero remains distinct from a blank input. Named generic bindings display their symbol, such as {X}, instead of the overflowing {Variable} label observed in the browser. Player target labels use You/Opponent while IDs and exact pointers remain intact.

`choiceAnswerDetails` provides the same compact number, selected count and allocation total to frontend sends and backend receipts. Engine decisions and applied-client choices report range or required total. Existing command/choice IDs, log switches, error channel and JSONL remain the owners; no new logging framework was introduced.

## Browser transcript

Two independent browser sessions used ordinary controls at localhost:3000, room `a1f2c0dc-5564-4596-b228-b1ae27b6b71e`:

1. A created, B joined, both chose Rock, and ordinary passes reached main. A drew Choice practice from the configured deck, played a land and produced one red mana.
2. A opened then cancelled the server number announcement. Life, mana, hand and graveyard stayed unchanged. A retried through the existing card menu with Choose mana payment checked. Entering 5 left Confirm disabled with the visible 0–4 range; entering 0 continued normally.
3. Both complete route costs were visible: base required one red mana and one discard; life required those same extras plus two life. A chose base, Opponent and the creature to discard. Payment showed one red mana required with zero allocated, while the hand/discard/mana/life remained unpaid. B showed waiting for the other player's choice.
4. Reloading A restored that same payment prompt and X=0. Underpayment kept Confirm disabled. Allocating red:1 and confirming committed the spell and discard once, spent mana once and left life unchanged. Payment trace `d7744064-2296-4c44-b5f1-658142996e3a` matched the backend and both clients. Ordinary passes resolved X=0, with the spell in the graveyard and both players still at 20 life.
5. Ordinary empty combat, postcombat/end and upkeep/draw passes handed the turn to B. B drew the same loaded consumer, played a land, produced red mana and cast with default automatic payment. X=2 displayed a base cost of two generic plus one red and one discard, while the life alternative displayed one red, two life and one discard.
6. B chose the life route, Opponent and the creature to discard. Resources stayed unpaid until confirmation; final discard confirmation committed all costs and the spell once, leaving B at 18 life with no mana. Commit trace `3d59eb54-9b3c-4756-881f-8629e922afb2` matched the backend and clients. Two ordinary passes resolved retained X=2, leaving both views at 18 life, no stack/prompt and five cards in each graveyard. No debug resolve/end-turn, fixture injection or private React callbacks were used.

## Regression evidence

Loaded-definition engine cases cover base X=0 and X=2, life X=3, invalid numeric answers retaining the prompt, exact target labels, unpaid discard/payment, JSON reconstruction, retained bindings and ordinary resolution. The actual-server cases use the configured first draw for both routes, cancel an unpaid announcement, reject invalid X, reconnect during payment, pay once and compare both clients' result; backend receipts are checked for chosen number and allocation total. Client cases cover range display, explicit-payment propagation, symbols, waiting ownership and compact diagnostics. Existing UI callback tests locate controls by meaning instead of fixed child offsets.

Initial tests reproduced missing loaded data/draws, invisible range, inaccessible explicit payment and missing diagnostic fields. Review reproduced a thrown invalid combined-route preview before its correction; the regression verifies a visible rejection followed by a usable alternative.

Final gates: 1054 tests in 80 files passed, including 41 actual-server scenarios. Both server/client typechecks and the production build passed. Final independent read-only review found no critical or important issues. Two older socket scenarios timed out in an earlier concurrent run; the final full run passed without changing their timeouts or behavior. Local document links and diff checks passed.

After restarting the latest built backend and loading the latest client, a fresh two-session smoke used room `2f83271a-3734-443b-aaa6-7e4f759c54d0`. A drew the loaded consumer normally, chose X=2 and the life route with manual payment, selected the opponent/discard, reloaded while still unpaid and restored the prompt. Final red:1 allocation committed life, discard, mana and stack once; ordinary passes resolved X=2, leaving both players at 18 life, no pending prompt and an empty stack. Backend receipt logged `number:2`, selected counts and `allocationTotal:1`; engine diagnostics logged range 0–4 and payment total one. Payment command `a9708bb8-5ed5-4b25-8b54-0a64615aceb3` matched the frontend send, backend receipt/acceptance/publication and both clients' applied result. The fresh local views remain open for inspection.
