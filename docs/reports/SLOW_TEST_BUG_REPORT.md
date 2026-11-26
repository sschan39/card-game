# Slow test bug report: `live-routing.test.ts`

Reported November 24, 2026. Fixed in `2a5e4fd` and `0ed3663`; verified November 25, 2026.

## Summary

`tests/server/live-routing.test.ts` took **200 seconds** to run 50 tests, and **45 minutes**
under `npm run test:coverage`. The suite was assumed to be inherently expensive because it
drives two real Socket.IO clients through complete matches. It was not. The cost came from a
missing cache in the characteristic resolver, which made every action replay the whole board
once per card.

The fix is in production code, not in the test. The test file kept all 442 assertions and all
50 cases; only three assertions were rewritten to read the same fact from a different field
after an unrelated data-model change.

| Measure | Before | After |
|---|---:|---:|
| `live-routing.test.ts` wall clock | 200s | **74s** |
| Slowest single test | 101.8s | **23.8s** |
| Full `npm test` | 373s | **237s** |
| `buildPlayerView` on a mid-game room | 587ms | **2.6ms** |
| Assertions in the file | 442 | **442** |
| Test cases in the file | 50 | **50** |

## Priority

High. The suite is the only end-to-end proof that both seats stay aligned through real
sockets, real persistence and real projection. At 45 minutes under coverage it was effectively
excluded from the gate, which is how a red `main` survived unnoticed.

## Reproduce

```powershell
npx vitest run tests/server/live-routing.test.ts --project server
```

Before the fix this reported `50 passed` in roughly 200s. Under coverage it reported two
failures in 2,727s — both timing artifacts, not regressions.

## Observed

### The event loop was blocked, not waiting on I/O

A 5ms heartbeat inside the suite measured event-loop lag directly:

```
{ actionMs: 133823, actions: 1101, viewMs: 12198, waitMs: 121122,
  polls: 3293, handleMs: 4091, handles: 174, lagMax: 3324, lagTotal: 128415 }
```

Of a 146s test run, **128s was event-loop lag** — the process was busy, not idle. The largest
single stall was **3.3 seconds**.

Two numbers ruled out the obvious suspects:

- `handleAction` totalled **4.1s across 174 calls**. The engine's command entry point was not
  the problem.
- `vi.waitFor` accounted for 122s, but with 3,293 polls at a 10ms interval the polling floor is
  only ~33s. The remaining ~89s was genuine latency: the server could not emit a delta because
  it was still computing.

A V8 CPU profile of the worker confirmed it — the main process was 96% idle, and the worker's
samples were dominated by synchronous engine work rather than module loading or socket I/O.

### Root cause: the characteristic cache missed every derived room

`CardCharacteristicService.resolve` memoized the resolved board, but only for the room object
that opened the scope:

```ts
// before
function resolve(room, card, throughLayer = 80) {
  if (!resolutionScope) return resolveCharacteristics(room, card, throughLayer);
  let board = resolutionScope.boards.get(throughLayer);   // keyed by layer only
  ...
}
```

`gameReducer` is pure: it returns a **new** room object by spread and never mutates in place.
So any room produced by a reducer step was a different object, missed the cache, and fell back
to `resolveRoomCharacteristics` — a full board evaluation across every card and every
continuous-effect layer.

`preview()` in `action-costs.ts` is exactly that pattern:

```ts
const preview = (room, mutations) => mutations.reduce(gameReducer, room);
```

Every cost preview replayed mutations through the reducer, and every characteristic lookup
inside that replay re-resolved the entire board. That is O(n²) in board size, paid per action.
A single `TAP_CARD` mutation measured **129ms**, while `planActionCosts` itself was only 3.17ms.

Scaling confirmed the shape before the fix:

| Battlefield cards | `buildPlayerView` |
|---:|---:|
| 4 | 20ms |
| 80 | 578ms |

## Expected

Resolving a card's characteristics inside a synchronous read-only scope should evaluate each
distinct board state once, regardless of how many room objects the reducer produces along the
way. A preview should cost roughly the same as the mutation it previews.

## Fix

### `2a5e4fd` — cache derived-room boards by identity

`ResolutionScope` gained a `derived` map, and `resolve` now reads and writes through two
helpers that pick the right cache:

