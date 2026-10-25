# Writing cards in `card_data.json`

This describes the **input accepted by the current loader**, not a future card schema. Start with the [commented examples](card_data.example.jsonc). That file is documentation only: it is not imported, added to decks, or loaded as cards.

`card_data.json` is strict JSON: double quotes, no comments, no trailing commas. Put explanations here or in the `.jsonc` example file. Do not add a top-level `_comment` or `$schema` entry: the catalog is a map of card IDs to card definitions, not a metadata wrapper.

## 1. Smallest useful card

```json
{
  "my-creature": {
    "id": "my-creature",
    "name": "My creature",
    "manaCost": "{R}",
    "cardTypes": ["Creature"],
    "subTypes": ["炎獸"],
    "colors": ["red"],
    "power": 2,
    "toughness": 3,
    "rulesText": "",
    "abilities": []
  }
}
```

Keep the outer key and inner `id` identical. Decks refer to the outer key; the blueprint's identity is its `id`. A card name can change without changing its ID. Ability IDs must be nonempty and unique **within that card**; mode IDs must be unique within their mode list.

The flow is `card_data.json → normalizeCard → cached blueprint → match instance`. Do not author `uuid`, `state`, owner/controller IDs, damage, counters currently on a card, chosen targets, or zone revisions here. The game creates those. Restart the server after changing the catalog because blueprints are cached.

`rulesText` is display text. It does not execute instructions. A printed ability needs an authored effect/ability below. Use `\n` for a newline and add an explicit `【未支援：…】` note when only part of a real card is implemented.

## 2. Card fields

The loader explicitly requires `id`. For a usable card, also supply a name and meaningful types, stats where applicable, and its implemented behavior. Defaults below describe loading behavior, not a recommendation to omit everything.

| Field | JSON shape | Omitted/default behavior |
|---|---|---|
| `id` | Nonempty stable string | Required; missing ID throws. Keep equal to the catalog key. |
| `name` | String | `""`. Chinese names are valid. |
| `manaCost` | Symbol string, e.g. `"{2}{R}"` | `""` means no mana requirement. Parsed into `castRequirements.cost.mana`. |
| `cardTypes` | Array of strings | `[]`. Ordinary supported permanent types: `Creature`, `Artifact`, `Enchantment`, `Land`; `Spell` is a nonpermanent spell. Types are case sensitive. An arbitrary type string does not create new rules. |
| `subTypes` | Array of strings, e.g. `["炎獸"]` | `[]`. Match spelling/case exactly in filters. |
| `colors` | Array of `white`, `blue`, `black`, `red`, `green`, `yellow` | Effective colors derive from colored mana requirements when omitted. Supply explicitly for a colored card with a generic cost, or the workbook's colored lands. |
| `power`, `toughness` | Numbers | Missing values resolve as zero; supply both for a Creature. These printed fields do not accept numeric-expression objects. |
| `keywords` | Array of strings | `[]`. Only existing keyword consumers do anything; arbitrary words are not new mechanics. Some combat consumers require exact spelling, e.g. `Flying`, `Trample`. |
| `rulesText` | String | `""`; display only. |
| `castRequirements` | Object, section 3 | Hand only, sorcery timing, no nonmana costs. |
| `onCastEffects` | Ordered array of effect objects, section 4 | `[]`. Instructions run when the spell **resolves**, before its structural move to battlefield/graveyard. They are not cast-time triggers. |
| `onPlay` | Same as `onCastEffects` | Legacy alias; prefer `onCastEffects`. If both exist, `onCastEffects` wins, including an empty array. |
| `onEnterEffects` | Ordered array of effect objects | Legacy self-entry trigger list. Prefer a named `ON_ENTER_BATTLEFIELD` ability for a simple effect. This legacy entry list can contain multiple effects, but is not a general multi-effect attack/death trigger field. |
| `abilities` | Array of activated, triggered or static definitions, sections 5–7 | `[]`. A Land with no abilities currently receives an implicit tap-for-yellow fallback; author an explicit mana ability for real lands. |
| `modes` | Array of `{ "id", "label", "effects": [...] }` | No modal choice. IDs are stable strings; `effects` use ordinary effect objects. |
| `modeCount` | `{ "min": 1, "max": 1 }` | Choose exactly one mode when modes exist. Base effects run first, then selected modes in selection order. A mode may override timing with `castSpeed`; omit it to inherit the action speed. |
| `numericDeclarations` | Array of `{ "name": "X", "min": 0, "max": 4 }` | No announced variables. `max` may be omitted; names must be unique, nonempty safe keys. See section 8. |

`attachmentRequirements` is a targeting definition copied into resolved characteristics. Equipment checks it when attaching and at state-based checkpoints. `ATTACH` attaches its equipment source to one selected creature, retaining both exact battlefield incarnations. Declare its timing/cost on the activated ability. Static effects with `scope: { "attachedToSource": true }` affect only that source's current host. `worlds-flameblade` demonstrates a free sorcery activation and grants +2 attack plus one ordered draw/damage attack trigger; it enters unattached.

**Not catalog inputs today:** `superTypes` exists on runtime types, but `normalizeCard` does not copy it from this JSON. Likewise, art URL, illustration, set, rarity, collector number, flavor text and author notes have no loaded fields yet. Unknown top-level fields are discarded; do not assume that being valid JSON or appearing in a TypeScript interface makes a field functional.

## 3. Costs and casting requirements

### Mana spelling

Exactly six game colors are defined in `elementColors` in [central config](../config.ts):

| Element | JSON resource/color | Cost symbol |
|---|---|---|
| 炎 | `red` | `{R}` |
| 魔 | `black` | `{B}` |
| 風 (workbook alias 木) | `green` | `{G}` |
| 雷 | `yellow` | `{Y}` |
| 雪 (workbook alias 寒) | `white` | `{W}` |
| 海 | `blue` | `{U}` |

`無` is a generic requirement, **not** another color. The old `colorless` resource and `{C}` symbol have been replaced by yellow/`{Y}`; old room snapshots are not migrated. Restart the server and create new rooms after this change. “Colorless” as a protection quality still means a card with no effective colors, not a resource pool entry. 海 is supported as blue. The earlier 海 authoring deferral was lifted after confirming the six-color mapping; cards still need all their printed mechanics to be supported.

| Input | Meaning |
|---|---|
| `"{W}{U}{B}{R}{G}"` | One white, blue, black, red and green requirement. |
| `"{3}"` | Any three energy: **generic**, including the workbook's `3無`. |
| `"{Y}"` | Specifically one yellow energy. Different from generic. |
| `"{2}{R}{R}"` | Any two plus two red. |
| `""` or `"{0}"` | No mana to pay. |
| `"{X}{R}"` | Announced generic X plus one red; requires a card-level declaration named `X`. |

Only uppercase `W U B R G Y X` and whole-number symbols are parsed. `"2炎"`, `"R"`, hybrid symbols and arbitrary text are not supported. A nonempty parsed symbol cost overrides `castRequirements.cost.mana`; omit `manaCost` when deliberately authoring the mana object there instead. Do not provide two competing mana costs.

