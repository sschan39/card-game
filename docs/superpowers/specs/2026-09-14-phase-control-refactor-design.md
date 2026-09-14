# Phase Control Refactor — Design Spec

> **Status:** draft
> **Date:** 2026-09-14
> **Scope:** Refactor phase/turn/priority control to eliminate scattered advancement
> logic, the Stack-as-phase conflation, and the `null`-sentinel ambiguity.
>
> **Related docs:**
> - `docs/phase-and-priority-design.md` — the design lesson that motivated this
> - `docs/how-we-got-here-phase-control.md` — post-mortem on how we got here

---

## 1. Problem summary

The phase/turn engine has four structural problems that compound:

1. **Stack disguised as a phase.** `'Stack'` is in `GameStateName` and
   `TRANSITIONS`. Entering the stack saves `previousPhase`; leaving restores it.
   When `previousPhase` is null, a fallback guesses `stateMainPhase` — which is
   illegal from combat phases, causing a silent freeze.

2. **Phase advancement scattered across `server.ts`.** Five hard-coded transition
   chains duplicate the turn sequence. Adding a phase means editing every chain.
   The `switchTurn()` call is ordered after the untap step, so the new active
   player's permanents never untap.

3. **No single authority for "what's next."** `StateMachine` answers "is this
   legal?" (the `TRANSITIONS` graph) but not "what comes next?" That decision
   lives in `server.ts` call chains.

4. **`null` priority is overloaded.** `priorityPlayerId === null` means
   "auto-advancing," "stack resolving," or "bug" depending on which subsystem
   reads it.

---

## 2. Design goals

| Goal | Measure |
|---|---|
| One source of truth for turn order | `TURN_SEQUENCE` array; `TRANSITIONS` derived from it |
| Stack is a zone, not a phase | `'Stack'` removed from `GameStateName`; `previousPhase` deleted |
| Single authority for phase advancement | `advancePhase()` method; `server.ts` delegates, doesn't decide |
| `null` means one thing | `priorityPlayerId === null` = "no player holds the token"; reason is a separate `engineState` flag |
| No silent freezes | `phase:no-next` log + controlled failure instead of guessed fallback |
| Backward-compatible client protocol | Deltas still flow; client adapts to new field names |
| All existing tests pass or are updated | No regression in combat, RPS, spell casting, priority |

---

## 3. Non-goals

- Changing how the stack resolves (LIFO order, effect resolution, fizzling)
- Changing combat damage assignment or SBA logic
- Changing the RPS mini-game mechanics
- Adding new phases or removing existing ones
- Changing the client-server protocol format (deltas, snapshots)
- Implementing the `stateMainPhase → stateEndPhase` skip-combat branch (deferred)

---

## 4. Architecture: before and after

### 4.1. Current architecture

```
┌──────────────────────────────────────────────────────────┐
│ server.ts (playerAction switch)                          │
│                                                          │
│  endTurn:       transition(A) → transition(B) → pri(X)  │
│  declareAtk:    propose() → transition(C) → pri(Y)      │
│  declareBlk:    propose() → transition(D) → ... → pri(Z)│
│  rpsPlay:       resolve() → transition(E) → ... → pri(W)│
│  resolveStack:  resolve() → transition(prevPhase│main)  │
│                                                          │
│  Each chain hard-codes:                                  │
│  - The phase sequence                                    │
│  - Who gets priority                                     │
│  - The main-phase fallback                               │
└──────────────────────┬───────────────────────────────────┘
                       │ calls
┌──────────────────────▼───────────────────────────────────┐
│ StateMachine                                             │
│                                                          │
│  TRANSITIONS: graph of legal moves                       │
│  transition(): validate + emit SET_PHASE + side effects  │
│  resolveCurrentPhase(): fallback to stateMainPhase       │
│  addToStack(): transition('Stack') + save previousPhase  │
│  passPriority(): check null, resolve or advance          │
└──────────────────────────────────────────────────────────┘
```

