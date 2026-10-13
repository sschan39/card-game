# V3 — Existing choices as a playable consumer

Status: proposed; follows V2. Baseline `8798da1`, 13 October 2026. [Vertical plan](README.md). Engine contracts: [numeric bindings](../8.4-announcement-bindings.md), [payment routes](../8.4-cost-routes.md), [pending choices](../3.5-pending-choices.md).

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