```json
{
  "speed": "instant",
  "allowedZones": ["hand"],
  "cost": { "life": 2, "discard": 1 },
  "alternativeCosts": [
    { "id": "pay-life", "label": "Pay 3 life instead", "cost": { "life": 3 } }
  ],
  "additionalCost": { "mana": { "red": 1 } }
}
```

This is a `castRequirements` object, not a whole card. The chosen alternative **replaces the entire base cost**, including base nonmana costs. `additionalCost` is then added to either the base or alternative route. Nonmana costs and mana payment are costs paid before resolution, not effect instructions.

| Requirement field | Available values |
|---|---|
| `speed` | `sorcery` (default): own main phase, empty stack, priority. `instant`: ordinary priority windows. This does not bypass priority or create Chain rules. |
| `allowedZones` | Array of represented zones: `library`, `hand`, `battlefield`, `graveyard`, `exile`, `stack`. Default `["hand"]`. The ordinary cast command currently looks for its source in hand: listing another zone does **not** enable casting from there. This field also does not implement reveal permissions or cross-zone activation. |
| `cost` | The cost object below. |
| `alternativeCosts` | Array of `{ id, label, cost }`; distinct nonempty IDs and labels. |
| `additionalCost` | One cost object, always added to the selected route. |
| `condition` | Optional action gate: `{ "zoneCheck": { "zone": ["graveyard"], "ownedBy": "self", "cardType": "Creature", "minCount": 1 } }`. `cardType` and `cardId` are optional filters; count defaults to 1. Current zone checking examines hand, battlefield and graveyard only. `ownedBy` accepts `self`, `opponent`, `any`; on the battlefield it uses effective control. |

`condition.globalFlag` is a placeholder in the validator and does **not** enforce a condition. Do not use it to implement a rule. This action gate is also distinct from trigger `condition`/`interveningIf` below.

| Cost field | Shape and meaning |
|---|---|
| `mana` | Object with nonnegative integer `white`, `blue`, `black`, `red`, `green`, `yellow`, `generic` amounts. Only `generic` can instead use an announced numeric expression. Omit absent colors. |
| `tap` | Boolean; tap the source. Creature tap costs obey summoning sickness. |
| `untap` | Boolean; untap the source. Cannot combine a true tap and untap cost. |
| `life` | Nonnegative integer life payment. |
| `discard` | Nonnegative integer count of other hand cards to discard, selected through payment. This is not “discard this source from hand.” |
| `discardSelf` | Boolean; discard this activating source from its owner's hand as a cost. Requires an admitted hand source; it is paid once before resolution and is not refunded if the ability is countered. |
| `sacrifice` | Boolean; sacrifice the source, not a freely selected other permanent. |

Use omitted fields or `{}` for no cost. Existing catalog entries use `mana: null` as a legacy empty value; prefer `{}` or omit it. `loyalty` exists on a runtime cost type but is not supported by ordinary cost composition; do not author a loyalty ability here.

## 4. Effects and targeting

```json
{
  "action": "MODIFY_STATS",
  "params": { "damage": 2 },
  "tags": ["damage"],
  "targeting": {
    "type": "permanent", "controller": "opponent", "cardTypes": ["Creature"],
    "required": true, "minTargets": 1, "maxTargets": 1
  }
}
```

This deals two damage to one opposing Creature. Damage is **not** a toughness reduction. For player damage use `MODIFY_LIFE`, a **negative** `amount`, and `tags: ["damage"]`. Negative life modification without the damage tag is life loss without a damage event; positive amounts gain life.

An effect object accepts exactly these supported input fields:

| Field | Meaning |
|---|---|
| `action` | Case-sensitive registered action ID, e.g. `DRAW`. The loader does not uppercase this field. |
| `params` | Parameter object for that action; use `{}` if no parameters. |
| `targeting` | Definition below. Defaults to `{ "type": "self", "required": false }`. |
| `tags` | String array; defaults `[]`. `damage` has gameplay meaning for negative player life modification. Tags are not arbitrary executable mechanics. |
| `targetGroup` | Optional string. Effects with the same explicit group share chosen targets and must have identical targeting definitions. Otherwise each explicit-target effect gets its own group. |
| `choice` | Optional choice object; section 6. |

### Target definition fields

| Field | Values / behavior |
|---|---|
| `type` | `self`, `player`, `permanent`, `card`, `spell`, `stack`, `any`. `self` normally supplies the controller automatically; `permanent` means battlefield; `card` can use `zones`; `spell` means a spell stack object; `stack` can also address abilities. Authored `any` admits players and battlefield cards matching its card filters; `cardTypes: ["Creature"]` therefore admits players or Creatures. Runtime `zone` is not an authored target type. |
| `required` | Boolean. For explicit targets it contributes a default minimum of 1 if true, 0 if false. Use explicit bounds. **False does not mean “may perform this effect”; use `choice.kind: "optional"`.** |
| `minTargets`, `maxTargets` | Fixed integer bounds for chosen targets; max defaults to 1. Not X-expression fields. |
| `controller` | `self`, `opponent`, `any`; omitted means unrestricted. Relative to the action/ability controller. |
| `cardTypes`, `subTypes` | String arrays. Values within an array are OR; different filters combine with AND. `["Artifact", "Land"]` means Artifact **or** Land. |
| `zones` | Zone array for `type: "card"`; defaults to battlefield. It does not make `permanent` reach another zone. |
| `power`, `toughness` | Optional `{ "min": number, "max": number }`, either bound can be omitted. Used for explicit targets. |
| `counter` | `{ "type": "scorch", "max": 0 }` admits zero current Scorch; `min` and `max` are optional fixed bounds. An absent counter is zero. |
| `extrema` | `{ "field": "remainingHealth", "order": "min" }` restricts matching battlefield candidates to current resolved maximum health minus marked damage; the controller chooses among ties. Rechecked on resolution. |
| `summonKind` | `"effect"` admits effect-summoned permanents; `"cast"` admits ordinary or immediate casts. Provenance resets on departure. |
| `stackTypes` | Array of `spell`, `activated`, `triggered`; filters a spell/stack target. |
| `subject` | With `type: "self"`: `controller` (default) or `source`. Use `source` for buffing the originating permanent, not for healing its player. |
| `all` | Boolean. `true` selects matching recipients at resolution without explicit target selection. Current expansion handles players or battlefield permanents and applies the shared supported card filters. It does not expand library/hand zones or stack objects. |

Explicit targets are chosen before stacking and checked again at resolution, including zone incarnation. A returned card with the same UUID is not automatically the original target. No targets can be invented from text such as “the card that died”; that needs an existing effect/selection contract.

### Registered actions and parameters

These are the current action IDs, not promises that every combination of parameters and targets is meaningful. For `DRAW`, `ADD_MANA` and `DISCARD_HAND`, the handler acts on the **ability/spell controller**, regardless of a different target definition; author them as self effects.

