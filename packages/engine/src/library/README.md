# Authoring cards: contract version 1

Each `cards/<group>/<id>.json` contains one strict JSON card object. Add it to the explicit manifest in `cards/index.ts`. The manifest key and `id` must agree. Stable IDs identify cards in decks; names and rules text are display data. Current catalog: 94 definitions.

Start with [the validated examples](card_data.example.jsonc). That reference uses a map of example IDs; save only the inner card object in an active card file. It is documentation, not a playable catalog.

## Loading and validation

`cards/*.json → parseCardDefinition → validated/compiled blueprint → frozen catalog cache → mutable match instance`.

Every card requires `schemaVersion: 1` and a nonempty `id`. The shared public boundary is `@card-game/engine/rules/parse`; it also exports `parseAbilityDefinition`, `parseInstructionDefinition`, `parseModifierDefinition` and `parseManaCost`. All operations have strict parameter schemas. Unknown fields, unknown operations and unsupported combinations fail rather than being discarded. Definitions must be acyclic, within structural bounds, and use safe identifiers/paths. Display text does not execute.

Do not author UUIDs, zone revisions, owners/controllers, counters, damage or other match state. Catalog blueprints are deeply frozen; synthetic tests must replace a local blueprint rather than mutate the catalog. Rebuild and restart after changing content. Deck policy, server quotas and scenario setup belong to their own configuration.

```json
{
  "schemaVersion": 1,
  "id": "example-creature",
  "name": "Example creature",
  "manaCost": "{2}{R}",
  "cardTypes": ["Creature"],
  "subTypes": ["炎獸"],
  "power": 2,
  "toughness": 3,
  "abilities": []
}
```

## Card fields and timing

| Field | Meaning |
|---|---|
| `manaCost` | `{W}{U}{B}{R}{G}{Y}`, integer generic symbols, or declared `{X}`. Generic is a requirement, not a seventh resource. |
| `cardTypes`, `subTypes`, `superTypes` | Type arrays. Card types are schema-enumerated; a new subtype does not add mechanics. |
| `colors` | Optional actual colors; otherwise effective colors derive from mana requirements. |
| `power`, `toughness` | Finite printed numbers; dynamic values belong in characteristic rules. |
| `keywords` | Exact engine-consumed names; unfamiliar words do not create behavior. |
| `rulesText` | Display only. Label partially implemented printed behavior. |
| `castRequirements` | Zones (default hand), speed (default sorcery), cost, supported zone prerequisite, additional/alternative costs. |
| `onCastEffects` | Ordered spell-resolution instructions before structural movement; not announcement-time triggers. |
| `onEnterEffects` | Ordered self-entry shorthand, including entry by movement. Use a named trigger when an ID, filter or usage limit is needed. |
| `abilities` | Activated, triggered or static definitions, with unique IDs within the card. |
| `attachmentRequirements` | Host legality, checked on attachment and at state-based checkpoints. |
| `modes`, `modeCount` | Stable unique mode IDs and instruction lists, optional timing override. Base instructions precede selected modes. |
| `numericDeclarations` | Announced spell bindings, e.g. `{ "name": "X", "min": 0, "max": 4 }`. |

The former `onPlay` alias, flattened ability `effectId`/`params`, `mana: null`, ignored `globalFlag` and ignored ability-level `duration` are rejected. Effect operations own their supported duration; temporary stats are intrinsically end of turn. Ordinary loyalty costs are unsupported. Art/set/author metadata have no source fields yet and are rejected.

## Immediate instructions

Use `{ "family", "operation", "params", "targeting" }`. Omit params/targeting only when the operation/default permits it.

```json
{
  "family": "cards",
  "operation": "draw",
  "params": { "amount": 1 },
  "targeting": { "type": "self", "required": false }
}
```

| Family | Operations |
|---|---|
| `cards` | `draw`, `mill`, `discard`, `discard_random`, `discard_hand`, `move`, `shuffle`, `reorder_library`, `reveal_top`, `destroy`, `sacrifice`, `claim_revealed_source` |
| `resources` | `adjust_life`, `add_mana` |
| `damage` | `deal` |
| `orientation` | `tap`, `untap` |
| `counters` | `add`, `remove` |
| `stack` | `counter` |
| `attachments` | `attach` |
| `characteristics` | `temporary_stats`, `set_stats`, `create_effect`, `adjust_stats_and_damage` |
| `event-replacements` | `create_effect`, `regenerate` |
| `triggers` | `delay` |

