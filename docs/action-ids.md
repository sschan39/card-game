# Action IDs — Single Source of Truth

> **Why this doc exists:** Action IDs are free-form strings (`ActionType = string` in
> `src/types/effect.types.ts`), so there is **no compile-time enforcement** that the ID a
> client sends matches a registered handler. A mismatch throws
> `No handler registered for action: <id>` at runtime. This doc is the canonical registry
> linking every action ID to its producer (who emits it) and its consumer (who handles it).
>
> **Rule:** When you add, rename, or remove an action ID, update this table **in the same
> change**. If an ID appears in more than one place, all occurrences must stay in sync.

## The action ID table

| Action ID | Emitted by (producer) | Registered handler (consumer) | Notes |
|-----------|----------------------|-------------------------------|-------|
| `cast_spell` | `OptionService.getHandOptions()` · `CardComponent.handleClick()` | `playCardHandler` | Cast a card from hand onto the stack |
| `attack` | `OptionService.getBattlefieldOptions()` | `attackHandler` | Declare a creature as attacker |
| `tapForMana` | `OptionService.getBattlefieldOptions()` | `tapForManaHandler` | Mana ability (CR 605) — bypasses the stack |
| `end_turn` | `PhaseBar` | `endTurnHandler` (special-cased in `server.ts`) | Ends the active player's turn |
| `pass_priority` | `PhaseBar` | `passPriorityHandler` (special-cased in `server.ts`) | Passes priority (MTG 116) |
| `resolve_stack` | `PhaseBar` | `resolveStackHandler` (special-cased in `server.ts`) | Resolves the top of the stack |
| `rpsPlay` | `CardComponent.handleClick()` (RPS phase) | `rpsPlayHandler` | Play a rock/paper/scissors card |

## Where each ID lives

### Producers (who sends the ID)

| File | Location | IDs emitted |
|------|----------|-------------|
| `src/engine/option-service.ts` | `getHandOptions()` | `cast_spell` |
| `src/engine/option-service.ts` | `getBattlefieldOptions()` | `tapForMana`, `attack`, `activateAbility_<EFFECT_ID>` |
| `src/client/components/CardComponent.tsx` | `handleClick()` | `rpsPlay` (RPS phase), `cast_spell` (hand) |
| `src/client/components/PhaseBar.tsx` | button `onClick` | `end_turn`, `pass_priority`, `resolve_stack` |
| `src/client/components/ContextMenu.tsx` | `handleAction()` | forwards whatever `OptionService` returned |

### Consumers (who handles the ID)

| File | Location | IDs handled |
|------|----------|-------------|
| `src/server.ts` | `registerAction(...)` (top of file) | `cast_spell`, `attack`, `tapForMana`, `end_turn`, `pass_priority`, `resolve_stack`, `rpsPlay` |
| `src/server.ts` | `playerAction` socket handler `switch` | `end_turn`, `pass_priority`, `resolve_stack`, `rpsPlay` (special-cased); everything else → `engine.proposeAndStack` |
| `src/engine/action-registry.ts` | `ActionRegistry` map | `cast_spell`, `attack`, `tapForMana` (via `proposeAndStack`) |
| `src/client/components/GameLog.tsx` | `ACTION_LABELS` map | display labels for all IDs |

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
They are still registered with `registerAction` for completeness, but the switch runs first.

### 4. `rpsPlay` is phase-gated
`rpsPlay` is only valid during the RPS phase. `server.ts` checks
`currentRoom.rpsState.status === 'resolved'` after handling it to decide whether to emit a
full `roomSnapshot`.

## How to verify a change

1. Update this table and every producer/consumer listed above.
2. Run the test suite — `tests/engine/option-service.test.ts` asserts the exact action IDs
   emitted for hand and battlefield cards (including the no-duplicate-mana-ability rule).
3. Run the manual smoke test in `docs/smoke-test-rps.md` and confirm no
   `No handler registered for action` appears in the server log.