| `action` | `params` | Effect / recipient |
|---|---|---|
| `MODIFY_LIFE` | `{ "amount": 2 }` | Change targeted players' life; negative + `damage` tag deals damage. |
| `MODIFY_STATS` | `{ "damage": 2 }` and/or `power`, `toughness` | Damage battlefield permanents and/or modify P/T until end of turn. Damage uses a positive amount. |
| `DEAL_DAMAGE` | `{ "amount": 3 }` | One ordinary damage hit per selected player/Creature recipient. Supports `type: "any"` with `cardTypes: ["Creature"]` to offer both in one target group, as the Emperor does. Uses normal damage keywords, prevention and replacements. |
| `DRAW` | `{ "amount": 1 }` | Controller draws. |
| `ADD_MANA` | `{ "color": "red", "amount": 1 }` | Controller adds one of the six actual mana colors; `generic` is not a produced color. |
| `DESTROY` | `{}` | Destroy battlefield recipients through the destruction pipeline. |
| `SACRIFICE` | `{}` | Sacrifice selected battlefield recipients. |
| `TAP`, `UNTAP` | `{}` | Tap/untap battlefield recipients. |
| `ADD_COUNTER`, `REMOVE_COUNTER` | `{ "counterType": "+1/+1", "amount": 1 }` | Modify named counters on battlefield recipients. An arbitrary counter name does not add a threshold/destruction rule. |
| `COUNTER` | `{}` | Counter a targeted spell or ability stack object. |
| `MOVE_ZONE` | `{ "destination": "hand", "origin": "graveyard" }` | Move selected cards. `origin` is optional; `libraryPlacement: "top"` or `"bottom"` is available only with destination `library`. Moving an existing library occupant in place uses the separate reorder action. |
| `SHUFFLE` | `{}` | Shuffle selected players' libraries. |
| `REORDER_LIBRARY` | `{ "placement": "top" }` or `"bottom"` | Reorder selected cards already in the same library; selection order is top-to-bottom. Does not reveal or limit selection to the top N. |
| `DISCARD_HAND` | `{}` | Controller discards the entire hand; legacy action retained. |
| `DISCARD_FROM_HAND` | `{ "amount": 2 }` plus `choice:{ "kind":"discard" }` | One affected player chooses exactly min(amount, available hand). Selected cards leave with a discard cause. Empty hand requires no prompt. |
| `DISCARD_FROM_LIBRARY` | `{ "amount": 2 }` | Discard the top available cards of the player recipients, up to amount. No choice, reveal, shuffle or failed draw. |
| `GRANT_STATS` | `{ "power": 1, "toughness": 1 }` | P/T modifier until end of turn; one recipient or current `all` recipients. |
| `SET_STATS` | `{ "power": 3, "toughness": 3, "duration": "END_OF_TURN" }` | Set base P/T; duration defaults to `PERMANENT`. Also accepts optional `requiredZone` for source lifetime. |
| `CREATE_CONTINUOUS_EFFECT` | `{ "effect": { "type": "STAT_DELTA", "power": 1 }, "duration": "END_OF_TURN" }` | Apply an operation from section 7. Optional `requiredZone` restricts the source's zone. |
| `REGENERATE` | `{}` | Create a one-use regeneration shield for this turn on recipients. |
| `CREATE_REPLACEMENT_EFFECT` | `{ "definition": { "label": "Shield", "operation": { "type": "prevent_damage", "amount": 2 }, "duration": "end_of_turn", "remaining": 2 } }` | Register a replacement/shield; see advanced shape below. |
| `CREATE_DELAYED_TRIGGER` | `{ "ability": normalizedTriggeredAbility, "lifetime": "once" }` | Register a delayed trigger. Lifetimes: `once` (default), `end_of_turn`, `permanent`. Nested `ability` is a **normalized** ability with a single `effect: { action, params, targeting }` or ordered `effects`, not the catalog's flattened `effectId` spelling. |

Multiple spell effects run in list order on one spell stack object. Separate triggered abilities produce separate trigger objects; they are not a way to implement a compound instruction on one trigger. Activated and triggered abilities can each use a single flattened base effect or a nonempty `effects` array of ordinary `{action, params, targeting, tags?, choice?}` instructions. Do not mix that array with ability-level `effectId`, `params`, `targeting`, `tags` or `choice`. Static abilities use `effects`; modes contain effect lists; legacy self-entry uses the card's `onEnterEffects` list.

## 5. Activated and triggered abilities

```json
{
  "id": "tap-red",
  "type": "activated",
  "cost": { "tap": true },
  "effectId": "ADD_MANA",
  "params": { "color": "red", "amount": 1 },
  "targeting": { "type": "self", "required": false }
}
```

**Important spelling:** single-effect raw abilities use `effectId`, `params`, `tags`, `targeting`, `choice` at ability level. Raw spell effects use `action`. The loader converts an ability's `effectId` to uppercase and constructs its runtime `effect`. A raw ability with only `action` or nested `effect` does not work as intended. Static abilities use the separate format in section 7.

| Ability field | Activated | Triggered |
|---|---|---|
| `id`, `type` | Stable ID, `"activated"` | Stable ID, `"triggered"` |
| `effectId`, `params`, `tags`, `targeting`, `choice` | One effect, same meanings as section 4 | Legacy single-effect form; alternatively use `effects` below. |
| `effects` | Nonempty ordered instructions using `action`; do not also author the flattened single effect. | Nonempty ordered effect list, each with `action`. One trigger/stack object; no priority between its instructions. |
| `castSpeed` | `instant` default or `sorcery`. Field is named differently from card casting's `speed`. | Copied by loader; does not turn a trigger into a manually cast action. |
| `cost` | Cost object from section 3; default no cost | Not an ordinary paid activation; do not use. |
| `alternativeCosts`, `additionalCost` | Same route rules as casting | Rejected by loader. |
| `numericDeclarations` | Ability-local announced values; separate from card declarations | Rejected by loader. |
| `limitPerTurn` | Positive integer usage limit | Positive integer trigger usage limit. Not a nonstacking/once-across-all-copies rule. |
| `modes`, `modeCount` | Same shape as card modes | Same; chosen during trigger scheduling. |
| `duration` | Legacy field retained on the ability, but not a general effect lifetime switch. Use the action's supported `params.duration`; `GRANT_STATS` is always end of turn. | Not copied as a trigger lifetime field. |
| `allowedZones` | `["battlefield"]` by default; explicitly admit `["hand"]` for a hand ability. | Not a trigger-zone permission. |
| `immediate` | `true` bypasses the stack while retaining ordinary timing/payment/choices. | `true` executes its scheduled trigger without a stack response window. |
| `sharedPerEvent` | Not used | `true` groups this controller's copies with the same blueprint ID and ability ID for one event. |
| `triggerCondition` | Not used | Event name below; defaults to `ON_ENTER_BATTLEFIELD` if omitted. Always write it explicitly. |
| `trigger` | Not used | Filter object below. |
| `interveningIf` | Not used | Rule condition checked when triggered and again before resolution. |

