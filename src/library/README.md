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
| `colors` | Array of `white`, `blue`, `black`, `red`, `green`, `colorless` | Effective colors derive from colored mana requirements when omitted. Supply explicitly for a colored card with a generic cost, or the workbook's colored lands. |
| `power`, `toughness` | Numbers | Missing values resolve as zero; supply both for a Creature. These printed fields do not accept numeric-expression objects. |
| `keywords` | Array of strings | `[]`. Only existing keyword consumers do anything; arbitrary words are not new mechanics. Some combat consumers require exact spelling, e.g. `Flying`, `Trample`. |
| `rulesText` | String | `""`; display only. |
| `castRequirements` | Object, section 3 | Hand only, sorcery timing, no nonmana costs. |
| `onCastEffects` | Ordered array of effect objects, section 4 | `[]`. Instructions run when the spell **resolves**, before its structural move to battlefield/graveyard. They are not cast-time triggers. |
| `onPlay` | Same as `onCastEffects` | Legacy alias; prefer `onCastEffects`. If both exist, `onCastEffects` wins, including an empty array. |
| `onEnterEffects` | Ordered array of effect objects | Legacy self-entry trigger list. Prefer a named `ON_ENTER_BATTLEFIELD` ability for a simple effect. This legacy entry list can contain multiple effects, but is not a general multi-effect attack/death trigger field. |
| `abilities` | Array of activated, triggered or static definitions, sections 5–7 | `[]`. A Land with no abilities currently receives an implicit tap-for-colorless fallback; author an explicit mana ability for real lands. |
| `modes` | Array of `{ "id", "label", "effects": [...] }` | No modal choice. IDs are stable strings; `effects` use ordinary effect objects. |
| `modeCount` | `{ "min": 1, "max": 1 }` | Choose exactly one mode when modes exist. Base effects run first, then selected modes in selection order. Modes do not have separate casting speeds. |
| `numericDeclarations` | Array of `{ "name": "X", "min": 0, "max": 4 }` | No announced variables. `max` may be omitted; names must be unique, nonempty safe keys. See section 8. |

**Not catalog inputs today:** `superTypes` and `attachmentRequirements` exist on runtime types, but `normalizeCard` does not copy them from this JSON. Likewise, art URL, illustration, set, rarity, collector number, flavor text and author notes have no loaded fields yet. Unknown top-level fields are discarded; do not assume that being valid JSON or appearing in a TypeScript interface makes a field functional.

## 3. Costs and casting requirements

### Mana spelling

| Input | Meaning |
|---|---|
| `"{W}{U}{B}{R}{G}"` | One white, blue, black, red and green requirement. |
| `"{3}"` | Any three energy: **generic**, including the workbook's `3無`. |
| `"{C}"` | Specifically one colorless energy. Different from generic. |
| `"{2}{R}{R}"` | Any two plus two red. |
| `""` or `"{0}"` | No mana to pay. |
| `"{X}{R}"` | Announced generic X plus one red; requires a card-level declaration named `X`. |

Only uppercase `W U B R G C X` and whole-number symbols are parsed. `"2炎"`, `"R"`, hybrid symbols and arbitrary text are not supported. A nonempty parsed symbol cost overrides `castRequirements.cost.mana`; omit `manaCost` when deliberately authoring the mana object there instead. Do not provide two competing mana costs.

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
| `mana` | Object with nonnegative integer `white`, `blue`, `black`, `red`, `green`, `colorless`, `generic` amounts. Only `generic` can instead use an announced numeric expression. Omit absent colors. |
| `tap` | Boolean; tap the source. Creature tap costs obey summoning sickness. |
| `untap` | Boolean; untap the source. Cannot combine a true tap and untap cost. |
| `life` | Nonnegative integer life payment. |
| `discard` | Nonnegative integer count of other hand cards to discard, selected through payment. This is not “discard this source from hand.” |
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
| `type` | `self`, `player`, `permanent`, `card`, `spell`, `stack`. `self` normally supplies the controller automatically; `permanent` means battlefield; `card` can use `zones`; `spell` means a spell stack object; `stack` can also address abilities. Runtime pointer types `any`/`zone` are not authored targeting types. |
| `required` | Boolean. For explicit targets it contributes a default minimum of 1 if true, 0 if false. Use explicit bounds. **False does not mean “may perform this effect”; use `choice.kind: "optional"`.** |
| `minTargets`, `maxTargets` | Fixed integer bounds for chosen targets; max defaults to 1. Not X-expression fields. |
| `controller` | `self`, `opponent`, `any`; omitted means unrestricted. Relative to the action/ability controller. |
| `cardTypes`, `subTypes` | String arrays. Values within an array are OR; different filters combine with AND. `["Artifact", "Land"]` means Artifact **or** Land. |
| `zones` | Zone array for `type: "card"`; defaults to battlefield. It does not make `permanent` reach another zone. |
| `power`, `toughness` | Optional `{ "min": number, "max": number }`, either bound can be omitted. Used for explicit targets. |
| `stackTypes` | Array of `spell`, `activated`, `triggered`; filters a spell/stack target. |
| `subject` | With `type: "self"`: `controller` (default) or `source`. Use `source` for buffing the originating permanent, not for healing its player. |
| `all` | Boolean. `true` selects matching recipients at resolution without explicit target selection. Current expansion handles players or battlefield permanents with controller/type/subtype filters. It does not support zones, stat bounds or stack-type filtering; do not combine those and expect them to apply. |