These compile to live engine primitives such as `DRAW`, `MOVE_ZONE` and `CREATE_CONTINUOUS_EFFECT`. The structured spelling `{ "action": "DRAW", "params": { "amount": 1 } }` remains supported with identical operation-specific validation. These are active primitives, not abandoned implementations. Do not mix `action` with functional names.

Draw/discard/counter/damage amounts must evaluate to nonnegative integers. Mana generation requires a positive integer amount and exactly one of `color` or `colors`; the latter requests a choice. Zone moves specify `destination`, optionally `origin`; `libraryPlacement` applies only to a library destination. Capture and starter reveal windows support the configured work bound (currently one to sixty-four cards). Destroy, sacrifice and movement have distinct event semantics.

## Activated and triggered abilities

Each requires exactly one `effect` or a nonempty ordered `effects` list. Both use one parser and execution list. An ordered list belongs to one stack object; separate abilities create separate triggers. No flattened instruction fields belong on the ability.

Activated abilities declare cost, timing and optional `allowedZones` (battlefield by default; hand must be explicit). They support numeric declarations, additional/alternative costs and ordinary `usage` limits (`limitPerTurn` remains an old-data spelling). Costs support mana, tap/untap, life, discard, discardSelf, sacrifice and `removeCounters`; omit a cost or use `{}` for none. An alternative replaces the base cost; additional costs follow. Use `immediate` only for a supported immediate ability. Cost modifiers currently modify spells, not activations.

Triggered abilities require `triggerCondition`. Optional `trigger` filters subject/controller/type/subtype/condition; `interveningIf` is rechecked at resolution. `sharedPerEvent` combines the same controller's identical ability IDs for an event. `limitPerTurn` remains accepted for older definitions and shares the usage consumer. New activated/triggered abilities use `usage` with turn/game periods and shared groups; see [shared infrastructure](../../../../docs/shared-card-infrastructure.md).

```json
{
  "id": "attack-draw",
  "type": "triggered",
  "triggerCondition": "ON_ATTACK",
  "trigger": { "subject": "self" },
  "effect": { "family": "cards", "operation": "draw", "params": { "amount": 1 } }
}
```

### Explicit listener zones and snapshots

Use `trigger.listener: { "kind": "event_card", "state": "before", "zones": ["library"] }` for a card responding to its own mill. Use `{ "kind": "watcher", "activeZones": ["hand"] }` for an ability listening from hand, such as a life-loss response. These are strict, separate policies; source zones do not alter visibility or casting permissions. Event-card listeners allow only a self subject. All shipped triggers declare a listener. Older saved/test definitions without one use an admission adapter in the same pipeline. Conditions inspect the after-event room; a before-snapshot still supplies the listener's original characteristics. Required-target feasibility is checked before recording an occurrence or spending a use.

See [the listener contract and event windows](../../../../docs/trigger-listener-architecture.md) for complete JSON examples, retained reveal/death snapshots, shared usage and delayed-registration boundaries.

## Counter costs and optional paid branches

An activation pays counters in `cost`, before entering the stack:

```json
"cost": {
  "removeCounters": [{ "from": "source", "counterType": "charge", "amount": 5 }]
}
```

Use `from: "battlefield"` with an optional shared `filter` to split a literal total across eligible permanents you control. These are payments, not targets. Overlapping clauses share one inventory; other cost clauses and usage commit atomically.

For “you may pay …; if you do …” during resolution, use an ordinary instruction:

```json
{
  "family": "resources",
  "operation": "pay_cost",
  "params": {
    "cost": { "life": 2 },
    "then": [{ "family": "cards", "operation": "draw", "params": { "amount": 1 } }]
  }
}
```

`then` is a nonempty ordered instruction list. The chooser may decline or cancel before payment commits. After complete payment succeeds, the branch runs; later failure does not refund it. Branch targets must be self/all or use an explicit resolution `selection`/`search` choice. Ordinary announced targets hidden inside a paid branch are rejected. See the [payment architecture and examples](../../../../docs/counter-payment-architecture.md) for selection, replay and supported boundaries.

## Static modifier rules