```ts
interface ResolutionScope {
  room: GameRoom;
  values: Map<CardInstance, Map<number, ...>>;
  boards: Map<number, ...>;
  /** Boards for rooms derived from `room` by a reducer step, keyed by room identity. */
  derived: WeakMap<GameRoom, Map<number, ...>>;
  observe?: AppliedCharacteristicObserver;
}

function boardFor(room: GameRoom, throughLayer: number) {
  if (room === resolutionScope!.room) return resolutionScope!.boards.get(throughLayer);
  return resolutionScope!.derived.get(room)?.get(throughLayer);
}
```

**Why identity keying is sound.** `gameReducer` never mutates a room in place — it returns new
objects via spread (`{ ...room, battlefield: [...] }`). A given room object therefore always
represents one immutable state, so caching against its identity cannot serve stale data. The
`WeakMap` also guarantees derived entries cannot outlive the scope that created them.

### `0ed3663` — reuse evaluations across commands and projections

Four further changes removed repeated work at the boundaries:

1. **`withCharacteristicCache` reuses an open scope.** A nested call for the same room with no
   observer now evaluates inside the existing scope instead of starting a fresh one.
2. **The per-card cache is keyed by room as well as card.** The same retained card can resolve
   differently in two room snapshots, so `values` became
   `WeakMap<GameRoom, Map<CardInstance, Map<number, ...>>>`.
3. **`buildPlayerViews` projects both viewers in one scope.** `broadcast` previously called
   `buildPlayerView` once per seat, each opening its own scope and re-resolving the board.
   `projectViewDeltas` now builds both views inside a single `withCharacteristicCache`.
4. **Command and checkpoint entry points open a scope.** `GameEngine.executePlayerAction`,
   `reduceGameOperation`, `OptionService.getOptions` and `checkStateBasedActions` each wrap
   their work, so the many characteristic reads inside one command share one board evaluation.

## What the test still covers

The performance work touched production code only. The test file's coverage is unchanged:

- **50 test cases, 442 assertions** — identical before and after.
- Still drives two real Socket.IO clients over a real ephemeral TCP port.
- Still asserts both seats receive a delta for every action and that each seat's projected view
  deep-equals a freshly built `buildPlayerView` of the authoritative room.
- Still exercises real persistence, real projection, real reconnect and real cleanup.

Three assertions were rewritten, and only because commit `b4430e9` moved the deck out of
`room.setup` into the players' zones. They assert the same fact — that the dealt deck matches
the configured deck — from the new location:

```ts
// before
expect(authoritative(m.a).setup?.developmentDeck).toEqual(st01aTestSetup.developmentDeck);

// after
const firstSeat = authoritative(m.a).players[m.p1];
expect([...firstSeat.hand, ...firstSeat.deck].map(card => card.blueprint.id).sort())
  .toEqual([...st01aTestSetup.developmentDeck].sort());
```

The new form is slightly stronger: it compares the actual dealt cards, not just the setup
record.

## Retest

```powershell
npx vitest run tests/server/live-routing.test.ts --project server   # 50 passed, 74s
npm test                                                            # 4,287 passed, 237s
```

Per-test durations after the fix:

| Test | Before | After |
|---|---:|---:|
| "finishes a fresh match using real ST01A mana…" | 101.8s | 23.8s |
| "plays source-specific discards…" | 32.6s | 8.3s |
| "plays the authored trigger probe…" | 17.5s | 8.9s |
| "plays ordinary single-block, unblocked and multi-block combat…" | 12.4s | 7.1s |
| "plays workbook mana and whole-library search…" | 8.6s | 3.8s |
| **File total** | **200s** | **74s** |

## Lessons

- **A slow integration suite is a signal, not a cost to accept.** The 45-minute figure was
  treated as inherent to "real sockets". Measuring event-loop lag took one heartbeat and
  immediately showed the process was busy rather than waiting.
- **Time the layer below the one you suspect.** `handleAction` looked like the obvious culprit
  and was 4.1s of a 146s run. The cost was in the resolver it called.
- **Purity makes identity caching safe.** Because `gameReducer` returns new objects instead of
  mutating, a `WeakMap` keyed by room identity is both correct and leak-free.
- **A coverage-run failure in this suite is suspect until reproduced under `npm test`.**
  Instrumentation inflates the remaining cost enough to trip `vi.waitFor` windows. That is a
  separate, still-open issue; see `docs/test-strategy-analysis.md`.
