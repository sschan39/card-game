# Rock-Paper-Scissors Phase — Design Document

**Date:** 2026-08-26
**Status:** Draft — Awaiting Review
**Context:** The reducer-based engine, socket protocol, and React frontend are merged. The RPS mini-game is half-wired: `setupRPS()` deals rock/paper/scissors cards into both hands, but the cards have `zone: 'library'` (never updated to `'hand'`), no `ownerId`/`controllerId`, and there is no handler or resolution logic to process a player's choice. This design completes the RPS phase end-to-end.

---

## 1. Overview

Complete the RPS phase so that:

1. Each player clicks one RPS card (rock/paper/scissors).
2. The server records the choice and discards the played card.
3. The player who has played sees "Waiting for opponent…" until both have chosen.
4. When both players have chosen, the server compares the choices, determines who goes first, discards all remaining RPS cards, and transitions to `stateTurnStart`.

**Design principle — detachability:** RPS is a self-contained vertical slice, but it is **not** a bolt-on module. It is coupled across ~12 active files: the `rpsState` field on `GameRoom`, the two RPS mutations in the core reducer, the `RPS` phase in the state machine, the `end-turn` guard, the sync-service delta cases, and the client socket/UI. Removing RPS means deleting the handler file, the `rpsPlay` case, the `rpsState` field, the `RPS` phase, the RPS mutations, the sync delta cases, and the client RPS checks — see §9 for the full checklist. The new logic in this plan (handler + `resolveRPS` + server case + client wiring) is additive and isolated; the pre-existing coupling is documented, not hidden.

**Choices are public.** RPS is a demo of the mutation pipeline, not a hidden-information game. Both players' choices are broadcast to both clients via `stateDelta` as they are made. The "waiting for opponent" state is a client-side UI concern derived from `rpsState.playedCards` — no server-side privacy redaction is needed.

**Out of scope:** Best-of-3 rounds, RPS ties replayed, RPS UI polish, seeded RNG, deck-building (decks are empty; starting-hand dealing is deferred until deck-building exists).

---

## 2. Architecture

```
Client clicks RPS card
  → playerAction('rpsPlay', cardUuid)
    → server.ts: case 'rpsPlay'
      → rpsPlayHandler.validate()  — phase=RPS? card in hand? not already played?
      → rpsPlayHandler.propose()   — SET_RPS_PLAYED_CARD + MOVE_CARD(hand→graveyard)
      → engine.applyMutations()    — through existing gameReducer
      → if both played → resolveRPS() — compare, SET_TURN, SET_PHASE, deal hands
      → syncAfter()                — per-player delta broadcast
```

**New files:**

| File | Purpose |
|---|---|
| `src/engine/handlers/rps-play-handler.ts` | `rpsPlay` action handler (validate + propose) |
| `tests/engine/rps-play-handler.test.ts` | Unit tests for the handler |

**Modified files:**

| File | Change |
|---|---|
| `src/engine/room-factory.ts` | Fix `setupRPS()` zone/ownerId; add `resolveRPS()` |
| `src/server.ts` | Register `rpsPlay`; add `case 'rpsPlay'` in the `playerAction` switch |
| `src/client/components/CardComponent.tsx` | RPS phase → emit `rpsPlay` instead of `cast_spell` |
| `src/client/components/PhaseBar.tsx` | Hide end-turn / pass-priority buttons during RPS |

---

## 3. `rpsPlayHandler`

```typescript
// src/engine/handlers/rps-play-handler.ts

validate(room, playerId, action):
  1. room.currentPhase !== 'RPS' → fail "Not in RPS phase"
  2. !action.cardUuid → fail "cardUuid required"
  3. card not in player's hand → fail "Card not in hand"
  4. rpsState.playedCards[playerId] already set → fail "Already played"
  5. card.blueprint.id not in ['rock','paper','scissors'] → fail "Not an RPS card"
  → success

propose(room, playerId, action):
  1. SET_RPS_PLAYED_CARD { playerId, card: card.blueprint.id }
  2. MOVE_CARD { cardUuid, playerId, from: 'hand', to: 'graveyard' }
  → { success, mutations }
```

No `resolve` needed — RPS cards have no stack effects. The handler is ~60 lines.

**Why not reuse `cast_spell`:** RPS is a simultaneous choice with no response window. The normal pipeline requires priority (`ActionValidator.canActivate` step 5 requires `priorityPlayerId === playerId`, which is `null` during RPS) and a stack that resolves in order. Forcing RPS through it means special-casing the priority check and stack resolution — more burden on game logic, not less. The custom handler still exercises the mutation/reducer/delta pipeline, which is what RPS was meant to demo.