### 4.2. Target architecture

```
┌──────────────────────────────────────────────────────────┐
│ server.ts (playerAction switch)                          │
│                                                          │
│  enterBattle:   engine.advancePhase(intent)              │
│  endTurn:       engine.advancePhase(intent)              │
│  declareAtk:    propose() → engine.advancePhase(intent)  │
│  declareBlk:    propose() → engine.advancePhase(intent)  │
│  rpsPlay:       resolve() → engine.advancePhase(intent)  │
│  passPriority:  engine.passPriority(playerId)            │
│  resolveStack:  engine.resolveTopOfStack()               │
│                                                          │
│  Every path delegates. No phase names in server.ts.      │
└──────────────────────┬───────────────────────────────────┘
                       │ calls
┌──────────────────────▼───────────────────────────────────┐
│ StateMachine                                             │
│                                                          │
│  TURN_SEQUENCE: ['stateTurnStart', ..., 'cleanupStep']   │
│  TRANSITIONS: derived from TURN_SEQUENCE + exceptions    │
│  advancePhase(): loop: nextInTurn → transition → check   │
│    if needs input → stop & assign priority               │
│    else → continue (auto-advance)                        │
│  transition(): validate + emit SET_PHASE + side effects  │
│  passPriority(): check engineState, resolve or advance   │
│                                                          │
│  No previousPhase. No fallback. No Stack phase.          │
└──────────────────────────────────────────────────────────┘
```

---

## 5. Phase 1: Type-level changes (Stack removal + TURN_SEQUENCE)

Phase 1 restructures the type system and data flow without changing runtime
behavior. The goal is to make the compiler verify correctness before Phase 2
introduces new logic.

### 5.1. Split `GameStateName`

**File:** `src/types/game.state.types.ts`

```ts
// BEFORE
export type GameStateName =
  | 'waiting' | 'RPS'
  | 'stateTurnStart' | 'stateDrawPhase' | 'stateMainPhase'
  | 'beginCombatStep' | 'declareAttackersStep' | 'declareBlockersStep'
  | 'combatDamageStep' | 'endCombatStep'
  | 'stateEndPhase' | 'cleanupStep'
  | 'Stack' | 'gameOver';

// AFTER
export const TURN_SEQUENCE = [
  'stateTurnStart',
  'stateDrawPhase',
  'stateMainPhase',
  'beginCombatStep',
  'declareAttackersStep',
  'declareBlockersStep',
  'combatDamageStep',
  'endCombatStep',
  'stateEndPhase',
  'cleanupStep',
] as const;

export type Phase = typeof TURN_SEQUENCE[number];

export type GameStatus = 'waiting' | 'RPS' | 'playing' | 'gameOver';
```

`GameStateName` is **removed**. All imports update to `Phase` or `GameStatus`
as appropriate.

### 5.2. Update `GameRoom`

**File:** `src/types/game.room.types.ts`

```ts
// BEFORE
currentPhase: GameStateName;
previousPhase: GameStateName | null;

// AFTER
phase: Phase;
status: GameStatus;
// previousPhase: DELETED
```

`priorityPlayerId`, `activeTurnPlayerId`, `lastPassedPlayerId`, `stack`,
`combat` — unchanged.

### 5.3. Update mutations

**File:** `src/types/game-mutation.types.ts`

```ts
// CHANGED
| { type: 'SET_PHASE'; phase: Phase }        // was GameStateName

// ADDED
| { type: 'SET_STATUS'; status: GameStatus }

// REMOVED
// | { type: 'SET_PREVIOUS_PHASE'; phase: GameStateName | null }
```

### 5.4. Derive `TRANSITIONS` from `TURN_SEQUENCE`

**File:** `src/engine/state-machine.ts`