Explicit targets are chosen before stacking and checked again at resolution, including zone incarnation. A returned card with the same UUID is not automatically the original target. No targets can be invented from text such as “the card that died”; that needs an existing effect/selection contract.

### Registered actions and parameters

These are the current action IDs, not promises that every combination of parameters and targets is meaningful. For `DRAW`, `ADD_MANA` and `DISCARD_HAND`, the handler acts on the **ability/spell controller**, regardless of a different target definition; author them as self effects.

| `action` | `params` | Effect / recipient |
|---|---|---|
| `MODIFY_LIFE` | `{ "amount": 2 }` | Change targeted players' life; negative + `damage` tag deals damage. |
| `MODIFY_STATS` | `{ "damage": 2 }` and/or `power`, `toughness` | Damage battlefield permanents and/or modify P/T until end of turn. Damage uses a positive amount. |
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
| `DISCARD_HAND` | `{}` | Controller discards the entire hand. |
| `GRANT_STATS` | `{ "power": 1, "toughness": 1 }` | P/T modifier until end of turn; one recipient or current `all` recipients. |
| `SET_STATS` | `{ "power": 3, "toughness": 3, "duration": "END_OF_TURN" }` | Set base P/T; duration defaults to `PERMANENT`. Also accepts optional `requiredZone` for source lifetime. |
| `CREATE_CONTINUOUS_EFFECT` | `{ "effect": { "type": "STAT_DELTA", "power": 1 }, "duration": "END_OF_TURN" }` | Apply an operation from section 7. Optional `requiredZone` restricts the source's zone. |
| `REGENERATE` | `{}` | Create a one-use regeneration shield for this turn on recipients. |
| `CREATE_REPLACEMENT_EFFECT` | `{ "definition": { "label": "Shield", "operation": { "type": "prevent_damage", "amount": 2 }, "duration": "end_of_turn", "remaining": 2 } }` | Register a replacement/shield; see advanced shape below. |
| `CREATE_DELAYED_TRIGGER` | `{ "ability": normalizedTriggeredAbility, "lifetime": "once" }` | Register a delayed trigger. Lifetimes: `once` (default), `end_of_turn`, `permanent`. Nested `ability` is a **normalized** ability with `effect: { action, params, targeting }`, not the catalog's flattened `effectId` spelling. |

Multiple spell effects run in list order on one spell stack object. Separate triggered abilities produce separate trigger objects; they are not a way to implement a compound instruction on one trigger. A normal triggered/activated ability has one base effect; there is no raw `effects` array for these ability types. Static abilities use `effects`; modes contain effect lists; legacy self-entry uses the card's `onEnterEffects` list.

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

**Important spelling:** raw abilities use `effectId`, `params`, `tags`, `targeting`, `choice` at ability level. Raw spell effects use `action`. The loader converts an ability's `effectId` to uppercase and constructs its runtime `effect`. A raw ability with only `action` or nested `effect` does not work as intended. Static abilities use the separate format in section 7.

