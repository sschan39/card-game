# Counter costs and optional payment branches

Implemented on 4 November 2026, extending the shared action-cost planner. This is the follow-up to [effective costs, usage and source history](shared-card-infrastructure.md). The [current blocker ledger](card-blockers-current.md) records what remains.

## Readable authoring

An ability's `cost` is paid before it enters the stack. Removing counters belongs here, rather than inside its resolving instructions:

```json
{
  "id": "charged-destruction",
  "type": "activated",
  "castSpeed": "instant",
  "cost": {
    "removeCounters": [
      { "from": "source", "counterType": "charge", "amount": 5 }
    ]
  },
  "effect": {
    "family": "cards",
    "operation": "destroy",
    "params": {},
    "targeting": {
      "type": "permanent",
      "controller": "opponent",
      "cardTypes": ["Creature"],
      "tapped": true,
      "required": true,
      "minTargets": 1,
      "maxTargets": 1
    }
  }
}
```

For counters spread across your battlefield, use a shared filter:

```json
"cost": {
  "removeCounters": [{
    "from": "battlefield",
    "filter": { "cardTypes": ["Creature"], "subTypes": ["冰龍"] },
    "counterType": "charge",
    "amount": 4
  }]
}
```

The player can split that total across eligible permanents they control. `source` means the exact source incarnation, including its zone revision. `battlefield` means current controlled permanents satisfying the filter. `attached_host` automatically selects the source’s current controlled host and checks both incarnations. Payment selection does not target, so targeting-only protection does not prevent paying counters. No option can take an opponent's counters.

The parser and planner share `validCounterRemoval`. Unknown fields, unsupported origins, source filters, unsafe counter names and nonpositive/fractional amounts fail. A cost has at most sixteen counter clauses. Amounts are positive safe-integer literals; computed counter amounts are not part of this delivery. Base and additional costs concatenate clauses and share one inventory.

## An optional payment during resolution

For “you may pay X; if you do, Y,” use the same cost vocabulary inside `resources / pay_cost`:

```json
{
  "family": "resources",
  "operation": "pay_cost",
  "params": {
    "prompt": "Pay two life to draw a card?",
    "cost": { "life": 2 },
    "then": [{
      "family": "cards",
      "operation": "draw",
      "params": { "amount": 1 }
    }]
  }
}
```

`then` contains one to thirty-two ordinary instructions. It uses the existing compiler and numeric validation. The normal instruction `condition` can gate the offer, and nested payment branches are supported. A paid branch must use self/all instructions or explicit resolution `selection`/`search` choices. Announced targets buried inside the branch are rejected because they do not belong to the original announcement's target groups.

The optional branch is not paid when a trigger is enqueued. At resolution, the player chooses Pay or Decline, then makes any required payment selections. The complete payment is validated before any part commits. Decline or cancellation before commitment skips `then`; it does not undo earlier instructions on the same stack object. After commitment, the branch runs normally and may pause for an ordinary card selection. A later fizzle or unavailable follow-up does not refund the payment. Card definitions must declare their intended prerequisites; Aralaria, for example, only offers its payment when an eligible hand card exists.

## One payment path

| Owner | Responsibility |
|---|---|
| `types/counter-cost.types.ts`, `shared/counter-cost-validation.ts` | Strict counter clauses and explicit card/revision/amount selections |
| `engine/counter-costs.ts` | Current ownership/filter checks, shared inventory, selection validation and exact counter debits |
| `engine/payment-flow.ts` | Small integer flow solver for overlapping clauses |
| `engine/action-costs.ts` | Existing transaction planner combines counters with mana, life, orientation, discard and sacrifice |
| `engine/action-choices.ts` | Existing announcement, target and payment choices; retains the announced counter-cost definition |
| `engine/resolution-payments.ts` | Pay/Decline decision, payment continuation, and expansion of the successful branch |
| `engine/resolution-mana.ts` | Reuses ordinary mana abilities and their payment choices while resolution is paused |
| Server `projection/choice-view.ts` | Existing chooser-only views, opaque handles and cancellation affordance |