Ordinary activated abilities default to battlefield. Explicit `allowedZones: ["hand"]` admits an owned hand source; see the starter examples below. An untargeted self `ADD_MANA` ability with the supported costs is recognized as a mana ability and resolves immediately, without a stack response window. Such mana abilities do not support numeric declarations or alternative/additional cost routes.

For a mana ability, `params` also accepts `{ "colors": ["red", "green"], "amount": 1 }` to offer a color choice; the amount defaults to 1. This is handled by the mana-activation path. Ordinary resolving `ADD_MANA` effects use the single `color` field shown in section 4.

### Trigger event names

| `triggerCondition` | Engine event / meaning |
|---|---|
| `ON_ENTER_BATTLEFIELD` | `PERMANENT_ENTERED`; entering the battlefield, including a noncreature permanent. |
| `ON_LEAVE_BATTLEFIELD` | `PERMANENT_LEFT`; any departure. |
| `ON_DIE` | `PERMANENT_DIED`; a Creature dies into the graveyard, including lethal damage or sacrifice. |
| `ON_DESTROY` | `PERMANENT_DESTROYED`; actual destruction into the graveyard, including a Scorch destruction. Indestructible, cancellation and exile replacement do not qualify. |
| `ON_REVEAL` | `CARD_REVEALED`; this bounded resolution has finished selection/Scorch and remainder return. |
| `ON_ATTACK` | `ATTACK_DECLARED`; attack declaration, not combat damage. |
| `ON_BLOCK` | `BLOCK_DECLARED`; block declaration. |
| `ON_DAMAGE_TAKEN` | `DAMAGE_TAKEN`; damage recipient event. |
| `ON_DAMAGE_DEALT` | `DAMAGE_DEALT`; damage source event. |
| `COMBAT_DAMAGE` | `COMBAT_DAMAGE_RESOLVED`; completed combat-damage pass, not an alias for a single source's damage. |
| `ON_DRAW`, `ON_SHUFFLE` | `CARD_DRAWN`, `LIBRARY_SHUFFLED`. |
| `ON_DISCARD_FROM_HAND` | `CARD_DISCARDED_FROM_HAND`; a discard-caused hand→graveyard outcome. |
| `ON_DISCARD_FROM_LIBRARY` | `CARD_DISCARDED_FROM_LIBRARY`; a discard-caused library→graveyard outcome. |
| `ON_COUNTER_CHANGED` | `COUNTER_CHANGED`; the actual signed change of one named counter on one card. `controller` matches the effect controller, not the card receiving counters. |
| `ON_LIFE_GAIN`, `ON_LIFE_LOSS` | `LIFE_GAINED`, `LIFE_LOST`; life changes, including life lost to damage. |
| `ON_SPELL_CAST` | `SPELL_CAST`; a spell was cast, before its resolution. |
| `BEGIN_UPKEEP` | `UPKEEP_STARTED`. |
| `END_OF_TURN` | `END_STEP_STARTED`; start of end step, not after cleanup. |

`trigger` accepts `subject: "self" | "another" | "any"`, `controller: "self" | "opponent" | "any"`, `cardTypes`, `subTypes`, and `condition`. Subject compares the **event card** with the source incarnation; controller filters the event's relevant player, not the effect's eventual target. Type/subtype filters inspect the event card, so do not attach them to player-only events.

Write filters explicitly. For nonpersonal card events (entry/death/attack/block) the default subject is `self` and default controller unrestricted. Draw/discard/spell-cast default to any subject and own controller. Player/step events default to own controller; `ON_DAMAGE_DEALT` defaults to own source subject. Example: another friendly Creature entering uses `{ "subject": "another", "controller": "self", "cardTypes": ["Creature"] }`; an opponent losing life uses `{ "controller": "opponent" }`.

Rule condition shape for `trigger.condition` and `interveningIf`:

```json
{ "op": "lte", "left": { "path": "controller.life" }, "right": 10 }
```

Operations: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `includes` (left array contains right value). Compose with `{ "all": [...] }`, `{ "any": [...] }`, `{ "not": condition }`. Operands can be string/number/boolean/null, `{ "path": "..." }`, or numeric expressions. Available roots are `source`, `controller`, `event`, `history`; event data depends on the event type. `trigger.condition` gates discovery only; `interveningIf` also rechecks at resolution.

## 6. Choices

`choice` is on an effect, or flattened onto a nonstatic raw ability. `prompt` is an optional player-facing string on every kind.

| `kind` | Other fields | Behavior |
|---|---|---|
| `discard` | Uses the effect’s `params.amount` | With `DISCARD_FROM_HAND`, ask the one affected player for exactly the available required cards. Uses the existing resolution cursor, not payment. |
| `optional` | None | Yes/no to perform this effect. Targets required by the effect are still selected during announcement/scheduling. |
| `options` | `options: [{ id, label, effects }]`, `min` default 1, `max` default 1 | Choose instruction branches during resolution. Chosen branches replace the wrapper effect. |
| `ordering` | Same `options` shape | Order all supplied instruction branches during resolution; not the same as ordering cards in a library. |
| `search` | `zone`, optional `cardTypes`, `subTypes`, `min` default 0, `max` default 1, `ordered` boolean | Select controller's cards from the entire represented zone. Selected cards become this effect's recipients. `ordered: true` retains the selected order. No top-N reveal window or remainder contract. |
| `selection` | `criteria`: target definition | Choose recipients at resolution using these criteria. |
| `distribution` | `total`: fixed number, `field` default `amount` | Divide a total among recipients; use `field: "damage"` with `MODIFY_STATS`. Explicit target groups collect this division during announcement/scheduling; otherwise it is a resolution choice. |

An `options`/`ordering` branch cannot introduce fresh explicit targets; choose targets with action modes before stacking, or use an existing supported resolution selection. Choices are serializable instructions, not JavaScript callbacks. Announced numbers, mode selections, targets and payments each have their own existing timing; do not assume every prompt happens during resolution.

## 7. Static abilities and continuous operations

```json
{
  "id": "friendly-beast-bonus",
  "type": "static",
  "activeZones": ["battlefield"],
  "effects": [{
    "layer": 7,
    "scope": { "zones": ["battlefield"], "controller": "self", "cardTypes": ["Creature"], "subTypes": ["炎獸"] },
    "effect": { "type": "STAT_DELTA", "power": 1, "toughness": 1 }
  }]
}
```

This is a continuous friendly bonus, including its source if the source matches. It recalculates for new entrants and ends when its generating ability/source stops applying. It is not an Aura attachment or a trigger.

Static ability fields: `id`, `type: "static"`, `activeZones` (default battlefield), `characteristicDefining` (boolean; if true, defaults to all represented zones), `effects` (array). Each static effect has `scope`, `effect`, `layer` (number) and optional `group` (string). Parts sharing a group are one effect across layers; the default group is one per ability. Operation type selects the actual evaluation stage; `layer` is descriptive metadata.

