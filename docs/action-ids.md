# Action IDs — Single Source of Truth

> **Why this doc exists:** Action IDs are free-form strings at the registry level
> (`ActionType = string` in `src/types/effect.types.ts`), so the engine stays
> extensible. But the **known** set of player actions is closed, and a mismatch
> between what a client sends and what a handler expects throws
> `No handler registered for action: <id>` at runtime.
>
> **The fix:** The known action IDs now live in **one shared module** —
> `src/types/action.ids.ts` — which exports:
> - `ACTION_IDS` — a `const` object of the 7 known IDs (compile-time literal)
> - `ActionId` — a closed union type derived from `ACTION_IDS`
> - `ActionIdOrAbility` — `ActionId | \`activateAbility_${string}\`` (known + dynamic)
> - `ACTION_ID_LABELS` — human-readable display labels (used by `GameLog`)
>
> Every producer and consumer imports from this module. **If you add, rename, or
> remove an action ID, change it in `action.ids.ts` and every reference updates
> automatically** — a typo anywhere in the chain is now a **compile error**, not a
> runtime crash.

## The action ID table

| Action ID | `ACTION_IDS` key | Emitted by (producer) | Registered handler (consumer) | Notes |
|-----------|------------------|----------------------|-------------------------------|-------|
| `cast_spell` | `castSpell` | `OptionService.getHandOptions()` · `CardComponent.handleClick()` | `playCardHandler` | Cast a card from hand onto the stack |
| `attack` | `attack` | `OptionService.getBattlefieldOptions()` | `attackHandler` | Declare a creature as attacker |
| `tapForMana` | `tapForMana` | `OptionService.getBattlefieldOptions()` | `tapForManaHandler` | Mana ability (CR 605) — bypasses the stack |
| `end_turn` | `endTurn` | `PhaseBar` | `endTurnHandler` (special-cased in `server.ts`) | Ends the active player's turn |
| `pass_priority` | `passPriority` | `PhaseBar` | `passPriorityHandler` (special-cased in `server.ts`) | Passes priority (MTG 116) |
| `resolve_stack` | `resolveStack` | `PhaseBar` | `resolveStackHandler` (special-cased in `server.ts`) | Resolves the top of the stack |
| `rpsPlay` | `rpsPlay` | `CardComponent.handleClick()` (RPS phase) | `rpsPlayHandler` | Play a rock/paper/scissors card |

## Where each ID lives

### The shared source of truth

| File | What it provides |
|------|------------------|
| `src/types/action.ids.ts` | `ACTION_IDS` const, `ActionId` union, `ActionIdOrAbility` union, `ACTION_ID_LABELS` |

### Producers (who sends the ID)

| File | Location | IDs emitted |
|------|----------|-------------|
| `src/engine/option-service.ts` | `getHandOptions()` | `ACTION_IDS.castSpell` |
| `src/engine/option-service.ts` | `getBattlefieldOptions()` | `ACTION_IDS.tapForMana`, `ACTION_IDS.attack`, `activateAbility_<EFFECT_ID>` |
| `src/client/components/CardComponent.tsx` | `handleClick()` | `ACTION_IDS.rpsPlay` (RPS phase), `ACTION_IDS.castSpell` (hand) |
| `src/client/components/PhaseBar.tsx` | button `onClick` | `ACTION_IDS.endTurn`, `ACTION_IDS.passPriority`, `ACTION_IDS.resolveStack` |
| `src/client/components/ContextMenu.tsx` | `handleAction()` | forwards whatever `OptionService` returned |

### Consumers (who handles the ID)

| File | Location | IDs handled |
|------|----------|-------------|
| `src/server.ts` | `ACTION_HANDLERS` map (top of file) | all 7 `ActionId`s, keyed by `ACTION_IDS` |
| `src/server.ts` | `playerAction` socket handler `switch` | `ACTION_IDS.endTurn`, `ACTION_IDS.passPriority`, `ACTION_IDS.resolveStack`, `ACTION_IDS.rpsPlay` (special-cased); everything else → `engine.proposeAndStack` |
| `src/engine/action-registry.ts` | `ActionRegistry` map | `cast_spell`, `attack`, `tapForMana` (via `proposeAndStack`) |
| `src/client/components/GameLog.tsx` | `ACTION_ID_LABELS` (imported from shared) | display labels for all IDs |

## Special cases & gotchas

### 1. `activateAbility_<EFFECT_ID>` is dynamic
`OptionService` emits `activateAbility_${ability.effect.effectId}` for **non-mana** activated
abilities. There is no static handler for these yet — they flow through the `default` branch
of `server.ts` → `engine.proposeAndStack`. If you add a handler for a specific effect, keep
the `activateAbility_<EFFECT_ID>` prefix stable.

### 2. Pure mana abilities are folded into `tapForMana`
Per MTG CR 605, mana abilities bypass the stack. `OptionService` therefore **skips**
`activateAbility_*` for pure mana abilities (`ManaPool.isPureAbility`) and emits a single
`tapForMana` option instead. Do **not** emit both — that creates a duplicate option.

### 3. `end_turn`, `pass_priority`, `resolve_stack` bypass the registry
These are handled directly in the `switch` in `server.ts`, **not** via `ActionRegistry`.
They are still registered in the `ACTION_HANDLERS` map for completeness, but the switch runs
first.

### 4. `rpsPlay` is phase-gated
`rpsPlay` is only valid during the RPS phase. `server.ts` checks
`currentRoom.rpsState.status === 'resolved'` after handling it to decide whether to emit a
full `roomSnapshot`.

### 5. `ActionType = string` stays open
`src/types/effect.types.ts` keeps `ActionType = string` as the **registry key type** for
extensibility (future action kinds, dynamic ability IDs). The closed `ActionId` union is the
**known** set. This mirrors MTG: the rules define a fixed set of player actions, but new card
abilities extend the space dynamically.

### 6. Runtime guard (defense-in-depth)
`src/engine/action-service.ts` logs a warning (`action:unknown`) when an unknown ID arrives,
before returning the generic "No handler registered" error. The type system catches errors at
**compile time** (developer); the guard catches errors at **play time** (stale client,
malformed packet, future card). Both are needed — types are the rules text, the guard is the
judge.

## How to verify a change

1. Change the ID in `src/types/action.ids.ts` (the `ACTION_IDS` const). The `ActionId` union
   and every producer/consumer that references `ACTION_IDS` or `ActionId` updates automatically.
2. Run the test suite — `tests/engine/option-service.test.ts` asserts the exact action IDs
   emitted for hand and battlefield cards (including the no-duplicate-mana-ability rule).
3. Run the manual smoke test in `docs/smoke-test-rps.md` and confirm no
   `No handler registered for action` appears in the server log.