The inventory solver matters when clauses overlap. Suppose one clause accepts any creature and another accepts only an ice dragon: it must not spend the sole dragon on the broad clause if another creature can pay that clause. All clauses are solved together; a physical counter is never counted twice. Explicit player selections reserve inventory first, and every subsequent selection is checked against the remainder.

Choices retain server-owned card references `{ cardUuid, zoneRevision }` and amounts. The player-facing view contains opaque option handles, labels and available counts. Only the chooser receives the choices; opponents receive the ordinary waiting view. Forged, duplicate, stale, foreign and wrong-total allocations fail without payment.

For action-time costs, payment and usage commit before the ability enters the stack. Countering the ability later retains the payment. Counter removal is an exact cost debit: counter-change replacement effects cannot waive or scale it. A committed debit still publishes the ordinary counter-change event, retaining source/ability provenance; removing counters does not masquerade as placing them.

During optional resolution payment, selected mana abilities are previewed in order. Their existing discard/counter choices are reused, and the parent cost is checked against the resulting inventory. Actual room priority remains parked; the temporary planning view does not grant the player a response window. The final transaction revalidates and replays the selected abilities once. Cancelling a later payment choice commits none of those previews. Choices and continuations contain serializable data, so reconstruction does not silently pay twice.

Mana discovery is a bounded list of existing supported abilities, not an exhaustive solver for arbitrary future enabling chains. A listed source may still require player choices or further mana sources. Every completed payment is revalidated; an unfinishable selection can be cancelled without spending resources.

## Production consumers and remaining limits

- **幻影女王 赫拉 (`phantom-queen-hera`):** land mana, friendly puppet entry charges, and a once-per-turn instant activation paying five source counters to destroy a tapped opposing creature. Targets are chosen before payment commits.
- **天使皇 亞拉里亞 (`angel-emperor-aralaria`):** land mana, healing charges, and optional five-counter payment after positive charge placement reaches five; then one mandatory hand selection deploys an 上使 creature. Negative counter changes do not recursively trigger the command.

These clear two complete cards and the generic counter-cost dependencies of four others. 冰龍魔杖 still needs the staff/host wording ruling; 極光龍宮 needs its Aurora contract and summon origin; 寒巢之主 needs battle duration; 蒼海帝 needs cross-owner drawing and color-conversion permission. Optional ordinary payment also clears payment clauses on cards still missing draw-step, reveal provenance or result-card value support.

Selected exile and binding/storage are still unsupported costs. No off-zone trigger discovery, Aurora lifecycle, combat lifetime or broad multi-source kill-credit ruling is supplied by this payment work. Captured reveal workflows are now the largest separate blocker, affecting thirteen missing rows.

## Verification

Focused logic verification covers payment inventory, atomicity, replacements, usage, cancellation, mana-source choices, reconstruction, production cards, projections and the related parser/cost/trigger/result/history boundaries. Architecture and readability gates pass without raising their budgets. All workspace typechecks pass. The original catalog/preset preservation check passes. No browser smoke test, long socket scenario or full suite is run.

**272 distinct selected checks passed across 17 files**, counting the preservation check and the latest result for each repeated file. The other fifteen configuration tests were deliberately not run. Existing card definitions and all pre-extraction presets retain their baseline hashes.

## Ritual materials

An action cost can declare `destroyMaterials` with a shared card `filter` and a strict `manaValueGreaterThan` threshold. The player selects one or more controlled battlefield cards. The picker shows a running total. The server verifies distinct object references, control, current characteristics and combined effective mana value against the threshold before proposing payment.

Material destruction uses the normal destruction and replacement transaction. The transaction pays only if every selected material is destroyed. A cancellation, regeneration or a replacement that sends a material elsewhere aborts the entire payment, including any other material destruction or costs. An optional replacement may pause payment for its usual decision.

蒼海王子 and 深淵巨人 declare this cost on a sorcery-speed hand ability. Its movement uses ordinary special entry, which enables the printed special-summon triggers. Each card also keeps its printed mana cast. Material selection currently applies to announced actions.