`scope` fields: `self` boolean; `zones`, `cardTypes`, `subTypes`, `colors` arrays; `controller: "self" | "opponent" | "any"`. It can also carry exact runtime `cardUuid`, `zoneRevision`, or `objects: [{ cardUuid, zoneRevision }]`; do not hardcode match IDs in reusable card definitions. Use `self: true` for a source-only static effect. Broad characteristic scopes default to battlefield.

| Continuous `effect.type` | Other fields |
|---|---|
| `STAT_DELTA` | Optional `power`, `toughness` numeric values. |
| `SET_STATS` | Required `power`, `toughness` numeric values. |
| `SWITCH_STATS` | None. |
| `TYPE` | String arrays `set`, `add`, `remove`; `setSubTypes`, `addSubTypes`, `removeSubTypes`; `setSuperTypes`, `addSuperTypes`, `removeSuperTypes`. |
| `COLOR` | Color arrays `set`, `add`, `remove`. |
| `ABILITY` | `removeAll` boolean; `removeIds` string array; `add` array of **normalized** abilities; `addKeywords`, `removeKeywords` string arrays. Nested granted abilities are not passed through the raw ability parser. |
| `TEXT` | `replacements`: string-to-string object. |
| `CONTROL` | `controllerId`: runtime player ID; not an author-relative controller selector. |
| `COPY` | `blueprint`: complete **normalized** blueprint, not an unresolved catalog ID/raw card object. |
| `PERMISSION` | `rules`: array of `{ "action": "cast" | "activate", "mode": "prohibit" | "instant", "players"?: "self" | "opponent" | "any", "abilityIds"?: ["id"] }`. These are action permissions, not Chain prevention. |

For resolved `CREATE_CONTINUOUS_EFFECT` / `SET_STATS`, durations are `PERMANENT`, `END_OF_TURN`, `WHILE_ON_BATTLEFIELD`, `WHILE_ATTACHED`. Attachment-dependent lifetime does not provide an attachment action. Resolved stat values/recipient incarnations are captured when created; static definitions recalculate. See [continuous effects](../../../../docs/continuous-effects-engine.md).

## 8. Numeric values and X

### Reading the X example in plain language

`numericDeclarations` tells the engine **which number the player must choose**. For `{ "name": "X", "min": 0, "max": 4 }`, the player chooses one whole number from 0 through 4 when casting. This declaration does not itself charge energy or change life.

`{ "numeric": { "kind": "binding", "name": "X" } }` means **read that already chosen number**. The name must match its declaration. Using it twice does not ask the player twice; payment and resolution share the retained choice.

`params` supplies inputs to the selected `action`. For `MODIFY_LIFE`, `params.amount` is a signed change: `3` gains three life, `-3` loses three. The nested `multiply` expression calculates `left * right`; `left: -1` and `right: X` therefore mean `-X`. The `numeric` wrapper marks a calculation where a plain fixed number could otherwise appear.

In [example 8](card_data.example.jsonc), choosing **X = 3** gives this sequence:

1. Retain the chosen value `X = 3` for this spell.
2. Base route: pay three generic energy, plus the additional one red energy and discard one card. Alternative route: pay two life instead of the generic requirement, still paying the same additional costs.
3. On resolution, read the same X and calculate `amount = -1 * 3 = -3`.
4. Apply that change to the chosen opponent: **20 life → 17 life**. There is no `damage` tag, so this is life loss without damage.

For a fixed “opponent loses 3 life” effect, just write `"params": { "amount": -3 }`. No declaration or numeric expression is needed. For `DRAW`, the input is also named `amount`, but it means how many cards to draw; parameter meaning comes from the action.

### Expression reference

Prefer plain numbers for fixed values. An expression has the explicit wrapper `{ "numeric": expression }`:

| Expression | Exact fields |
|---|---|
| Announced value | `{ "kind": "binding", "name": "X" }` |
| Addition | `{ "kind": "add", "left": numericValue, "right": numericValue }` |
| Multiplication | `{ "kind": "multiply", "left": numericValue, "right": numericValue }` |
| Field query | `{ "kind": "query", "id": "field", "args": { "path": "source.power" } }` |
| Counter-total query | `{ "kind": "query", "id": "counterTotal", "args": { "scope": { "zones": ["battlefield"], "controller": "opponent" }, "counterType": "scorch" } }` |
| Count query | `{ "kind": "query", "id": "count", "args": { "scope": { "zones": ["battlefield"], "controller": "self", "cardTypes": ["Creature"] } } }` |

`left`/`right` can be numbers or wrapped expressions. There is no subtraction/division/if expression; multiply by `-1` to negate. Only registered queries exist; these are data, not evaluated JavaScript strings.

Card `numericDeclarations` own card spell costs/effects/modes. Activated ability declarations own that ability's costs/effects/modes. Bindings are chosen before payment and retained on the stack; ordinary triggers/static abilities do not inherit a card's X. A generic cost permits bindings/add/multiply, **not live queries**. Numeric expressions are supported in top-level effect `params` values, rule-condition operands and continuous stat fields; not in arbitrary nested objects, printed P/T, colored costs, target bounds or distribution totals. Continuous stats also retain the compatibility form `{ "count": scope, "multiply": 2, "add": 1 }`.

Resolution field queries can read `source`, first valid `target`, `controller`, `event` (trigger only) and `history` where available. Static contexts expose source/target characteristics; do not assume an event/history exists there. Each consumer owns evaluation timing. A missing field is not silently zero. Legacy top-level `DYNAMIC:source.power`, `DYNAMIC:source.toughness`, `DYNAMIC:target.power`, `DYNAMIC:target.toughness`, and trigger `DYNAMIC:event.…` markers remain; prefer the shared numeric format for new numeric definitions.

### State-derived numbers: count what exists now

[Example 10](card_data.example.jsonc) draws cards equal to the controller's hand size. Its `DRAW.params.amount` is:

```json
{
  "numeric": {
    "kind": "query",
    "id": "count",
    "args": { "scope": { "zones": ["hand"], "controller": "self" } }
  }
}
```

No `numericDeclarations` is needed: the player is not choosing this number. The engine counts matching cards immediately before this instruction executes. If three cards are in hand then, draw three. The resolving spell has already left hand, so it does not count itself. Earlier instructions or responses can change that hand size before it is read.

For friendly Creature count, use `zones: ["battlefield"]`, `controller: "self"`, `cardTypes: ["Creature"]`. Add `subTypes: ["炎獸"]` to restrict the count further. Explicit zone filters can also count library, graveyard or exile cards; this is a count, not a reveal or selection effect.

### Event-derived numbers: read the event that caused this trigger

[Example 11](card_data.example.jsonc) uses an `ON_DAMAGE_DEALT` trigger. Its `MODIFY_LIFE.params.amount` is:

```json
{
  "numeric": {
    "kind": "query",
    "id": "field",
    "args": { "path": "event.payload.amount" }
  }
}
```