---

## 4. `resolveRPS()`

```typescript
// Added to src/engine/room-factory.ts

export function resolveRPS(room: GameRoom): GameMutation[] {
  const p1 = room.player1Id;
  const p2 = room.player2Id!;
  const c1 = room.rpsState.playedCards[p1];
  const c2 = room.rpsState.playedCards[p2];

  // rock > scissors, scissors > paper, paper > rock
  const beats: Record<string, string> = { rock: 'scissors', scissors: 'paper', paper: 'rock' };

  let winner: PlayerId;
  if (c1 === c2) {
    winner = p1; // tie → player1 goes first
  } else if (beats[c1] === c2) {
    winner = p1;
  } else {
    winner = p2;
  }

  const mutations: GameMutation[] = [
    { type: 'SET_RPS_STATUS', status: 'resolved' },
    { type: 'SET_TURN', playerId: winner },
    { type: 'SET_PHASE', phase: 'stateTurnStart' },
  ];

  // Discard remaining RPS cards from both hands
  for (const [pid, player] of Object.entries(room.players)) {
    for (const card of player.hand) {
      if (['rock','paper','scissors'].includes(card.blueprint.id)) {
        mutations.push({ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: pid, from: 'hand', to: 'graveyard' });
      }
    }
  }

  // NOTE: Dealing starting hands is deferred. The deck-building system
  // (populating player.deck with cards) does not exist yet — decks are
  // always empty. When deck-building is implemented, add MOVE_CARD
  // mutations here to draw 4 cards from each player's deck into their hand.
  // The existing dealStartingHands() in room-factory.ts serves as reference.

  return mutations;
}
```

**Tie rule:** player1 goes first on a tie. This is a deterministic, documented choice — no replayed rounds.

---

## 5. `server.ts` Changes

In the `playerAction` switch, add before `default:`:

```typescript
case 'rpsPlay': {
  const result = engine.handleAction(playerId, 'rpsPlay', {
    cardUuid: data.cardUuid,
  });
  if (!result.success) {
    socket.emit('error', { message: result.reason });
    return;
  }
  allMutations = engine.applyMutations(result.mutations!);

  // Check if both players have played
  const updatedRoom = engine.roomState;
  const p1Played = updatedRoom.rpsState.playedCards[updatedRoom.player1Id];
  const p2Played = updatedRoom.rpsState.playedCards[updatedRoom.player2Id!];
  if (p1Played && p2Played) {
    const rpsMutations = resolveRPS(updatedRoom);
    allMutations.push(...engine.applyMutations(rpsMutations));
  }
  break;
}
```

Register: `registerAction('rpsPlay', rpsPlayHandler);`

---

## 6. Events & Logging

### 6.1 Server → Client Events

| Event | When | Payload |
|---|---|---|
| `rpsPhase` | RPS starts (existing, emitted in `joinRoom`) | `{ message: string }` |
| `stateDelta` | Every RPS play + resolution | `StateDelta` (see 6.2) |
| `error` | Invalid RPS play | `{ message: string }` |

**No new events are introduced.** The RPS result (who won, who goes first) is conveyed entirely through `stateDelta` changes: `rpsState.status` → `'resolved'`, `rpsState.playedCards` (both choices), `activeTurnPlayerId` (winner), and `currentPhase` → `'stateTurnStart'`. The client derives "I go first" from `activeTurnPlayerId === myPlayerId`.

### 6.2 Delta Filtering — Public Choices

RPS choices are **public** — both players' choices are broadcast to both clients as they are made. No privacy redaction is added to `filterForPlayer()`. The existing hand/deck redaction is unchanged.

The "waiting for opponent" state is a **client-side UI concern**: a player who has played sees "Waiting for opponent…" until `rpsState.playedCards` contains both players' choices. The client derives this from the store — no server involvement.

### 6.3 JSONL Logging

`SyncService.broadcast()` logs the **unfiltered** delta to `data/deltas.jsonl` — one line per action with the full ordered `changes[]` array. The log is the server's source of truth and records both players' RPS choices in full. No change to logging is required.

---

## 7. Client Changes

**`CardComponent.tsx`** — when phase is RPS, emit `rpsPlay` instead of `cast_spell`:

```typescript
const phase = useGameStore(selectCurrentPhase);
const handleClick = (e) => {
  if (zone === 'hand') {
    if (phase === 'RPS') {
      playerAction('rpsPlay', card.uuid);
    } else {
      playerAction('cast_spell', card.uuid);
    }
  }
};
```