```ts
function nextInTurn(phase: Phase): Phase | null {
  const i = TURN_SEQUENCE.indexOf(phase);
  if (i === -1 || i === TURN_SEQUENCE.length - 1) return null;
  return TURN_SEQUENCE[i + 1];
}

function canTransition(from: Phase, to: Phase | 'Stack'): boolean {
  // Stack is a zone, not a phase — but transition('Stack') is still called
  // by addToStack() during Phase 1 for backward compat. Removed in Phase 2.
  if (to === 'Stack') return true; // gated by stackOpen flag
  return nextInTurn(from) === to;
}
```

The old `TRANSITIONS` constant is **deleted**. The `canTransition` method on
`StateMachine` uses the derived version. The `gameOver` special case moves to
a status check.

### 5.5. Update `gameReducer`

**File:** `src/engine/game-reducer.ts`

- `SET_PHASE` case: `mutation.phase` is now type `Phase`.
- `SET_PREVIOUS_PHASE` case: **deleted**.
- Add `SET_STATUS` case: `return { ...state, status: mutation.status }`.

### 5.6. Update `room-factory.ts`

**File:** `src/engine/room-factory.ts`

```ts
// BEFORE
currentPhase: 'waiting',
previousPhase: null,

// AFTER
phase: 'stateMainPhase',  // or whatever default
status: 'waiting',
```

### 5.7. Update `StateMachine.transition()`

- Parameter `to` changes from `GameStateName` to `Phase`.
- Remove `SET_PREVIOUS_PHASE` emission (the `if (to === 'Stack')` block).
- The `addToStack()` method still calls `transition('Stack')` — this is a
  temporary shim removed in Phase 2.

### 5.8. Update `StateMachine.resolveCurrentPhase()`

- Remove the `previousPhase` fallback block entirely.
- For Phase 1, this method becomes a stub that logs `phase:no-next` and returns
  empty mutations. It is replaced by the director in Phase 2.

### 5.9. Update `GameEngine`

**File:** `src/engine/game-engine.ts`

- `transition(to)` parameter changes to `Phase`.
- `passPriority()`: remove the `previousPhase` fallback block (~L236-255).
  For Phase 1, after stack resolution, transition to a hard-coded safe phase
  (this is temporary; Phase 2 replaces it with the director).
- `phase` getter returns `this.room.phase`.
- Add `status` getter.

### 5.10. Update `server.ts`

- All `room.currentPhase` → `room.phase` or `room.status` as appropriate.
- `engine.transition('RPS')` → `engine.applyMutations([{ type: 'SET_STATUS', status: 'RPS' }])`.
- The hard-coded transition chains remain for Phase 1 (they still work because
  `transition()` still accepts the same phase names). They are replaced in Phase 2.
- `resolveStack` case: remove `previousPhase` usage; use a temporary safe default.

### 5.11. Update handlers

**File:** `src/engine/handlers/end-turn-handler.ts`

```ts
// BEFORE
if (room.currentPhase === 'Stack') { ... }

// AFTER
if (room.stack.length > 0) { ... }
// (The Stack phase no longer exists; the stack zone check is equivalent)
```

**File:** `src/engine/handlers/declare-attackers-handler.ts`,
`src/engine/handlers/declare-blockers-handler.ts`

- `room.currentPhase !== 'declareAttackersStep'` → `room.phase !== 'declareAttackersStep'`.
  (Field rename only; logic unchanged.)

### 5.12. Update client

**File:** `src/client/store/gameStore.ts`

```ts
// BEFORE
export function selectCurrentPhase(state: GameStore): GameStateName | null {
  return state.room?.currentPhase ?? null;
}

// AFTER
export function selectCurrentPhase(state: GameStore): Phase | null {
  return state.room?.phase ?? null;
}

export function selectRpsWaitingForOpponent(state: GameStore): boolean {
  // ...
  if (room.status !== 'RPS') return false;  // was room.currentPhase
  // ...
}
```

**File:** `src/client/components/PhaseBar.tsx`