If that triggering damage event recorded 3 damage, this instruction gains 3 life. The event is retained on this trigger, so later damage events do not replace its amount. This is not a lookup of the latest global event, a total over several recipients/events, or a live read of the source's current power. An ordinary spell/activated ability has no triggering event; do not use an `event.…` path there. Other event types have different payload fields and meanings.

### History-derived numbers: event count is not a damage total

[Example 12](card_data.example.jsonc) reads the number of `DAMAGE_DEALT` events recorded so far this turn:

```json
{
  "numeric": {
    "kind": "query",
    "id": "field",
    "args": { "path": "history.counts.DAMAGE_DEALT" }
  }
}
```

This count includes both players' recorded damage events and is read when the instruction executes. If separate events dealt 3 damage and 4 damage, the count is **2**, not 7. One combat involving multiple sources/recipients can produce several events; this is not a count of combats or spells. History resets for each turn, so it is not a game-long total.

`history.own.DAMAGE_DEALT` is the per-controller event count where available; damage-event attribution follows the damage source's controller, not the damaged player's identity. Unlike the initialized global counters, a player's history entry can be absent before their first tracked event. Missing paths do not automatically become zero. There is no authored fallback/default operator.

### Can a query result be stored in a binding?

**No, not with the current catalog format.** A `binding` only reads a player-announced number declared for the current spell/activated ability. It does not assign a value, evaluate a query, or remember the result of an earlier instruction.

| Want to do | Current support |
|---|---|
| Choose X once, reuse it in cost and effects | Yes: `numericDeclarations` + `binding`. |
| Read the current hand/Creature count for an effect | Yes: use a `count` query directly. |
| Reuse a trigger's damage amount | Yes: repeat its retained `event.payload.amount` query; it still names the same event. |
| Save hand size when casting, then use that frozen value later | Not supported by a general query-to-binding declaration/instruction. |
| Read hand size once, draw, then reuse the original count in another effect | Not supported by a binding assignment. Repeating the query counts the changed hand again. |
| Use a live state/event query in a generic mana cost | Unsupported; announcement costs permit declared bindings and arithmetic on them, not queries. |
| Sum damage points across this turn's events, optionally filtering sources/players | No authored sum/filter aggregate query. Stored history events alone do not expose such an operation to card JSON. |
| Sum damage across the whole game | No current game-long damage aggregate. |

Naming a declaration `handSize` would still ask the player to choose `handSize`; it would not calculate it. A binding with an undeclared name is rejected. `numericDeclarations` accepts only `name`, `min`, `max`; there is no `query`, `value`, initializer, `bind`, `storeAs` or `captureAt` field/instruction for computed values.

For example, with three cards in hand, two successive “draw your current hand size” instructions read **3**, draw three, then read **6**, draw six (assuming enough cards and no intervening replacement changes). They do not share a saved value of 3. A future computed-binding feature would need an explicit capture point and lifetime; no such engine feature is added by these examples.

| Numeric source | When its value is determined |
|---|---|
| Announced `binding` | Player selection before payment; retained for this action/stack object. |
| State query in effect `params` | Immediately before each resolving instruction. |
| Trigger-event field query | Read during resolution, from the retained event that caused this particular trigger. |
| Turn-history field query | Current recorded history when the resolving instruction reads it. |
| Static stat query | Recalculated during effective-characteristic evaluation. |
| Resolved continuous stat query | Calculated and frozen when that continuous stat effect is created. |

Game-scoped limits, combat/next-turn lifetimes, countdowns, and storage limits are not additional accepted JSON fields unless they are documented in this reference and supported by the parser.

## 9. Advanced replacement definition shape

Inside `CREATE_REPLACEMENT_EFFECT.params.definition`, fields are `label` (string), `operation`, optional `match`, `selfReplacement`, `optional` (booleans), `duration` (`permanent`, `end_of_turn`, `while_source`), `expiresTurn` (number), `remaining` (finite damage shield amount), and `uses` (finite event uses). IDs and source references are assigned by the engine. Selected card/player recipients are bound into the match.

| `operation.type` | Other operation fields |
|---|---|
| `damage_scale` | `factor` number |
| `prevent_damage` | Optional `amount` number |
| `redirect_damage` | `recipient`: runtime damage recipient (`kind: "player"`, `playerId`; or `kind: "permanent"`, `cardUuid`, `zoneRevision`) |
| `move_destination` | `to`: destination zone |
| `cancel_event`, `regenerate` | None |

`match` supports `kinds` (array of `damage`, `zone_transfer`, `destroy`, `sacrifice`, `discard`, `draw`, `life_change`, `poison`, `counter_change`), `cardTypes`, `from`, `to`, `combat`, and exact runtime `playerId`, `controllerId`, `card`/`source` references (`{ cardUuid, zoneRevision }`). A raw match does not have a relative `controller: "opponent"` field; use supported target binding rather than hardcoding match IDs. These are advanced existing engine contracts; see [replacement/prevention](../../../../docs/proposed-events-engine.md).

## 10. Adding a card

1. Copy the closest [annotated example](card_data.example.jsonc), remove comments, and insert its entry into `card_data.json` with unique IDs.
2. Check the action spelling, recipient type, mana symbols and timing. Keep printed text and executable instructions consistent; mark partial support explicitly.
3. Add the card's outer key to the selected deck in [central config](../config.ts). Documentation examples are not automatically playable cards.
4. Restart the server and exercise the normal cast/activation/trigger flow. Reading successfully is not proof that an effect works.

Current real-card examples include `empire-servant`, `flame-fangs`, `worlds-rebel`, and `awakened-blood-mountain`. Implemented content includes Scorch, bounded reveal, immediate actions, and equipment; artifact/relic threshold handling remains deferred. Do not add arbitrary fields or disguise unsupported behavior as unrelated modes or triggers.

Source of truth: [loader](card-parser.ts), [card types](../types/card.types.ts), [effects/targets/choices](../types/effect.types.ts), [registered effect handlers](../engine/effect-registry.ts), [static operations](../types/continuous-effect.types.ts), [numeric definitions](card-definition-validator.ts). When these change, update this reference and its examples together.

## 11. Workbook structures in practice

[Examples 13–17](card_data.example.jsonc) explain the newer consumers field by field:

