# Test Suite Report — Card Game Engine

_Generated: 2026-09-15_

## 1. Overview

| Metric | Value |
|---|---|
| Test files | 28 (`.test.ts`) + 1 helper |
| Total tests | 331 (all passing) |
| Runtime | ~5.8s |
| Runner | Vitest 4.1.10 |
| Environment | `node` (no DOM) |
| Coverage tooling | **None configured** |
| Typecheck | `npx tsc --noEmit` (clean) |

The suite is overwhelmingly **unit-focused on the pure game engine**. It exercises the reducer, state machine, action pipeline, effect system, combat, triggers, and state-based actions in isolation, plus a thin server layer (sync/reconnect/store) and a single client store test. There is **no UI, socket, or end-to-end coverage**.

---

## 2. Test Infrastructure

**`vitest.config.ts`**

```ts
test: {
  globals: true,
  environment: 'node',
  include: ['tests/**/*.test.ts'],
}
```

No `coverage` block, no thresholds, no setup files. `--reporter=basic` is unsupported in Vitest 4.x (use the default reporter).

**`tests/helpers/test-room-factory.ts`** — the single shared helper. `createTestRoom(overrides?)` builds a deterministic `GameRoom`:

- `player1` / `player2`, life 20, 5 of each mana color, empty deck/hand/graveyard
- one `empire-servant` in player1's hand (`zone='hand'`, `ownerId`/`controllerId='player1'`)
- defaults: `phase='stateMainPhase'`, `status='playing'`, `engineState='waiting_for_player'`, `activeTurnPlayerId='player1'`, `priorityPlayerId='player1'`, empty `stack`/`combat`/`battlefield`/`continuousEffectPool`

**Dominant pattern**: tests call a pure function (e.g. `gameReducer`, `sm.advancePhase`) that returns `GameMutation[]`, then a local `apply()` helper folds the mutations into the room object. This mirrors the production mutation pipeline without a live engine.

**Known hazards** (documented in repo memory `/memories/repo/test-patterns.md`):

- Mutation-returning handlers need `ownerId`/`controllerId` set on test cards or `MOVE_CARD` gets `playerId: ''`.
- `GameEngine` tests must read `engine.roomState`, not the stale `room` variable.
- `handleAction` returns mutations but does **not** apply them — call `engine.applyMutations(result.mutations)`.
- Several tests mutate the **shared blueprint cache** (`blueprint.keywords`/`cardTypes`/`id`) and must save/restore — fragile under parallelization.

---

## 3. Coverage by Layer

### Engine — core state (4 files, 94 tests)

| File | Tests | What it covers |
|---|---|---|
| `state-machine.test.ts` | 37 | Initial state; 5 combat-step phase names; ordered transitions; dedicated combat events (`COMBAT_BEGIN`…`COMBAT_ENDED`); valid/invalid transitions; full turn cycle; `CLEAR_COMBAT`; turn switching; priority (`givePriorityTo`, `passPriority` accept/reject, phase advance after both pass); stack as a **zone not a phase**; MTG 116.3d/116.4; LIFO resolution; untap step (untap + clear summoning sickness + reset mana + clear `attackedThisTurn`, active player only); **phase director `advancePhase`** (auto-advance, stop points, defender priority at blockers, turn wrap, `skipToEnd`) |
| `game-reducer.test.ts` | 36 | Player mutations (`SET_LIFE`, `SET_MANA`, `ADD_MANA`, `SPEND_MANA`); card state (`TAP`/`UNTAP`, summoning sickness, damage, counters with floor-at-0); continuous effect pool add/remove/clear; zone moves (`MOVE_CARD` across hand/battlefield/graveyard/stack, `SET_CARD_ZONE`); stack (`PUSH`/`POP`, no-op on empty, `SET_COUNTERED`); combat (`DECLARE_ATTACKERS`, `ASSIGN_BLOCKERS`, `CLEAR_COMBAT`); phase/turn/RPS mutations; **immutability** (input untouched, untouched subtrees shared by reference) |
| `game-engine.test.ts` | 13 | `handleAction` (valid/unknown/validation-fail); `proposeAndStack`; `resolveTopOfStack` (+ empty-stack failure); event emission (`PERMANENT_LEFT` only on battlefield→graveyard, `REMOVE_CONTINUOUS_EFFECT`, `LIFE_CHANGED`); combat declaration recording; **full turn play loop** (land → mana → creature → attack) |
| `event-bus.test.ts` | 8 | Instance creation; `on`/`emit` no-throw; logging via `engineLogger.debug`; listener invocation; multiple listeners in order; event isolation; emit with no listeners |

### Engine — actions & validation (4 files, 71 tests)