**`PhaseBar.tsx`** — hide action buttons during RPS:

```typescript
{isMyTurn && phase !== 'RPS' && (
  <div className="phase-actions">...</div>
)}
```

**"Waiting for opponent…"** — the client derives this from the store. When `phase === 'RPS'` and `rpsState.playedCards[myPlayerId]` is set but `rpsState.playedCards[opponentId]` is not, show "Waiting for opponent…" (e.g. in `PhaseBar.tsx` or a small RPS banner). When both are set, the resolution delta arrives and the phase transitions to `stateTurnStart` — no special reveal UI is needed since choices are public and already visible.

---

## 8. `setupRPS()` Fix

```typescript
export function setupRPS(room: GameRoom): void {
  // ... existing code ...
  for (const id of RPS_CARD_IDS) {
    const c1 = instantiateCard(id);
    c1.state.zone = 'hand';
    c1.state.ownerId = room.player1Id;
    c1.state.controllerId = room.player1Id;
    p1.hand.push(c1);

    const c2 = instantiateCard(id);
    c2.state.zone = 'hand';
    c2.state.ownerId = room.player2Id!;
    c2.state.controllerId = room.player2Id!;
    p2.hand.push(c2);
  }
}
```

---

## 9. Detachability Checklist

RPS is a vertical slice coupled across ~12 active files. To remove RPS from the codebase:

**New files (this plan):**
1. Delete `src/engine/handlers/rps-play-handler.ts`
2. Delete `tests/engine/rps-play-handler.test.ts`

**Server:**
3. Remove `case 'rpsPlay'` from `server.ts` switch
4. Remove `registerAction('rpsPlay', ...)` from `server.ts`
5. Remove `setupRPS()` call, `resolveRPS()` import, and `rpsPhase` emit from `server.ts`

**Engine core:**
6. Remove `rpsState` from `GameRoom` type (`src/types/game.room.types.ts`)
7. Remove `'RPS'` from `GameStateName` (`src/types/game.state.types.ts`) and from `TRANSITIONS` (`src/engine/state-machine.ts`)
8. Remove `SET_RPS_STATUS` / `SET_RPS_PLAYED_CARD` from `GameMutation` (`src/types/game-mutation.types.ts`) and their cases in `game-reducer.ts`
9. Remove the `room.currentPhase === 'RPS'` guard from `end-turn-handler.ts`

**Sync:**
10. Remove `SET_RPS_STATUS` / `SET_RPS_PLAYED_CARD` delta cases from `sync-service.ts`

**Client:**
11. Remove `rpsPhase` socket event handler from `client/socket.ts`
12. Revert `CardComponent.tsx` RPS check
13. Revert `PhaseBar.tsx` RPS check + waiting-for-opponent UI

**Tests:**
14. Remove RPS mutation tests from `tests/engine/game-reducer.test.ts`
15. Remove RPS transition tests from `tests/engine/state-machine.test.ts`
16. Remove `rpsState` from `tests/helpers/test-room-factory.ts`

**Optional (harmless if kept):**
17. Remove RPS card blueprints from `card_data.json`

The **new** logic in this plan (handler, `resolveRPS`, server case, client wiring) is additive and isolated to 2 new files + 2 server touchpoints + 2 client components. The pre-existing coupling (items 6-10, 14-16) predates this plan and is documented above.

---

## 10. Verification

| Level | What | How |
|---|---|---|
| Unit | `rpsPlayHandler.validate` rejects wrong phase / missing card / already-played / non-RPS card | `tests/engine/rps-play-handler.test.ts` |
| Unit | `rpsPlayHandler.propose` returns `SET_RPS_PLAYED_CARD` + `MOVE_CARD` | `tests/engine/rps-play-handler.test.ts` |
| Unit | `resolveRPS` picks correct winner for all 9 matchups + tie | `tests/engine/rps-play-handler.test.ts` |
| Regression | All existing tests pass | `npx vitest run` |
| Manual | End-to-end: create → join → RPS → play → winner goes first | Smoke test |

---

## 11. Scope Boundaries

**In scope:**
- `rpsPlay` action handler
- `resolveRPS()` resolution logic (winner determination + discard remaining RPS cards + phase transition)
- `setupRPS()` zone/ownerId fix
- Client RPS card click + phase bar gating + "Waiting for opponent…" UI

**Out of scope (future plans):**
- Best-of-3 rounds
- Tie replayed
- RPS UI polish (animations, reveal sequence)
- Seeded RNG
- Deck-building and starting-hand dealing (decks are empty; deferred until deck-building exists)