- `PHASE_LABELS` type changes from `Record<GameStateName, string>` to
  `Record<Phase, string>`. Remove `waiting`, `RPS`, `Stack`, `gameOver` entries.
- `phase === 'Stack'` → check `room.stack.length > 0` via a new selector.
- `phase === 'RPS'` → `status === 'RPS'`.

**File:** `src/client/components/CardComponent.tsx`

- `phase === 'RPS'` → read `status` from store.

### 5.13. Update sync service

**File:** `src/server/sync-service.ts`

- `SET_PREVIOUS_PHASE` delta mapping: **deleted**.
- `SET_PHASE` mapping: update path to `phase`.
- Add `SET_STATUS` mapping: `updateChange('status', oldState, newState)`.

### 5.14. Update tests

All tests that reference `currentPhase`, `previousPhase`, or `GameStateName`
update to the new field names and types. The test helper `createTestRoom()`
removes `previousPhase` and splits `currentPhase` into `phase` + `status`.

**Phase 1 success criterion:** `npx tsc --noEmit` passes with zero errors.
All existing tests pass (logic unchanged; only field names and types changed).

---

## 6. Phase 2: Behavioral changes (Phase Director + null disambiguation)

Phase 2 introduces the new logic on top of the clean type foundation from Phase 1.

### 6.1. Add `engineState` to `GameRoom`

**File:** `src/types/game.room.types.ts`

```ts
engineState: 'waiting_for_player' | 'resolving_stack' | 'state_based_actions';
```

