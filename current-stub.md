# Stubs in the Project

Basic inventory of stub / not-implemented code. No detail analysis.

## Source stubs (`src/engine/`)

| File | Class | Status | Description |
|---|---|---|---|
| `src/engine/event-bus.ts` | `EventBus` | Stub | Logs all events; `on()` is a no-op registration placeholder. Future: trigger/replacement effect system. |
| `src/engine/modifier-pipeline.ts` | `ModifierPipeline` | Stub | Value-transformation modifiers. `apply()` returns effect unchanged (identity transform). Future: cost reducers, flash granters, target modifiers. |
| `src/engine/modifier-registry.ts` | `ModifierRegistry` | Stub | Permission-check modifiers. `canPlay()` and `canTarget()` always return `true`. Future: hexproof, shroud, protection, "can't play" restrictions. |

## Legacy JS stub

| File | Function | Status |
|---|---|---|
| `public/game.js` | `io()` | Throws `"Function not implemented."` (legacy reference file, not used) |

## Documented stubs / planned features (`ARCHITECTURE.md` §1.2)

| Area | Status |
|---|---|
| Modifier system (`ModifierRegistry` / `ModifierPipeline`) | 🔶 Stub (identity/no-op) |
| P/T modification (`MODIFY_STATS`) | 🔶 Partial — damage only; power/toughness buffs silently ignored (TODO in code) |
| Death/destroy triggers (`PERMANENT_LEFT`, `ON_DIE`) | ❌ Not started |
| Upkeep/phase triggers (`TURN_STARTED`, `PHASE_CHANGED`) | ❌ Not started |
| Activated abilities (non-mana) | 🔶 Partial — options computed, no handler registered |
| Multi-target selection | 🔶 Partial — auto-confirm for single-target deferred |
| Counter-spell card | ❌ Not started |
| Graveyard interaction | ❌ Not started |
| Enchantments/Artifacts | ❌ Not started |
| Server handler extraction (`server.ts`) | ❌ Not started |

## Related test references

- `tests/engine/event-bus.test.ts` — tests `on()`/`emit()` as stub
- `tests/engine/game-reducer.test.ts` — no-op behaviors (card not found, empty stack, etc.)