| Example / real definition | How to author it | Important boundary |
|---|---|---|
| 13 / `wind-call` | Ordered `MOVE_ZONE` with `choice.search`, then `SHUFFLE`. Search supplies the chosen card as the move recipient. | Searches the controller's whole zone, not top N. No eligible card skips the move; shuffle still runs. Selection happens during resolution, not target announcement. |
| 14 / `wind-beast-rabbit`, `phantom-land-soldier` | Entry ability with `effectId: MOVE_ZONE`, matching `origin` and search `zone`. | `min:0,max:1` allows declining; `min:1,max:1` requires one when available. Direct placement pays no cast cost and consumes no normal land play. |
| 15 / `phantom-castle` | Static `ABILITY.add` containing a **normalized** nested activated ability. | Outer ordinary abilities use flattened `effectId`/`params`. Nested grants instead require `effect:{action,params,tags,targeting}`, plus their own `cost` and `castSpeed`. |
| 16 / `swift-spirit-envoy` | `interveningIf` compares a numeric `count` query to 2. | Source is itself a 迅靈, so two friendly 迅靈 means another exists. Checked at discovery and resolution. Not a general exclusion filter or saved binding. |
| 17 / dual lands | Self-entry `TAP` trigger and mana ability with `params.colors`. | TAP uses the stack. This is not an atomic enters-tapped replacement. Mana action chooses **one** listed color, not all colors. |
| `fatiao-warrior` | Two named single-effect triggers, one for entry and one for attack. | Two independent timings of the same instruction; is separate from the ordered `effects` list now available on a single ordinary trigger. |
| `worlds-sin-emperor` | Count friendly 幽爾 creatures in entry DRAW params; separate friendly-tribe attack watcher. | Count includes this source and is evaluated on resolution. Negative toughness is a stat change, not damage. |
| `okair-tomb` | Instant activated GRANT_STATS with an empty cost and no turn limit. | Printed activation has no cost/limit, so it remains free and repeatable. Do not silently add balance restrictions. |

Use `workbookTestSetup` in central config to opt a server into the 60-card consumer deck (`gameConfig.setup = workbookTestSetup` during startup). Default and ST01A decks are unchanged. Its opening seven contain four lands, 魔豆, 諸界游歷者 and 風之呼喚; the rest includes every newly added definition. The deck now includes eight 海-enabled additions alongside the initial 33 definitions. These examples do not add engine mechanics.

[Example 18](card_data.example.jsonc) demonstrates 幻海人下士's existing `onEnterEffects` list: search your graveyard for a Land → move it onto the battlefield → draw one. It is one ordered self-entry trigger, including when this creature enters through a direct move instead of casting. With no eligible land, the move skips and the draw still runs. This legacy entry list accepts effect objects with `action`; named ordinary triggers now also support `effects` as documented below; activated lists and conditional outcome clauses are now supported as shown in the starter examples below.

For producers such as 諸界商人 and 諸界海, `params.colors` can list all six resource keys: `["red", "black", "green", "yellow", "white", "blue"]`. The player chooses **one** output via the normal mana action, producing one energy total. The card's own `colors` remain its printed element (green for 諸界商人, blue for 諸界海), not every energy it can produce.

## 12. Small consumer-driven additions

[Examples 19–23](card_data.example.jsonc) cover the new accepted structures. They are still documentation-only cards.

- Numeric query `exists` accepts the same `{ "scope": ... }` as `count`, but returns **0 or 1**. It is read at each resolving instruction. `2 + exists(scope)` draws two or three, never two plus the number of matching creatures. It is a computed value, not a declaration or binding. Both queries require a count-capable context; queries remain unsupported in announcement costs.
- `DISCARD_FROM_LIBRARY` acts on existing player recipients (self or relative player expansion). Amount must resolve to a nonnegative integer. It snapshots the top available identities in top-first order, then sends normal discard-caused moves through replacement handling. Amount zero and an empty deck do nothing; they are not failed draws. A cancelled top-card move does not cause the engine to discard an extra replacement card instead.
- `DISCARD_FROM_HAND` must use `choice:{ "kind":"discard" }`. Its amount is the desired number; the server caps required selections to the affected hand's size. The **affected player**, including an opponent recipient, chooses their own cards. One player per instruction is supported; use separate instructions for separate players. There is no random discard. Source-discard activation uses the separate `cost.discardSelf` field. Answering resumes the same spell/trigger after preceding effects. UUID/zone revision is retained for each chosen card.
- Named triggered abilities accept either the existing flattened single effect or a nonempty `effects` array. Array entries use `action`, not `effectId`. The runtime stores one canonical list or one single effect, never a duplicated first-effect mirror. Target groups, modes, delayed triggers, fizzle handling, choices and numeric validation use the shared list. Activated abilities now accept the same ordered list.
- For an optional **group**, use the existing resolution `options` branches: accept contains the ordered instructions; decline contains an empty list. Ordinary `optional` only skips its own instruction, not the instructions after it. 幻海人 戈圖 is a real consumer of the grouped form.

`CARD_DISCARDED_FROM_HAND` and `CARD_DISCARDED_FROM_LIBRARY` are distinct semantic events/history counters, with corresponding `ON_DISCARD_FROM_HAND` / `ON_DISCARD_FROM_LIBRARY` triggers. They share a `discard` proposal/move cause; a replacement rule can use `match.from` to distinguish them. A generic transfer to graveyard emits neither. Existing destination semantics are preserved: cancellation or redirection away from graveyard does not emit a completed graveyard-discard event. Off-zone discarded-card self-triggers remain outside this pass. The old unsuffixed discard event/trigger was renamed rather than emitted as a duplicate; use fresh rooms after upgrading.

New actual cards: 强權崛起, 追求淨化之火, 蒼海巡察組, 深淵幻士, 諸界海之主, 狂海幻力, 諸界火術士 and 幻海人 戈圖. They are included in `workbookTestSetup`; `smallMechanicsTestSetup` provides an opt-in opening for the fresh-client demonstration. Both presets remain 60 cards, and default rooms keep their selected setup.

Bounded starter reveal retains exact top-N identities rather than substituting a whole-zone search.

## 13. Counter-change observation (red starter implementation in progress)

`ADD_COUNTER` / `REMOVE_COUNTER` now retain their effect source and initiating controller through proposal/replacement choices. After commitment, `COUNTER_CHANGED` reports `card` (the recipient), `counterType`, `oldCount`, `newCount` and signed `amount`. Removing seven from a card with two counters reports `amount: -2`. Zero changes and cancelled operations emit no counter-change event.

`controllerId` identifies the effect controller captured when its action was created, even if the source changes control before resolution. `targetControllerId` identifies the counter recipient's controller. `source` and `sourceInfo` retain the causal card and snapshot. A direct rule mutation with no supplied provenance has no invented causal controller. Global history counts occurrences, not counters placed; per-player history is attributed only when a causal controller is known.

Example 24 watches your positive Scorch placements with `subject: "any"`, `controller: "self"`, a `counterType` equality and `amount > 0`. It uses existing conditions; no counter-specific trigger-filter schema is needed. Negative changes do not trigger that placement watcher. Add `sharedPerEvent: true` for the starter's grouping rule described below. Creature Scorch uses the confirmed opt-in checkpoint; Artifact/Relic destruction remains deferred.

Current custom-profile support targets the 24-card 炎獸 starter set. Creature Scorch continuously checks current attack plus maximum health; marked damage does not reduce the threshold. Artifact/Relic destruction remains deferred. Chain-protected actions execute without entering the stack. BP01 and other factions remain outside the supported profile.

### Starter bounded reveal