| File | Tests | What it covers |
|---|---|---|
| `action-registry.test.ts` | 4 | Register/retrieve, multiple types, undefined for unregistered, override |
| `action-service.test.ts` | 7 | `handleAction` (valid/unknown/validation-fail); `proposeAndStack` (returns `PUSH_STACK`, no push on failure); `resolveTopOfStack` |
| `action-validator.test.ts` | 30 | `canPayCost` (mana color/quantity, life, tap, **CR 302.6** sick creature + `{T}` rejected, discard, colorless); `canActivate` (zone, sorcery speed vs non-empty stack, priority); `canTarget` (min/max, wrong type, not on battlefield, cardTypes, player targets, controller filters) |
| `option-service.test.ts` | 12 | Hand cards (`cast_spell` with/without mana, empty for missing card, **regression: no stale `playCardAction`**, `hidden` flag); battlefield (`tapForMana` untapped/tapped, no duplicate `activateAbility_*` for mana abilities, **regression: no stale `tapForManaAction`**, non-mana abilities still emit, no attack option) |

### Engine — effects (3 files, 56 tests)

| File | Tests | What it covers |
|---|---|---|
| `effect-registry.test.ts` | 22 | `DRAW` (N, partial), `MODIFY_LIFE`, `MODIFY_STATS` (→ layer-7 `STAT_DELTA` `END_OF_TURN`), `ADD_MANA`, `TAP`/`UNTAP`, `MOVE_ZONE` (incl. stack→graveyard `counter` tag), `DESTROY`, counters, `GRANT_STATS` (single-target, anthem `all:true`, power-only, skip no-uuid, emblem fallback) |
| `effect-resolver.test.ts` | 22 | `resolveEffects` (single/multiple in order, `STACK_ITEM_RESOLVED`, skip countered, skip invalid targets, `DYNAMIC:source.power`); `revalidateTargets` (keep/drop permanents, players, stack targets, expand `all:true`, controller filter, **fizzle when required**, resolve with remainder); `buildDynamicParams`; `buildStackEffects` |
| `card-characteristic-service.test.ts` | 12 | `resolvePower`/`resolveToughness` (blueprint, `STAT_DELTA` sum, `+1/+1` counters, ignore non-`STAT_DELTA`, non-creatures → 0); `hasValidSourceZone` (emblem, requiredZone); `matchesScope` (cardUuid, cardTypes, controller) |

### Engine — combat (5 files, 34 tests)

