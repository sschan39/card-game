# Counter-owned rules

The card instance stores quantities in `card.state.counters`. An optional entry in [counters-v1.json](../packages/engine/src/config/rules/counters-v1.json) supplies intrinsic behavior for a counter type. A counter without an entry remains a marker that card effects can place, remove, pay with, or query.

```ts
type CounterDefinitions = Record<string, { maxPerCard?: number, rules: ModifierDefinition[] }>
```

The loader requires a safe counter identifier and a nonempty `rules` list. Each rule uses the existing strict `ModifierDefinition` union and its family-specific validation, including condition paths, scopes, operation compatibility, and usage. Rule IDs must be unique within each counter definition. An optional positive integer `maxPerCard` caps placement at the reducer, including multi-counter placements. A placement at the cap produces no counter change event. The holder supplies source identity and effective controller. Existing scope fields determine who receives the effect. Definitions are versioned with the game configuration.

Counter rules are discovered from the current battlefield holder. The engine derives rules from the current count, so placing counters only updates the card state. The engine uses the existing characteristic layers, permission checks, cast cost rules, and proposed-event replacement handlers. It does not persist a separate grant for each placement. A characteristic rule can grant an ordinary ability, which then uses the normal trigger, activation, or static-rule pipeline. Rules intrinsic to the counter remain even when a card loses its printed abilities.

A scope with `self: true` applies to the holder. A scope with `attachedToSource: true` applies to the holder's current equipped creature and checks the host's zone revision. Equipment changes and card movement keep using the existing attachment and zone rules. A resolved effect with a duration or pinned recipients still uses the existing continuous-effect path.

For quantity, read `card.state.counters[type] ?? 0` on one card or use `counterTotal` over a card scope. Card filters also support a `counter` constraint. For rule discovery, `counterRulesFor(holder)` returns the holder's configured sources. `activeRules(room)` includes their definitions and holder identities, and `ruleUse` and `ruleUseAvailable` read the same budget that the rule consumers use. A discovered rule still has to pass its event or target filters and conditions. Granted abilities are visible in the host's effective characteristics.

Existing Scorch and stat-counter consumers continue to own their existing rules and timing.

| Counter ID | Behavior |
| --- | --- |
| `aurora` | The marked creature prevents up to 3 damage from the first damage event it can change while marked. The existing `game` budget uses `source_incarnation` and `on_change`, so taking unpreventable damage preserves the shield. Additional counters, reapplication, and new turns leave the spent budget intact. A card that leaves and returns needs a new counter and has a fresh budget. |
| `frost-gear` | At most one per card. The marked equipment grants its current host an ordinary self-attack trigger that draws one card for the host's controller. Detaching, reattaching, and removing the counter affect future triggers through the existing attachment and characteristic rules. |

The workbook describes a once-per-turn Aurora shield. The current ruling uses the one-time shield above. Revisit the shared Aurora behavior in a later pass, including whether the shield's cadence belongs to the counter itself or to the card that grants it. 巨龍之墓 uses the current shared counter rule.