| Ability field | Activated | Triggered |
|---|---|---|
| `id`, `type` | Stable ID, `"activated"` | Stable ID, `"triggered"` |
| `effectId`, `params`, `tags`, `targeting`, `choice` | One effect, same meanings as section 4 | Same |
| `castSpeed` | `instant` default or `sorcery`. Field is named differently from card casting's `speed`. | Copied by loader; does not turn a trigger into a manually cast action. |
| `cost` | Cost object from section 3; default no cost | Not an ordinary paid activation; do not use. |
| `alternativeCosts`, `additionalCost` | Same route rules as casting | Rejected by loader. |
| `numericDeclarations` | Ability-local announced values; separate from card declarations | Rejected by loader. |
| `limitPerTurn` | Positive integer usage limit | Positive integer trigger usage limit. Not a nonstacking/once-across-all-copies rule. |
| `modes`, `modeCount` | Same shape as card modes | Same; chosen during trigger scheduling. |
| `duration` | Legacy field retained on the ability, but not a general effect lifetime switch. Use the action's supported `params.duration`; `GRANT_STATS` is always end of turn. | Not copied as a trigger lifetime field. |
| `triggerCondition` | Not used | Event name below; defaults to `ON_ENTER_BATTLEFIELD` if omitted. Always write it explicitly. |
| `trigger` | Not used | Filter object below. |
| `interveningIf` | Not used | Rule condition checked when triggered and again before resolution. |

Ordinary activated abilities start from battlefield permanents. An untargeted self `ADD_MANA` ability with the supported costs is recognized as a mana ability and resolves immediately, without a stack response window. Such mana abilities do not support numeric declarations or alternative/additional cost routes.

For a mana ability, `params` also accepts `{ "colors": ["red", "green"], "amount": 1 }` to offer a color choice; the amount defaults to 1. This is handled by the mana-activation path. Ordinary resolving `ADD_MANA` effects use the single `color` field shown in section 4.

### Trigger event names

| `triggerCondition` | Engine event / meaning |
|---|---|
| `ON_ENTER_BATTLEFIELD` | `PERMANENT_ENTERED`; entering the battlefield, including a noncreature permanent. |
| `ON_LEAVE_BATTLEFIELD` | `PERMANENT_LEFT`; any departure. |
| `ON_DIE` | `PERMANENT_DIED`; battlefield to graveyard, not every departure. |
| `ON_ATTACK` | `ATTACK_DECLARED`; attack declaration, not combat damage. |
| `ON_BLOCK` | `BLOCK_DECLARED`; block declaration. |
| `ON_DAMAGE_TAKEN` | `DAMAGE_TAKEN`; damage recipient event. |
| `ON_DAMAGE_DEALT` | `DAMAGE_DEALT`; damage source event. |
| `COMBAT_DAMAGE` | `COMBAT_DAMAGE_RESOLVED`; completed combat-damage pass, not an alias for a single source's damage. |
| `ON_DRAW`, `ON_DISCARD`, `ON_SHUFFLE` | `CARD_DRAWN`, `CARD_DISCARDED`, `LIBRARY_SHUFFLED`. |
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

Operations: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `includes` (left array contains right value). Compose with `{ "all": [...] }`, `{ "any": [...] }`, `{ "not": condition }`. Operands can be string/number/boolean/null, `{ "path": "..." }`, or numeric expressions. Available roots are `source`, `controller`, `event`, `history`; event data depends on the event type. `trigger.condition` gates discovery only; `interveningIf` also rechecks at resolution. See [trigger conditions/history](../../docs/development/4.4-delayed-conditions-and-history.md) for context details.

## 6. Choices

`choice` is on an effect, or flattened onto a nonstatic raw ability. `prompt` is an optional player-facing string on every kind.

| `kind` | Other fields | Behavior |
|---|---|---|
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

For resolved `CREATE_CONTINUOUS_EFFECT` / `SET_STATS`, durations are `PERMANENT`, `END_OF_TURN`, `WHILE_ON_BATTLEFIELD`, `WHILE_ATTACHED`. Attachment-dependent lifetime does not provide an attachment action. Resolved stat values/recipient incarnations are captured when created; static definitions recalculate. See [continuous effects](../../docs/continuous-effects-engine.md).

## 8. Numeric values and X

Prefer plain numbers for fixed values. An expression has the explicit wrapper `{ "numeric": expression }`:

| Expression | Exact fields |
|---|---|
| Announced value | `{ "kind": "binding", "name": "X" }` |
| Addition | `{ "kind": "add", "left": numericValue, "right": numericValue }` |
| Multiplication | `{ "kind": "multiply", "left": numericValue, "right": numericValue }` |
| Field query | `{ "kind": "query", "id": "field", "args": { "path": "source.power" } }` |
| Count query | `{ "kind": "query", "id": "count", "args": { "scope": { "zones": ["battlefield"], "controller": "self", "cardTypes": ["Creature"] } } }` |

`left`/`right` can be numbers or wrapped expressions. There is no subtraction/division/if expression; multiply by `-1` to negate. Only registered queries exist; these are data, not evaluated JavaScript strings.

Card `numericDeclarations` own card spell costs/effects/modes. Activated ability declarations own that ability's costs/effects/modes. Bindings are chosen before payment and retained on the stack; ordinary triggers/static abilities do not inherit a card's X. A generic cost permits bindings/add/multiply, **not live queries**. Numeric expressions are supported in top-level effect `params` values, rule-condition operands and continuous stat fields; not in arbitrary nested objects, printed P/T, colored costs, target bounds or distribution totals. Continuous stats also retain the compatibility form `{ "count": scope, "multiply": 2, "add": 1 }`.

Resolution field queries can read `source`, first valid `target`, `controller`, `event` (trigger only) and `history` where available. Static contexts expose source/target characteristics; do not assume an event/history exists there. Each consumer owns evaluation timing. A missing field is not silently zero. Legacy top-level `DYNAMIC:source.power`, `DYNAMIC:source.toughness`, `DYNAMIC:target.power`, `DYNAMIC:target.toughness`, and trigger `DYNAMIC:event.…` markers remain; prefer the shared numeric format for new numeric definitions. See [numeric contracts](../../docs/development/8.4-numeric-values.md).

## 9. Advanced replacement definition shape

Inside `CREATE_REPLACEMENT_EFFECT.params.definition`, fields are `label` (string), `operation`, optional `match`, `selfReplacement`, `optional` (booleans), `duration` (`permanent`, `end_of_turn`, `while_source`), `expiresTurn` (number), `remaining` (finite damage shield amount), and `uses` (finite event uses). IDs and source references are assigned by the engine. Selected card/player recipients are bound into the match.

| `operation.type` | Other operation fields |
|---|---|
| `damage_scale` | `factor` number |
| `prevent_damage` | Optional `amount` number |
| `redirect_damage` | `recipient`: runtime damage recipient (`kind: "player"`, `playerId`; or `kind: "permanent"`, `cardUuid`, `zoneRevision`) |
| `move_destination` | `to`: destination zone |
| `cancel_event`, `regenerate` | None |

`match` supports `kinds` (array of `damage`, `zone_transfer`, `destroy`, `sacrifice`, `discard`, `draw`, `life_change`, `poison`, `counter_change`), `cardTypes`, `from`, `to`, `combat`, and exact runtime `playerId`, `controllerId`, `card`/`source` references (`{ cardUuid, zoneRevision }`). A raw match does not have a relative `controller: "opponent"` field; use supported target binding rather than hardcoding match IDs. These are advanced existing engine contracts; see [replacement/prevention](../../docs/proposed-events-engine.md).

## 10. Adding a card

1. Copy the closest [annotated example](card_data.example.jsonc), remove comments, and insert its entry into `card_data.json` with unique IDs.
2. Check the action spelling, recipient type, mana symbols and timing. Keep printed text and executable instructions consistent; mark partial support explicitly.
3. Add the card's outer key to the selected deck in [central config](../config.ts). Documentation examples are not automatically playable cards.
4. Restart the server and exercise the normal cast/activation/trigger flow. Reading successfully is not proof that an effect works.

Current real-card examples include `empire-servant`, `flame-fangs`, `worlds-rebel`, and `awakened-blood-mountain`. The [ST01A support report](../../docs/development/vertical-refinement/07-st01a-card-consumers.md) records mechanics that cannot yet be authored honestly, including Scorch, reveal consumers, Chain suppression and equipment attachment. Do not add arbitrary fields or disguise those gaps as unrelated modes/triggers.

Source of truth: [loader](card-parser.ts), [card types](../types/card.types.ts), [effects/targets/choices](../types/effect.types.ts), [registered effect handlers](../engine/effect-registry.ts), [static operations](../types/continuous-effect.types.ts), [numeric definitions](../engine/numeric-definitions.ts). When these change, update this reference and its examples together.