| File | Tests | What it covers |
|---|---|---|
| `declare-attackers-handler.test.ts` | 10 | Validate (phase, active player, empty, tapped, sick, already-attacked, duplicate, non-creature); propose (taps all, marks `attackedThisTurn`, emits `DECLARE_ATTACKERS`) |
| `declare-blockers-handler.test.ts` | 13 | Validate (phase, active player can't block, wrong battlefield, tapped, non-creature, missing attacker, duplicate blocker, **non-flying vs flying rejected**, flying vs flying allowed, empty allowed); propose (`ASSIGN_BLOCKERS`, blocker **not** tapped per CR 509.1f) |
| `combat-damage-step.test.ts` | 3 | Unblocked → player damage; blocked ↔ mutual damage; trample excess to player |
| `combat-integration.test.ts` | 3 | Full flow declare→block→damage→SBA→death trigger (injected `ON_DIE` DRAW); attack the face; mutual destruction |
| `combat-pipeline-smoke.test.ts` | 3 | Auto-advance through all 5 steps, turn completes to player2, events in exact order, empty stub payloads, `CLEAR_COMBAT` |
| `battle-phase-smoke.test.ts` | 5 | Replicates server's phase-aware End Turn flow with local helpers; main→battle, attack applies damage, battle→next-turn clears combat, attack rejected outside battle, empty blockers complete turn |

### Engine — triggers, SBA, RPS, room setup (5 files, 38 tests)

| File | Tests | What it covers |
|---|---|---|
| `trigger-manager.test.ts` | 7 | `PERMANENT_ENTERED` + `onEnterEffects` → `PUSH_STACK`; no push without effects; self-target auto-fill; `ATTACK_DECLARED` + `ON_ATTACK`; `dispose()`; `ON_DIE`; `ON_DAMAGE_TAKEN` |
| `state-based-actions.test.ts` | 8 | Empty when undamaged; destroy at `damageTaken >= toughness`; no destroy below; multiple destructions; game-over at life ≤ 0 / negative; no game-over positive; toughness respects continuous effects |
| `rps-play-handler.test.ts` | 14 | Validate (phase, missing/not-in-hand/already-played/not-RPS); propose (record + move to graveyard); `resolveRPS` (rock/scissors/paper/tie, discard remaining = 4 `MOVE_CARD`); **post-RPS regression** (4-card hands, 5-card decks, valid uuids, `zone='hand'`) |
| `room-factory.test.ts` | 5 | `buildTestDeck` (9 cards, `zone='library'`, ownership, shuffled); `dealStartingHands` (4 each, 5 left, valid uuid, clears prior hand); `setupRPS` (3 RPS cards, `status='RPS'`) |
| `end-turn-handler.test.ts` | 4 | Allow when stack empty; reject non-empty stack; reject during RPS |
| `enter-battle-handler.test.ts` | 5 | Allow from main phase empty stack; reject non-empty stack; reject RPS; reject not-your-turn; reject outside main phase |

### Server (3 files, 26 tests)

| File | Tests | What it covers |
|---|---|---|
| `sync-service.test.ts` | 9 | `buildDelta`+`broadcast` (emit `stateDelta`, `oldValue`/`value`, no changes for empty, incrementing `seq`, write `deltas.jsonl`); `filterForPlayer` (redact opponent hand → `handCount`, drop opponent deck, pass own hand); `replay` (read from log). Uses `fs.mkdtempSync` + mock `io` |
| `reconnect.test.ts` | 11 | Identity maps (`bindSocket`, `resolvePlayerId`/`resolveSocketId` with fallbacks, rebinding, unbind); `decideRejoin` (rejoin member/player2, `room_destroyed`, `not_a_member`) |
| `state-store.test.ts` | 6 | `InMemoryStore` save/get/delete/list/overwrite/no-throw on missing delete |

### Client (1 file, 6 tests)

| File | Tests | What it covers |
|---|---|---|
| `gameStore.test.ts` | 6 | Session persistence (`setRoomId` → `sessionStorage`, `setMyPlayerId`, `clearSession`); `selectHasPriority` (true when priority + `waiting_for_player`, false while resolving). Hand-rolled `sessionStorage` mock (node env) |

---

## 4. Scope — What Is Genuinely Verified

- **MTG priority rules**: 116.3b (active player after resolve), 116.3d (caster gets priority), 116.4 (auto-resolve after both pass)
- **CR 302.6** summoning sickness (tap-cost rejection, non-tap allowed, non-creature allowed)
- **CR 509.1f** blockers do not tap
- **LIFO stack** resolution; stack modeled as a zone, not a phase
- **Target fizzling** when required targets leave before resolution
- **Continuous-effect layers** (layer 7 `STAT_DELTA`) and characteristic resolution
- **State-based actions**: creature death by lethal damage, game-over at life ≤ 0
- **Full combat pipeline** reachable from normal play (main → battle → attackers → blockers → damage → SBA → death trigger)
- **RPS → starting-hand** regression (the post-RPS hand/deck bug)
- **Delta redaction** of hidden information (opponent hand/deck)
- **Reconnect identity mapping** and rejoin decisions
- **Reducer immutability** guarantees

---

## 5. Limits & Gaps

**No coverage tooling** — no `@vitest/coverage-*`, no thresholds, so "coverage" is inferred from file inventory, not measured.

**Untested source modules** (present in `src/`, no direct test):

- Engine: `mana-pool.ts` (38), `modifier-pipeline.ts` (17), `modifier-registry.ts` (39), `card-utils.ts` (9), `handlers/pass-priority-handler.ts` (25), `handlers/resolve-stack-handler.ts` (25)
- Library: `card-parser.ts` (121), `card-factory.ts` (40)
- Shared: `target-utils.ts` (32), `game-logger.ts` (99 — only touched indirectly via `event-bus.test.ts`)
- Types: `action.ids.ts`, `card.types.ts`, `effect.types.ts`, etc. (type-only, expected)
- `room-factory.ts`'s `createRoom`/`joinRoom` beyond incidental use

**No integration / E2E layer**:

- **No React component or UI tests** — all 13 components in `src/client/components/`, both hooks (`useSocket`, `useGameActions`), `socket.ts`, `targeting.ts`, `deltaReducer.ts` are untested.
- **No socket.io end-to-end tests** — `src/server.ts` (469 lines) is never imported by a test. The "smoke" tests (`battle-phase-smoke.test.ts`, `rps-play-handler.test.ts`) **re-implement** `server.ts` branching locally rather than exercising the real file, so server routing/glue can drift undetected.
- **No Playwright / browser tests**; no visual regression.
- **No MongoDB / persistence tests** (only the in-memory store).

**Coverage depth limits**:

- No exhaustive `canTransition` matrix test for the state machine.
- `buildDynamicParams` / `buildStackEffects` only lightly covered (2 tests each).
- No performance, load, fuzz, or property-based tests.
- Several tests mutate the **shared blueprint cache** and rely on manual save/restore — fragile if the suite is parallelized or a test fails mid-way.
- Client store test uses a hand-rolled `sessionStorage` mock rather than a DOM environment, so real browser storage behavior is unverified.

---

## 6. Recommendations

1. **Add coverage reporting** (`@vitest/coverage-v8`) with a baseline threshold to make gaps measurable.
2. **Add server-level integration tests** that import and drive `src/server.ts` action routing (rather than re-implementing its branches), ideally with an in-process socket.io client.
3. **Add React component tests** (Vitest + Testing Library + jsdom) for `GameScreen`, `Hand`, `Battlefield`, `PhaseBar`, `TargetSelector`.
4. **Add unit tests** for the untested engine modules: `mana-pool`, `modifier-pipeline`/`modifier-registry`, `pass-priority-handler`, `resolve-stack-handler`, `card-parser`, `card-factory`, `target-utils`.
5. **Eliminate shared-blueprint mutation** in tests via per-instance blueprint cloning to remove the save/restore fragility.
6. **Add a `canTransition` matrix test** and deepen `buildDynamicParams`/`buildStackEffects` coverage.

---

**Bottom line:** The engine core is well-tested (331 green tests, strong rules fidelity), but the suite stops at the engine boundary. The server glue, socket transport, and entire React client are effectively unverified, and there is no coverage measurement to catch regressions in the untested modules.