This replaces the `StateMachine.waitingForResponse` and `StateMachine.stackOpen`
instance flags. It is serialized and sent to clients (unlike the old flags) so
the client can render appropriate UI (e.g., "Resolving..." instead of "Your
priority" during stack resolution).

### 6.2. Build the Phase Director

**File:** `src/engine/state-machine.ts`

```ts
/**
 * Advance the phase clock by one or more steps, stopping at the first phase
 * that requires player input. Returns mutations to apply.
 *
 * @param room  - current room snapshot
 * @param intent - 'complete' (normal advance) or 'skipToEnd' (skip combat)
 */
advancePhase(room: GameRoom, intent: 'complete' | 'skipToEnd'): GameMutation[] {
  const mutations: GameMutation[] = [];
  let current: Phase = room.phase;

  // Handle skip-to-end intent (explicit branch, not implicit default)
  if (intent === 'skipToEnd') {
    mutations.push(...this.transition(room, 'stateEndPhase'));
    current = 'stateEndPhase';
  }

  // Auto-advance loop: keep stepping until a phase needs player input.
  for (let guard = 0; guard < TURN_SEQUENCE.length; guard++) {
    const next = nextInTurn(current);
    if (!next) {
      engineLogger.warn('phase:no-next', `no successor from ${current}`, { phase: current });
      break; // design-gap alarm — never guess
    }

    // Wrap: switch turn BEFORE untap so the NEW player's permanents untap.
    if (next === 'stateTurnStart') {
      mutations.push(...this.switchTurn(room));
    }

    // Transition runs per-phase side effects (untap, draw, damage, etc.)
    mutations.push(...this.transition(room, next));
    current = next;

    engineLogger.debug('phase:advance', `${current}`, { from: room.phase, to: current, auto: !phaseNeedsInput(current) });

    if (phaseNeedsInput(current)) {
      mutations.push(...this.givePriorityTo(defaultPriorityFor(current, room)));
      break;
    }

    engineLogger.debug('phase:auto-skip', `${current} auto-advanced (no input needed)`);
  }

  return mutations;
}
```

### 6.3. Define `phaseNeedsInput()` and `defaultPriorityFor()`

```ts
function phaseNeedsInput(phase: Phase): boolean {
  // Phases that auto-resolve without player decisions:
  // stateTurnStart, stateDrawPhase, combatDamageStep, endCombatStep,
  // stateEndPhase, cleanupStep — all mechanical.
  const autoPhases: Phase[] = [
    'stateTurnStart', 'stateDrawPhase', 'combatDamageStep',
    'endCombatStep', 'stateEndPhase', 'cleanupStep',
  ];
  return !autoPhases.includes(phase);
}

function defaultPriorityFor(phase: Phase, room: GameRoom): PlayerId {
  switch (phase) {
    case 'stateMainPhase':
    case 'beginCombatStep':
    case 'declareAttackersStep':
      return room.activeTurnPlayerId;
    case 'declareBlockersStep':
      return room.activeTurnPlayerId === room.player1Id
        ? room.player2Id!
        : room.player1Id;
    default:
      return room.activeTurnPlayerId;
  }
}
```

### 6.4. Remove Stack from `transition()` and `addToStack()`

- `transition()` no longer accepts `'Stack'` — the parameter is `Phase`, which
  excludes it.
- `addToStack()` no longer calls `transition('Stack')`. It only emits
  `STACK_UPDATED` and gives priority to the spell's controller. The phase
  does not change.
- `canTransition()` no longer has a Stack special case.
- The `stackOpen` flag is removed (replaced by `engineState`).

### 6.5. Rewire `passPriority()`

```ts
passPriority(room: GameRoom, playerId: PlayerId): { success: boolean; mutations: GameMutation[] } {
  if (room.priorityPlayerId !== playerId) {
    return { success: false, mutations: [] };
  }

  const opponent = playerId === room.player1Id ? room.player2Id! : room.player1Id;

  // If the stack is non-empty and both players passed, resolve the top object.
  if (room.stack.length > 0 && room.lastPassedPlayerId === opponent) {
    return {
      success: true,
      mutations: [
        { type: 'SET_PRIORITY', playerId: null },
        { type: 'SET_LAST_PASSED', playerId: null },
        { type: 'SET_ENGINE_STATE', state: 'resolving_stack' },
      ],
    };
  }

  // If the stack is empty and both players passed, advance the phase.
  if (room.stack.length === 0 && room.lastPassedPlayerId === opponent) {
    return {
      success: true,
      mutations: [
        { type: 'SET_PRIORITY', playerId: null },
        { type: 'SET_LAST_PASSED', playerId: null },
        ...this.advancePhase(room, 'complete'),
      ],
    };
  }

  // Otherwise, pass to opponent.
  return {
    success: true,
    mutations: [
      { type: 'SET_LAST_PASSED', playerId },
      ...this.givePriorityTo(opponent),
    ],
  };
}
```

Key changes from current:
- No `previousPhase` fallback.
- No `currentPhase === 'Stack'` check — uses `stack.length > 0` instead.
- Phase advancement delegates to `advancePhase()`.
- Stack resolution sets `engineState: 'resolving_stack'` instead of relying on
  `priorityPlayerId === null` to trigger auto-resolve.

### 6.6. Rewire `GameEngine.passPriority()`

The engine's `passPriority()` wrapper currently has ~30 lines of inline
stack-resolution and previousPhase logic. After Phase 2, it delegates entirely
to `StateMachine.passPriority()` and handles the `resolving_stack` engine state:

```ts
passPriority(playerId: PlayerId): { success: boolean; mutations: GameMutation[] } {
  const result = this.stateMachine.passPriority(this.room, playerId);
  if (!result.success) return result;

  const applied = this.applyMutations(result.mutations);

  // If the state machine requested stack resolution, do it now.
  if (this.room.engineState === 'resolving_stack') {
    const resolveResult = this.resolveTopOfStack();
    if (resolveResult.success) {
      applied.push(...(resolveResult.mutations ?? []));
    }

    // After resolution, return to the SAME phase with active player priority.
    // Do NOT advance the phase — MTG 116.4: after a spell resolves, the
    // active player gets priority again in the same phase.
    applied.push(...this.applyMutations([
      { type: 'SET_ENGINE_STATE', state: 'waiting_for_player' },
    ]));
    applied.push(...this.givePriorityTo(this.room.activeTurnPlayerId));
  }

  return { success: true, mutations: applied };
}
```

### 6.7. Gut `server.ts`

Replace the five hard-coded transition chains with director calls:

```ts
// BEFORE (declareBlockers case)
allMutations.push(...engine.transition('combatDamageStep'));
allMutations.push(...engine.transition('endCombatStep'));
allMutations.push(...engine.transition('stateEndPhase'));
allMutations.push(...engine.transition('cleanupStep'));
allMutations.push(...engine.transition('stateTurnStart'));
allMutations.push(...engine.switchTurn());
allMutations.push(...engine.transition('stateDrawPhase'));
allMutations.push(...engine.transition('stateMainPhase'));
allMutations.push(...engine.givePriorityTo(engine.activeTurnPlayerId));

// AFTER
allMutations.push(...engine.advancePhase('complete'));
```

Split `endTurn` into two actions:

```ts
// In src/types/action.ids.ts:
export const ACTION_IDS = {
  // ... existing ...
  endTurn: 'end_turn',        // renamed: now means "skip to end phase"
  enterBattle: 'enter_battle', // NEW: "advance from main to combat"
} as const;

// Labels:
[ACTION_IDS.endTurn]: 'End turn',
[ACTION_IDS.enterBattle]: 'Enter battle',
```

```ts
// In server.ts:
case ACTION_IDS.enterBattle: {
  // Validate: must be active player, in main phase, stack empty
  allMutations.push(...engine.advancePhase('complete'));
  break;
}

case ACTION_IDS.endTurn: {
  // Validate: must be active player, not in RPS, stack empty
  allMutations.push(...engine.advancePhase('skipToEnd'));
  break;
}
```

The `resolveStack` case removes `previousPhase` usage:

```ts
case ACTION_IDS.resolveStack: {
  const result = engine.resolveTopOfStack();
  // ... error handling ...
  allMutations = result.mutations ?? [];

  const postResolveRoom = engine.roomState;
  if (postResolveRoom.stack.length === 0) {
    // Stack empty — advance phase from wherever we are.
    // The director knows the next phase; we don't need previousPhase.
    allMutations.push(...engine.advancePhase('complete'));
    allMutations.push(...engine.givePriorityTo(postResolveRoom.activeTurnPlayerId));
  }
  break;
}
```

### 6.8. Update client for `engineState`

**File:** `src/client/store/gameStore.ts`

```ts
export function selectHasPriority(state: GameStore): boolean {
  const { room, myPlayerId } = state;
  if (!room || !myPlayerId) return false;
  return room.engineState === 'waiting_for_player'
    && room.priorityPlayerId === myPlayerId;
}
```

**File:** `src/client/components/PhaseBar.tsx`

- Add `engineState` display: show "Resolving..." when `resolving_stack`.
- Split End Turn button into Enter Battle / End Turn based on phase.
- Remove `phase === 'Stack'` checks; use `stack.length > 0` and `engineState`.

### 6.9. Update `end-turn-handler.ts`

```ts
// BEFORE
if (room.currentPhase === 'Stack') {
  return { success: false, reason: 'Cannot end turn while the stack is open!' };
}

// AFTER
// Stack phase no longer exists. The stack-is-open check is:
if (room.stack.length > 0) {
  return { success: false, reason: 'Cannot end turn while the stack is not empty!' };
}
```

### 6.10. Update tests

- `state-machine.test.ts`: Replace Stack transition tests with director tests.
  Test `advancePhase()` for: normal advance, auto-skip, turn wrap, priority
  assignment, skipToEnd intent.
- `battle-phase-smoke.test.ts`: Replace `serverEndTurn`/`serverDeclareAttackers`/
  `serverDeclareBlockers` helpers with director calls.
- `combat-pipeline-smoke.test.ts`: Replace hard-coded chains with
  `engine.advancePhase('complete')`.
- `combat-integration.test.ts`, `combat-damage-step.test.ts`: Same.
- `game-engine.test.ts`: Update phase references.
- `end-turn-handler.test.ts`: Update Stack phase test to stack.length check.

**Phase 2 success criterion:** All existing tests pass. New director tests pass.
Manual smoke test: full turn cycle (main → combat → end → new turn) works
end-to-end.

---

## 7. Data flow: stack resolution after refactor

```
Player casts a spell during stateMainPhase
  │
  ├─► play-card-handler.propose()
  │     └─► MOVE_CARD hand→stack, PUSH_STACK
  │
  ├─► StateMachine.addToStack()
  │     └─► emit STACK_UPDATED
  │     └─► givePriorityTo(caster)     // MTG 116.3d
  │
  │  (phase is STILL stateMainPhase — the stack is a zone, not a phase)
  │
  ├─► Caster passes priority
  ├─► Opponent passes priority
  │
  ├─► StateMachine.passPriority()
  │     └─► stack.length > 0 && both passed
  │     └─► SET_ENGINE_STATE: 'resolving_stack'
  │
  ├─► GameEngine.passPriority()
  │     └─► resolveTopOfStack()
  │     └─► stack is now empty
  │     └─► SET_ENGINE_STATE: 'waiting_for_player'
  │     └─► givePriorityTo(activePlayer)
  │
  │  (phase is STILL stateMainPhase — MTG 116.4: after resolution,
  │   active player gets priority in the same phase)
  │
  └─► Game continues in stateMainPhase. No previousPhase needed.
```

### Contrast: both-pass with empty stack (phase advance)

```
Both players pass in stateMainPhase with empty stack
  │
  ├─► StateMachine.passPriority()
  │     └─► stack.length === 0 && both passed
  │     └─► SET_PRIORITY: null
  │     └─► advancePhase('complete')
  │           └─► nextInTurn('stateMainPhase') → 'beginCombatStep'
  │           └─► transition('beginCombatStep')
  │           └─► phaseNeedsInput('beginCombatStep') → true
  │           └─► givePriorityTo(activePlayer)
  │
  └─► Game is now in beginCombatStep with active player priority.
```

### Contrast: stack resolution during combat (no phase change)

```
Both players pass in declareAttackersStep with a spell on stack
  │
  ├─► StateMachine.passPriority()
  │     └─► stack.length > 0 && both passed
  │     └─► SET_ENGINE_STATE: 'resolving_stack'
  │
  ├─► GameEngine.passPriority()
  │     └─► resolveTopOfStack()
  │     └─► SET_ENGINE_STATE: 'waiting_for_player'
  │     └─► givePriorityTo(activePlayer)
  │
  │  (phase is STILL declareAttackersStep — we return to combat)
  │
  └─► Active player can continue declaring attackers.
```

---

## 8. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Type split breaks compilation cascade | High | Low — compiler catches everything | Phase 1 is purely mechanical; fix errors one file at a time |
| Director loop infinite | Low | High — server hang | `guard < TURN_SEQUENCE.length` loop bound |
| `switchTurn` before untap changes behavior | Certain | Low — fixes a bug | Tests that asserted old (buggy) order will fail; update them |
| `endTurn` → `enterBattle`/`endTurn` split breaks client | Medium | Medium — button disappears | Add both buttons to PhaseBar; update ACTION_IDS |
| `engineState` serialized to client exposes internal state | Low | Low — clients already see phase/priority | Document the field; it's informational |
| Stack resolution timing changes | Low | High — core game loop | Existing combat and spell-casting tests cover this path |

---

## 9. Migration plan

### Phase 1 (type-level, ~3-4 hours)
1. Update types (`game.state.types.ts`, `game.room.types.ts`, `game-mutation.types.ts`)
2. Update `game-reducer.ts`
3. Update `room-factory.ts`
4. Update `StateMachine` (derive TRANSITIONS, remove SET_PREVIOUS_PHASE, stub resolveCurrentPhase)
5. Update `GameEngine` (field renames, temporary shims)
6. Update handlers (field renames)
7. Update `server.ts` (field renames, temporary shims)
8. Update `sync-service.ts`
9. Update client (field renames)
10. Update all tests (field renames)
11. **Gate:** `npx tsc --noEmit` clean + all tests pass

### Phase 2 (behavioral, ~3-4 hours)
1. Add `engineState` to `GameRoom` and mutations
2. Build `advancePhase()`, `phaseNeedsInput()`, `defaultPriorityFor()`
3. Rewire `passPriority()` in StateMachine and GameEngine
4. Remove Stack from `transition()` and `addToStack()`
5. Gut `server.ts` chains → director calls
6. Split `endTurn` into `enterBattle`/`endTurn`
7. Update client for `engineState` and split buttons
8. Update/add tests for director
9. **Gate:** all tests pass + manual smoke test

---

## 10. Files changed (complete list)

| File | Phase | Change |
|---|---|---|
| `src/types/game.state.types.ts` | 1 | Split `GameStateName` → `Phase` + `GameStatus`; add `TURN_SEQUENCE` |
| `src/types/game.room.types.ts` | 1, 2 | Rename fields; remove `previousPhase`; add `engineState` |
| `src/types/game-mutation.types.ts` | 1, 2 | Narrow `SET_PHASE`; remove `SET_PREVIOUS_PHASE`; add `SET_STATUS`, `SET_ENGINE_STATE` |
| `src/engine/state-machine.ts` | 1, 2 | Derive TRANSITIONS; add director; remove fallback; rewire passPriority |
| `src/engine/game-engine.ts` | 1, 2 | Field renames; remove previousPhase logic; delegate to director |
| `src/engine/game-reducer.ts` | 1, 2 | Update SET_PHASE; remove SET_PREVIOUS_PHASE; add SET_STATUS, SET_ENGINE_STATE |
| `src/engine/room-factory.ts` | 1, 2 | Split currentPhase; remove previousPhase; add engineState default |
| `src/server.ts` | 1, 2 | Field renames; gut chains → director; split endTurn |
| `src/server/sync-service.ts` | 1, 2 | Update delta mappings |
| `src/engine/handlers/end-turn-handler.ts` | 1, 2 | Replace Stack phase check with stack.length |
| `src/engine/handlers/declare-attackers-handler.ts` | 1 | Field rename |
| `src/engine/handlers/declare-blockers-handler.ts` | 1 | Field rename |
| `src/client/store/gameStore.ts` | 1, 2 | Update selectors; add engineState selector |
| `src/client/components/PhaseBar.tsx` | 1, 2 | Update PHASE_LABELS; split buttons; add engineState display |
| `src/client/components/CardComponent.tsx` | 1 | phase → status for RPS check |
| `src/types/action.ids.ts` | 2 | Add `enterBattle` action ID |
| `src/types/action.ids.ts` | 2 | Add `enterBattle` action ID; update labels |
| `tests/helpers/test-room-factory.ts` | 1, 2 | Update room factory |
| `tests/engine/state-machine.test.ts` | 1, 2 | Update + add director tests |
| `tests/engine/end-turn-handler.test.ts` | 1, 2 | Update Stack phase test |
| `tests/engine/battle-phase-smoke.test.ts` | 2 | Replace helpers with director |
| `tests/engine/combat-pipeline-smoke.test.ts` | 2 | Replace chains with director |
| `tests/engine/combat-integration.test.ts` | 2 | Replace chains with director |
| `tests/engine/combat-damage-step.test.ts` | 2 | Replace chains with director |
| `tests/engine/game-engine.test.ts` | 1, 2 | Update references |