Author `rules`, never numeric layers. Each rule has a stable `id`, functional `family`, scope, optional condition and family-specific operation. The compiler derives layers; optional `group` binds related operations. Static abilities are active on the battlefield by default; `activeZones` may enable another represented zone.

```json
{
  "id": "creature-discount",
  "type": "static",
  "rules": [{
    "id": "discount",
    "family": "costs",
    "action": "cast",
    "scope": { "controller": "self", "cardTypes": ["Creature"] },
    "operation": { "type": "mana.reduce", "color": "generic", "amount": 1 }
  }]
}
```

| Family | Operations / consumer |
|---|---|
| `characteristics` | `COPY`, `CONTROL`, `TEXT`, `TYPE`, `COLOR`, `ABILITY`, `SET_STATS`, `STAT_DELTA`, `SWITCH_STATS`, `MILL_AMOUNT`; characteristic layers and numbered mill. |
| `permissions` | `PERMISSION` for cast/activation prohibition or instant timing. Hexproof follows effective keywords and target legality. |
| `costs` | Cast-only `mana.set_base`, `mana.waive_base`, `mana.increase`, `mana.reduce`; shared announcement/preview/payment pricing. |
| `event-replacements` | Explicit event kinds and prevention/scaling/redirection/destination/cancellation/regeneration; proposed-event transaction. |

Characteristic/permission/cost scopes use shared card filters plus zones/self/attachment relations. Replacement scopes explicitly select a card (`{ "type": "card", "filter": {...} }`) or player (`{ "type": "player", "relation": "self" }`). A prevention rule can filter `counter: { "type": "Aurora", "min": 1 }` and stays live only while its source ability applies. Prevention does not reduce unpreventable damage.

Cost order: base setters/waivers, additional costs, increases, then reductions floored at zero. `mana.waive_base` preserves non-mana and additional costs. Generic reductions preserve colored requirements.

Cost/event rules may specify `usage`: period `turn` or `game`, positive limit, identity `source_card`, `source_incarnation` or `controller`, and consumption `on_commit` for costs / `on_change` for replacements. Controller identity shares a limit across copies of the same blueprint/ability/rule for that controller. Source-card identity survives zone changes; source-incarnation resets on reentry. Previews and failed/cancelled casts consume nothing. Eligible committed casts consume cost-rule usage even for a numerical no-op. Unchanged replacement events consume nothing.

## Shared filters, conditions and numbers

One CardFilter serves targeting, search, scopes, counts and action-zone checks: IDs, types/subtypes/colors, names, owner/controller, stat/mana-value bounds, counters, `tapped`, summon provenance and nested `allOf`/`anyOf`/`not`. Zones belong to the wrapper. Exact targets also retain zone revisions and visibility/permission checks; searching a zone does not inherit hexproof.