`REVEAL_TOP` accepts `amount` from 1 to 3. It captures the exact library-top identities in top-to-bottom order (the server stores its top at the array end), plus the revealing source's resolved snapshot and ability controller. The ordinary form offers at most one `subTypes` match excluding `excludedNames`, moves it to hand, and asks for the remaining cards' bottom order. Choices keep exact identity and zone revision; a continuation never repeats a whole-library search.

The Emperor form uses `disposition: "scorch"` and `matchingClauses: [{ "cardTypes": ["Creature"], "subTypes": ["炎獸"] }, { "cardTypes": ["Spell"], "subTypes": ["炎兵"] }]`. Each clause requires both a type and subtype match; the clauses are alternatives. It counts the captured cards once, places that many Scorch counters on one opposing Creature or Artifact, and returns every captured card to the bottom in the chosen order. Wrap the `REVEAL_TOP` effect in `choice: { "kind": "optional" }` for an optional entry reveal. Declining performs no reveal.

`CARD_REVEALED` / `ON_REVEAL` is published only after this resolution finishes, including the selection or Scorch and remainder return. Its payload retains `revealedCard`, `sourceInfo`, and the initiating `controllerId`; `card` identifies the current hand/library card for self triggers. This is a local resolution record, not persistent room history. `CLAIM_REVEALED_SELF` can move that revealed source from its recorded hand/library position to hand; `{ "discard": true }` discards it instead. A selected hand card still triggers, and a bottomed card can claim itself. The claim retains that post-disposition zone and zone revision: leaving and returning before the trigger resolves does not let an old trigger claim the new incarnation. Reordering within the same library does not change that revision. The real consumers are 赤狼, 破裂火球, 被啓動的血炎山, and 炎極三公 安度基特斯. 安度基特斯 composes an optional `CLAIM_REVEALED_SELF` discard with `recordOutcome: { name: "discarded", kind: "discarded" }`, followed by ordinary `ADD_COUNTER` selection and `DRAW` instructions carrying `requiresOutcome: "discarded"`. Its shared resolution-local guard requires the actual discard; declining, cancellation or an exile replacement gives no payoff. The named outcome survives a serialized replacement or selection choice and expires with the resolution. Artifact/Relic Scorch destruction remains explicitly deferred, although counters can be placed.

## 14. Starter authoring examples

These additions serve the 24 ST01A 炎獸 starter cards. They do not enable BP01, other factions, a general reveal language or arbitrary history queries. Complete, commented entries are in `example-hand-ordered`, `example-mixed-speed`, `example-outcome-destroy`, `example-live-counter-total`, `example-starter-target-filters`, `example-immediate-protector`, and the updated `example-counter-watcher` in the [examples file](card_data.example.jsonc).

### Hand costs and ordered activations

This is 炎極雇傭兵's ability shape. The source is discarded during payment, then its retained ability resolves the ordered effects. An `effects` array uses `action`; do not combine it with flattened ability-level `effectId`, `params`, `targeting` or `choice`.

```json
{
  "id": "discard-destroy", "type": "activated", "castSpeed": "instant",
  "allowedZones": ["hand"], "cost": { "discardSelf": true },
  "effects": [
    { "action": "DESTROY", "params": {}, "targeting": {
      "type": "permanent", "controller": "opponent", "cardTypes": ["Creature"],
      "summonKind": "effect", "required": true
    } },
    { "action": "DRAW", "params": { "amount": 1 }, "targeting": { "type": "self", "required": false } }
  ]
}
```

The draw here is ordered, not conditional on successful destruction. If all announced explicit targets become illegal, the whole ability fizzles. Use an outcome guard only when the actual card says success is required.

### Mode timing and immediate actions

A card with `castRequirements.speed: "instant"` may declare one mode with `castSpeed: "sorcery"` and another with `castSpeed: "instant"`, as 火球術 does. The server offers only legal modes at announcement and revalidates the selected timing before payment. Omitted mode speed inherits the action speed; choosing a fast mode does not make a slow mode legal on the opponent's turn.

The printed keyword `ImmediateFriendlyCreatures` protects this controller's Creature summons and abilities while the provider remains on the battlefield, including eligible hand abilities. The supported keyword applies to friendly Creatures; it does not add a subtype filter. A single activated or triggered ability may instead use `immediate: true`, as 諸界帝國反抗軍's attack ability does. These actions still pay costs, choose legal targets and resume choices through the normal cursor; they execute without entering the stack. Normal blocking remains available.

### One observer per placement event

`sharedPerEvent: true` belongs on a triggered ability. Discovery groups by **controller + blueprint ID + ability ID for this event**. Multiple copies of 强攻之怒焰狼 therefore produce one draw for one positive counter-placement event; placing three counters is still one event. A later event can trigger again. Different controllers, blueprint IDs or ability IDs are distinct groups. This is neither `limitPerTurn` nor a global draw limit. A per-turn budget uses the source's zone revision: the confirmed 烈焰狼王 reentry ruling permits the same physical card to trigger again after leaving and returning.

### Success-dependent effects

These are two entries from one ordered `effects` list:

```json
[
  { "action": "DESTROY", "params": {},
    "targeting": { "type": "permanent", "controller": "opponent", "cardTypes": ["Creature", "Artifact"], "required": true },
    "recordOutcome": { "name": "destroyed", "kind": "destroyed" } },
  { "action": "DRAW", "params": { "amount": 1 },
    "targeting": { "type": "self", "required": false }, "requiresOutcome": "destroyed" }
]
```

`recordOutcome` observes the actual matched destruction into the graveyard after replacement/prevention. Indestructible, cancellation or exile redirection records no successful destruction. `kind: "discarded"` similarly requires an actual discard into the graveyard, as 安度基特斯 demonstrates with `CLAIM_REVEALED_SELF`. A declined optional recording instruction leaves the guarded effects disabled. The named boolean belongs to this resolution's serialized continuation, survives replacement/selection choices and expires on completion. It does not inspect global history, count another effect's earlier success or create a permanent flag. `ON_DESTROY` is a separate event trigger for a permanent actually destroyed into the graveyard; it is not interchangeable with `ON_DIE`.

### Live counter totals

```json
{
  "numeric": { "kind": "query", "id": "counterTotal", "args": {
    "scope": { "zones": ["battlefield"], "controller": "opponent" },
    "counterType": "scorch"
  } }
}
```

This sums the named counters on cards admitted by the existing scope filters. Omit `cardTypes` to include every opposing battlefield card; adding `cardTypes: ["Creature"]` counts only Creatures. It returns a quantity, unlike event history, which counts occurrences. A resolving effect reads the total at that instruction's resolution time; later board/counter changes can change it. No X declaration or binding is needed. The evaluator must supply a counter-total board context; missing context is an unresolved numeric parameter, not zero. Queries remain unavailable in announcement costs. The Emperor's confirmed attack is one hit for three times this total, not repeated three-damage hits. Its admitted targets are the opposing player or one opposing Creature; Artifact/Relic and Land are excluded as damage targets even though their Scorch counters contribute to the total. Artifact/Relic Scorch destruction remains deferred.
