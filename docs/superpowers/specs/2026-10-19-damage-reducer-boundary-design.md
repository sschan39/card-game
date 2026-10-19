# Damage/reducer ownership design

Date: 19 October 2026  
Status: approved under the standing behavior-preserving architecture instruction

## Problem

`game-reducer.ts` and `damage-service.ts` form a runtime import cycle:

```text
game-reducer.ts
  └─ imports applyDamageBatch / validDamageAssignments from damage-service.ts

damage-service.ts
  └─ imports gameReducer from game-reducer.ts
```

The cycle exists because `damage-service.ts` both plans damage and applies the result mutations by
calling the authoritative reducer. State application belongs to the reducer boundary, while damage
planning, assignment validation, and rule-extension hooks belong to the damage rules module.

## Goals

- Remove the runtime cycle between `game-reducer.ts` and `damage-service.ts`.
- Make the reducer the explicit owner of damage-batch state application.
- Preserve one atomic `APPLY_DAMAGE_BATCH` mutation and its current operation outcome.
- Preserve replacement-produced `results`, keyword-derived results, consequence hooks, event
  derivation, state-based checkpoints, and synchronization replay.
- Keep the change small enough to review independently.

## Non-goals

- No damage-rule, combat, replacement, state-based-action, or card behavior changes.
- No redesign of `DamageRuleRegistry` in this slice.
- No general dependency-injection framework or second reducer abstraction.
- No file relocation or broad rules-folder reorganization.
- No change to `GameMutation`, serialized deltas, events, or Socket.IO contracts.

## Considered approaches

### 1. Move damage-batch reduction into `game-reducer.ts` — selected

`damage-service.ts` keeps:

- `DamageRule` and `DamageRuleRegistry`;
- `validDamageAssignments()`;
- `planDamage()`.

`game-reducer.ts` exports a focused `reduceDamageBatch(room, proposed, results?)` helper. The helper
validates assignments, derives default result mutations with `planDamageResults()` when explicit
replacement results are absent, and reduces those results through `gameReducer` in order.

`reduceMutation()` uses the same helper for `APPLY_DAMAGE_BATCH`. `proposed-events.ts` imports the
helper from `game-reducer.ts` for preview/consequence planning.

This establishes one-way runtime dependencies:

```text
damage-service.ts
  ├─ damage-keywords.ts
  └─ card-characteristic-service.ts

game-reducer.ts
  ├─ damage-service.ts (assignment validation)
  └─ damage-keywords.ts (default result planning)

proposed-events.ts
  ├─ game-reducer.ts (ordinary and damage reduction)
  └─ damage-service.ts (rules and validation)
```

### 2. Add a new damage-reduction module — rejected

A new module would still need the reducer to apply nested result mutations. Avoiding the cycle
would require either moving broad reducer internals or accepting a reducer callback. Neither gives
the new file a clean independent responsibility.

### 3. Inject a reducer callback into `applyDamageBatch()` — rejected

This mechanically removes the import but allows callers to supply different reduction semantics,
adds plumbing to every call, and leaves state-application ownership in the damage service.

## Detailed behavior

The new helper has this contract:

```ts
export function reduceDamageBatch(
  room: GameRoom,
  proposed: readonly DamageAssignment[],
  results?: GameMutation[],
): GameRoom
```

It performs exactly the existing steps:

1. Filter the proposed assignments through `validDamageAssignments(room, proposed)`.
2. Return the original room reference when no assignment remains valid.
3. Use supplied `results` exactly when present, including an empty array.
4. Otherwise call `planDamageResults(room, assignments)`.
5. Reduce the resulting mutations in order with `gameReducer`, starting from the original room.

The `APPLY_DAMAGE_BATCH` operation continues to reject when no assignments are valid and otherwise
returns a committed outcome, including semantic commits whose final state is referentially equal.

## Event and replacement ordering

No pipeline order changes:

```text
planDamage
→ replacement planning
→ APPLY_DAMAGE_BATCH with final assignments/results
→ reduceDamageBatch
→ semantic event derivation
→ DamageRuleRegistry consequences
→ rules checkpoint
```

`applied-events.ts` continues to derive damage events from validated assignments and result steps.
`MutationCommitter` continues to publish the outer damage mutation as one atomic batch.

## Tests

The test-first contract will directly import `reduceDamageBatch` from `game-reducer.ts` and prove:

- explicit result mutations are applied in order as one preview operation;
- invalid assignments return the original room;
- the runtime source graph no longer has `damage-service.ts → game-reducer.ts`.

Existing damage pipeline, replacement transaction, operation outcome, applied-event, combat, sync,
and full-suite tests remain the behavior regression evidence.

## Documentation

`ARCHITECTURE.md` will state that damage services plan and validate damage while the reducer owns
atomic application. The architecture audit remains a historical snapshot and will record the cycle
as resolved rather than deleting the original finding.