Conditions support `all`, `any`, `not`, and comparisons `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `includes`. `{ "path": "controller.life" }` reads a safe contextual field. Static rules expose source/target/controller/room/history, cost rules additionally actorId, replacement rules additionally event. Rules cannot read an unavailable event or announced binding they do not own. Room exposes phase, turnNumber and activeTurnPlayerId. Missing fields are not implicitly zero.

Numeric values accept literals or `{ "numeric": { ... } }` expressions. Shared evaluation supports bindings, fields, registered queries and arithmetic, with declaration/ownership validation. The reference demonstrates announced X, power queries and bounded counts. For example a persistent graveyard bonus can use `{ "numeric": { "kind": "query", "id": "count", "args": { "scope": { "zones": ["graveyard"], "cardTypes": ["Creature"], "controller": "self" } } } }`.

Use `{ "numeric": { "kind": "round_down", "value": 5, "multiple": 2 } }` for an explicit round down. The multiple is a positive safe integer, and the operand can be another numeric expression. Arithmetic in other rules keeps its existing precision.

`cards/discard_random` picks distinct positions in each recipient's current hand at resolution, up to the number available. It uses the injected [random helpers](../shared/random.ts) shared by opening decks, effects and seeded scenario shuffles. The live room supplies server entropy, and Test Lab can inject a seed. The chosen card references enter the ordinary movement plan, so a replacement decision resumes the same selection. The player projection exposes only permitted outcomes.

Static counts read the intermediate board at their layer, avoiding recursive final-characteristic lookup. Existing `{ "count": scope, "multiply": 2, "add": 1 }` characteristic values and `DYNAMIC:source.power` / `DYNAMIC:event.…` markers remain supported live vocabulary. Prefer shared numeric expressions for new definitions.

Choices support optional, discard, options, ordering, search, selection and distribution. `targetGroup` shares a target; `recordOutcome` / `requiresOutcome` condition later instructions on actual destruction/discard. The reference includes choices, copies, grants, lifetimes, attachments, Scorch, delayed triggers and compound effects.

Mill instructions can capture `recordResult: { "name": "milled", "kind": "milled" }`. Later search choices and numeric scopes can use `from: { "kind": "result", "name": "milled" }` with the same filters. Default `current` view selects exact arrival incarnations still present; numeric `view: "recorded"` uses historical arrival characteristics. Cards move into their real zones before the next instruction. Sets survive paused choices and expire after the whole spell/ability resolves. Instruction `condition` supports conditional follow-ups using these queries. See [the full result-set contract](../../../../docs/resolution-results-architecture.md) and `example-mill-result` for syntax and replacement/identity details.

See [rule-contract architecture and blocker assessment](../../../../docs/rule-contract-architecture.md) for ownership, migration evidence, legacy review and remaining mechanics.


## Captured windows and visibility

Cards have base `visibility` state: battlefield/graveyard/exile/stack public, hand owner-only, library hidden. Actual zone transitions reset this state. Temporary look/reveal access is a resolution-owned observation, not a sticky override on a live card.

Use `cards / capture_window` with `params: { zone: "library", zonePlayer: "self", position: "top", amount: 6 }` and `recordResult: { name: "window", kind: "captured" }`. Omitted visibility grants nothing. An explicit visibility object has `faces`, `count`, `order` audience arrays and `expires: "resolution_end"`; roles are `controller`, `opponent`, `zone_owner`, `all_players`. Face audiences must receive counts; order audiences must receive faces. `event: "revealed"` requires explicit public faces, while omitted/`none` does not trigger revelation.

Search/numeric scopes reuse `from: { kind: "result", name: "window" }`. `cards / set_collection_visibility` takes `from`, optional shared `filter`, a visibility policy and optional event. Captured choices require current face access. `cards / mill` also accepts `params: { from: { kind: "result", name: "window" } }` to mill the exact current remainder, with optional `filter`/`amount`; normal mill replacements and result accounting still apply.

See the [full schema, examples and projection/lifecycle contract](../../../../docs/card-window-design.md). Distinct-name selection, same-zone selected-card exclusion, conditional repetition and cross-owner destinations remain unsupported rather than being approximated.

## Named tokens

Token templates in `library/tokens/` use this same card schema and normal abilities. The factory marks their instances with `isToken`; disappearance is intrinsic rather than an authored on-death exile instruction. Templates stay out of ordinary deck catalog enumeration.

```json
{
  "family": "cards",
  "operation": "create_token",
  "params": { "tokenId": "token-angel-1-1", "amount": 1 }
}
```

Recipients use self/player targeting. Amount defaults to one and supports the existing numeric-expression contract, bounded by `config/tokens.json`; unknown token IDs, inline card definitions, destination overrides and non-player recipients are rejected. Tokens enter directly through normal battlefield-entry events and may have ordinary entry/death abilities. They never occupy a nonboard zone: settled graveyard-bound creature departures still count as death, while bounce/exile departures do not. See the [full token lifecycle guide](../../../../docs/token-architecture.md).

## Effective costs and causal outcomes

A characteristic rule with `operation: { type: "MANA_COST", mana: {} }` makes all effective cost/value queries see zero while its zone/condition applies. Preserve the printed blueprint; payment-only adjustments remain in the costs family.

Ordinary abilities accept `usage: { period: "game", limit: 1, identity: "source_card", consume: "on_commit" }`. Optional `group` shares a budget across abilities/rules; trigger enqueue consumes its use even if later countered.

Instructions may declare `onKill: { destination: "exile" }` and `recordOutcome: { name: "kill", kind: "killed" }`; a follow-up can use `requiresOutcome: "kill"`. This captures actual attributed lethal/destroy departures with replacement-safe direct exile. `ON_KILL` with `trigger.cause` selects self/controller/any causal sources. `ON_DIE` still means an actual graveyard departure. See the [contract/history guide](../../../../docs/shared-card-infrastructure.md) for timing, receipts and the open broad credit ruling.
