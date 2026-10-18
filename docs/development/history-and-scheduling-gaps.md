# Gameplay history, retained values and scheduling gaps

16 October 2026. Source baseline `b4a67ab`; source inspection, not a new engine implementation or test run. This records the history discussion and keeps the missing contracts separate from the [workbook's actual consumer requirements](workbook-mechanics-review.md).

## Current storage

| Owner | Contents | Retention / purpose |
|---|---|---|
| `GameRoom.turnHistory` | Selected semantic event records; global and per-player occurrence counts; ability uses; land plays | Current turn only. Replaced on actual turn advancement. Rules can query supported fields. |
| Triggered stack object | Its `triggeringEvent`, original event payload and source information | Retained with that trigger. Later events do not overwrite it. |
| Engine applied-event buffer | Committed batches, mutations and before/after room references | Drained for publication; not a permanent whole-game history. |
| `data/deltas.jsonl` | Unfiltered published state deltas and recorded semantic batches with command/batch/event IDs | Append-only diagnostic record. The reader returns delta records; it does not automatically restore/re-execute a room. |
| Client game log | Last 100 readable action summaries | UI state, cleared when a full room snapshot is applied. Not authoritative rules history. |
| `InMemoryStore` | Current live rooms, including current-turn history | Browser reconnect can recover a still-live room. Server restart loses these rooms. Disk logging does not currently provide automatic recovery. |

`turnHistory` has this existing shape:

```typescript
{
  turnNumber,
  events,       // TriggeringEvent[]: eventId, payload and correlation IDs
  counts,       // event ID -> occurrence count across players
  playerCounts, // attributed player -> event ID -> occurrence count
  uses,         // source UUID : zone revision : ability ID -> uses this turn
  landPlays     // player -> ordinary land plays this turn
}
```

The current whitelist records entry, departure, death, draws, shuffles, discards, spell casts, life gain/loss, damage taken/dealt, attacks, blocks, upkeep/end-step and combat-damage passes. Other canonical engine events are not automatically added to this rules history. Per-player attribution uses the event's controller/player/current-player field; it is not a general source/recipient index. A per-player record can be absent until that player has a tracked event.

The engine commits operations, derives canonical actual events, updates chronological turn history, and discovers triggers against those event contexts. Simultaneous SBA departures observe the complete departure batch's history. An event-count condition is therefore not a general “Nth occurrence since this effect was created” instruction, particularly for simultaneous events.

## Counts, amounts and captured values

Two `DAMAGE_DEALT` events with amounts 3 and 4 give `counts.DAMAGE_DEALT = 2`. The event records retain those amounts, but card JSON has no aggregate operation that sums them to 7. Global here means the room's current turn, not all matches or the whole game.

| Needed capability | Existing support | Missing piece |
|---|---|---|
| Current card count in a zone | `count` query with supported scope filters | Richer filters/relations only when a consumer needs them. |
| The amount of the damage that triggered an ability | `field` query of retained `event.payload.amount` | No binding is required to read that same retained event again. |
| A player's announced X | `numericDeclarations` and `binding` | Already retained for the casting/activated action. |
| Save a state query once, then reuse it after earlier instructions change state | No general query-to-binding assignment | An explicit capture point and resolution-local named result/value. |
| Read which cards a previous reveal/mill instruction processed | Not an authored result-set contract | Retain exact references and the attributes required by the next instruction, scoped to that resolution. |
| Sum/filter event quantities | Raw current-turn records exist | No authored quantity aggregate or indexed totals. |
| Previous-turn / whole-game totals | No rules-queryable longer history | Explicit retention scope and actual consumer. |
| Once per game / shared usage budget | Only per-turn per-source-incarnation uses | Game-scoped usage storage and a defined key policy. |
| “After N events since registration” | Delayed triggers match future events, but have no independent occurrence counter | Registration-local progress/baseline, actual-event matching and expiry. |

Repeating a state query in two effects recalculates it. With hand size 3, “draw current hand size; draw current hand size” reads 3, then 6, assuming sufficient library cards and no replacement changes. Naming a player declaration `handSize` still asks the player to choose it. It does not capture a query.

Do not solve local reveal/mill dependencies by adding all card data to permanent global history. A local result context is smaller and preserves which instruction actually produced the result. Existing `OperationOutcome` distinguishes semantic commitment from rejection/no change, but does not yet expose card-authorable destruction success, moved-card sets or reveal results to following instructions.

## Duration and delay support

| Behavior | Current support / gap |
|---|---|
| +2/-2 until end of turn | Existing stat delta / `GRANT_STATS`. |
| Continuous bonus while its static ability applies | Existing static scope/layer evaluation. |
| At the next matching own upkeep/end-step event | Existing one-shot delayed trigger, with a supported controller filter. `once` means consumed by its first matching trigger, not a one-turn timer. |
| Bonus for this combat only | No general combat-boundary lifetime in the current duration union. |
| Until the opponent's next start | No authored retained relative boundary for an effect's expiry. |
| Skip a target's next ready/untap opportunity | No readiness suppression/one-opportunity consumption rule. Expiry alone does not prevent untapping. |
| For X turns, or apply after X turns | No general countdown anchored to creation and a retained X. |
| After X matching events across turns | No registration-local event countdown. |

Scheduling must distinguish both players' turns, own turns, a full round, start/end of a phase, and combat end. It must also distinguish expiry from a delayed action and from suppressing a specific future action. A single integer named `turns` cannot safely stand for all three.

## What the workbook needs first

The [workbook review](workbook-mechanics-review.md) identifies concrete consumers for local reveal/mill results, destruction/departure reasons, game-scoped limits, shared limits and relative phase/combat boundaries. These are stronger immediate requirements than a universal game-long event archive.

Recommended constraints for future work:

1. Add only the missing fact/result/boundary required by the selected real card. Define when it is recorded and when it expires.
2. Keep action-local results with the existing resolution continuation; retain trigger event snapshots with their triggers. Preserve them through a paused choice/reconnect.
3. Store once-per-game budgets outside resettable turn history. Decide whether the key is a physical card UUID, an incarnation, or a controller/family rule; do not infer that from wording alone.
4. Use canonical committed events, including replacement/prevention outcomes. A proposal or a rejected command must not advance counters or consume budgets.
5. Do not query JSONL for live card rules. Keep disk logging, readable UI logs and rules facts separate.
6. Do not build whole-game damage aggregation, arbitrary N-event timers or restart recovery until a consumer is selected for them.

## Storage/performance limitations

Event payloads can contain substantial card/stack snapshots. The growing current-turn history is copied into room state and synchronization/logging; the JSONL writer has no rotation/retention policy. These are size/performance follow-ups, not evidence that card rules should depend on disk logs. Do not remove retained information until its rule consumers and paused continuations are accounted for.

Durable room snapshots, restart-safe sequence recovery, deterministic full-game reconstruction and log compaction remain separate work. No database, event-sourcing framework, new privacy boundary or archive migration is proposed for the next card slice.

## Source map

- [`turn-history.ts`](../../src/engine/turn-history.ts), [`trigger.types.ts`](../../src/types/trigger.types.ts): retained fields, whitelist, uses and attribution.
- [`game-engine.ts`](../../src/engine/game-engine.ts), [`game-reducer.ts`](../../src/engine/game-reducer.ts): actual event chronology and turn reset.
- [`effect-resolver.ts`](../../src/engine/effect-resolver.ts), [`numeric-definitions.ts`](../../src/engine/numeric-definitions.ts): available query context, binding ownership and evaluation timing.
- [`sync-service.ts`](../../src/server/sync-service.ts), [`state-store.ts`](../../src/server/state-store.ts), [`gameStore.ts`](../../src/client/store/gameStore.ts): disk log, memory store and client summaries.
- [Card authoring examples and limitations](../../src/library/README.md#8-numeric-values-and-x).
