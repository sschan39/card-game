# How We Got Here: The Phase Control Refactor

> **What this is:** a post-mortem on how a turn-based game engine accumulated enough
> technical debt in its phase/turn control to need a 22-file refactor. It traces the
> decisions — each reasonable in isolation — that compounded into a fragile system,
> and extracts principles for avoiding the same trap next time.
>
> **Audience:** general engineering — you don't need to know this codebase or even
> card games. The patterns are universal to any stateful workflow with multiple
> concurrent clocks.

---

## 1. The system, in one paragraph

This is a two-player card game engine. A turn has phases (Main Phase → Combat →
End Step → Cleanup). Within each phase, players take turns acting — casting spells,
declaring attackers — by passing a "priority token" back and forth. When both pass
in succession, the phase advances. Separately, spells go on a stack that resolves
last-in-first-out.

Two independent clocks drive the game: the **phase clock** (where are we in the
turn?) and the **priority clock** (who can act right now?). They are related but
not the same. Most of the bugs come from code that conflates them.

---

## 2. The starting point: a clean design

The engine was built around a **pure reducer** pattern:

```
nextState = reduce(currentState, mutation)
```

Every game action — tap a card, draw a card, change phase — produces a list of
`GameMutation` objects. A pure `gameReducer` function applies each mutation to
produce a new state snapshot. The `StateMachine` class owns phase transitions and
priority assignment. The `GameEngine` sequences everything: handlers produce
mutations, the reducer applies them, triggers fire, state-based actions clean up.

This is a good architecture. It's testable, predictable, and has a single source
of truth for state changes. The problem isn't the architecture — it's what grew
*around* it.

---

## 3. Decision 1: "The Stack is just another phase"

**When:** early development, implementing spell-casting.

**The situation:** A player casts a spell during their main phase. The spell goes
on the stack. Other players can respond. When everyone passes, the stack resolves
and the game returns to... where?

**The decision:** Model "the stack is open" as a phase called `'Stack'`. Add it
to the phase enum. Add `'Stack'` as a legal transition target from every phase.
When entering the Stack phase, save the current phase in a `previousPhase` field.
When the stack empties, transition back to `previousPhase`.

**Why it seemed right at the time:**
- One line of code to enter the stack: `transition('Stack')`.
- One line to return: `transition(previousPhase)`.
- The existing `TRANSITIONS` graph and `canTransition()` validator handle it
  automatically.
- No new concepts — just another phase name.

**What it actually did:**
- Turned a **zone** (the stack is a data structure holding spell objects) into a
  **phase** (a position in the turn clock). These are different concerns.
- Created a `previousPhase` field whose only job is to paper over the fact that
  the phase clock moved when it shouldn't have.
- Introduced a question the system can't always answer: "what if `previousPhase`
  is null?" — which happens when the stack opens from a state that never set it.

This is the **root cause** of every subsequent problem. The stack is not a phase.
It's a zone that exists *during* a phase. Conflating them forced the engine to
"remember where it was" and then guess when it forgot.

---

## 4. Decision 2: "Just advance to the next phase here"

**When:** implementing the "End Turn" button, then "Declare Attackers", then
"Declare Blockers", then RPS resolution.

**The situation:** Each player action needs to advance the game to the next state.
After declaring blockers, the game should go: combat damage → end of combat →
end step → cleanup → new turn → draw → main phase.

**The decision:** Hard-code the phase sequence at each call site in `server.ts`:

```ts
// In the declareBlockers handler:
engine.transition('combatDamageStep');
engine.transition('endCombatStep');
engine.transition('stateEndPhase');
engine.transition('cleanupStep');
engine.transition('stateTurnStart');
engine.switchTurn();
engine.transition('stateDrawPhase');
engine.transition('stateMainPhase');
engine.givePriorityTo(engine.activeTurnPlayerId);
```

**Why it seemed right at the time:**
- It works. The game advances correctly.
- It's explicit — you can read exactly what happens.
- `StateMachine.transition()` already exists and validates each step.
- Adding a new action means adding one new chain — isolated from the others.

**What it actually did:**
- Duplicated the turn structure across 5 different call sites.
- Made each site responsible for knowing the *entire* downstream sequence.
- Created a situation where adding a new phase means editing every chain.
- Introduced a subtle ordering bug: `switchTurn()` happens *after* the untap
  step, so the new active player's permanents never untap. The chain was written
  in the order that "reads naturally" rather than the order that's correct.

This is the **amplification** of Decision 1. The scattered chains exist because
there's no single authority to ask "what comes next?" — and there's no single
authority because the Stack-as-phase design made phase advancement a special-case
problem instead of a linear one.

---

## 5. Decision 3: "If we don't know where to go, go to main phase"

**When:** handling the case where `previousPhase` is null during stack resolution.

**The situation:** The stack empties. The engine needs to return to the previous
phase. But `previousPhase` is null — maybe it was never set, maybe it was cleared
by an earlier transition. What now?

**The decision:** Add a fallback:

```ts
if (prevPhase) {
  mutations.push(...this.transition(room, prevPhase));
} else {
  // Fallback: guess main phase
  engineLogger.warn('previousPhase is null — falling back to stateMainPhase');
  mutations.push(...this.transition(room, 'stateMainPhase'));
}
```

**Why it seemed right at the time:**
- It prevents a crash. The game continues.
- It logs a warning, so it's "observable."
- The main phase is the most common phase — it's the right guess most of the time.
- It's defensive coding: handle the edge case gracefully.

**What it actually did:**
- Turned a design gap into a runtime behavior. The warning tells you something
  is wrong, but the game keeps running — so the bug is never fixed, only logged.
- The guess is *wrong* for combat phases. `stateMainPhase` is not a legal
  transition from `declareAttackersStep`. The transition validator rejects it,
  returns an empty mutation list, and the game silently freezes.
- The same fallback was copy-pasted to **three different locations**
  (`resolveCurrentPhase`, `passPriority`, `resolveStack`), so the bug has three
  independent triggers.
- The freeze is silent — no crash, no error to the player, just a frozen board.
  The only clue is a log line buried in server output.

This is the **symptom** that made the problem visible. But the fallback isn't the
disease — it's a bandage over Decision 1's wound.

---

## 6. Decision 4: "null means the engine is busy"

**When:** modeling "who has priority right now?"

**The situation:** Sometimes no player should be able to act — during phase
transitions, stack resolution, or state-based action checks. The priority field
needs to represent this.

**The decision:** Use `null`:

```ts
priorityPlayerId: PlayerId | null;
```

When `null`, no player can act. Different subsystems check `null` to decide what
to do next.

**Why it seemed right at the time:**
- It's idiomatic TypeScript — `null` means "no value."
- It's a single field, no new types or flags needed.
- The action validator already checks `priorityPlayerId !== playerId` — `null`
  naturally fails that check, so no player can act. Zero code change.

**What it actually did:**
- `null` acquired **three different meanings** depending on who reads it:
  1. "We're between phases, auto-advancing" (set by `resolveCurrentPhase`)
  2. "The stack is resolving" (checked by `passPriority` to trigger auto-resolve)
  3. "Something went wrong and nobody was assigned" (a bug)
- Different consumers interpret `null` differently. `passPriority` treats it as
  "resolve the stack now." The action validator treats it as "wait for input."
  The result depends on *who reads the state first*.
- There's no way to distinguish "intentionally no one has priority" from "we
  forgot to assign priority." Both are `null`.

This is the **ambiguity** that makes bugs hard to diagnose. When the game freezes,
you can't tell from the state whether it's waiting for a player, resolving the
stack, or broken.

---

## 7. The compounding effect

Each decision was reasonable in isolation. The problem is how they interacted:

```
Decision 1 (Stack as phase)
    │
    ├──► Creates previousPhase field
    │       │
    │       └──► Decision 3 (main phase fallback)
    │               │
    │               └──► Silent freeze when guess is wrong
    │
    ├──► Phase advancement becomes non-linear
    │       │
    │       └──► Decision 2 (hard-coded chains)
    │               │
    │               ├──► 5 copies of the turn sequence
    │               ├──► Untap ordering bug
    │               └──► Adding a phase = editing 5+ files
    │
    └──► Priority assignment scatters across call sites
            │
            └──► Decision 4 (null sentinel)
                    │
                    └──► Ambiguous state, hard to debug
```

The system didn't break all at once. It broke *gradually*, each new feature
adding one more copy of the phase sequence, one more place that checks `null`,
one more path that can hit the fallback. By the time the freeze bug appeared,
the root cause (Decision 1) was buried under three layers of workarounds.

---

## 8. Why the obvious fix is a trap

The natural response to the freeze bug is: "fix the fallback." Make it smarter.
Check which phase we're in. Look up the legal next phase. Handle combat specially.

This is a trap because it **adds a fourth copy** of the phase-advancement logic.
It makes the fallback more complex without addressing why the fallback exists.
The next edge case will break the smarter fallback too, and now there's more code
to debug.

The durable fix is to ask: *why does the engine ever not know what comes next?*
The answer is Decision 1: the Stack-as-phase design created a non-linear phase
graph where "next" depends on history (`previousPhase`). Remove that, and the
phase graph becomes linear — "next" is always the next entry in an array.

---

## 9. Principles for next time

### 9.1. One authority per clock

Every independent clock in the system gets exactly one component that decides
what happens next. For the phase clock, that's a single `advancePhase()` method.
For the priority clock, that's `givePriorityTo()` / `passPriority()`. Callers
never re-derive the sequence — they hand control to the authority and apply the
result.

**Smell test:** if two different files contain the same sequence of phase names,
you don't have an authority.

### 9.2. Don't model zones as states

A zone (stack, hand, graveyard) is a *container for objects*. A state (phase,
priority holder) is a *position in a sequence*. When you model a zone as a state,
you force the state machine to "leave and return" — which requires memory of
where it was, which creates the fallback problem.

**Smell test:** if you have a `previousState` field whose only purpose is to
return to where you were, you've modeled a zone as a state.

### 9.3. Fallbacks must not guess

A fallback that guesses the next state is a design gap disguised as defensive
code. If the engine can't determine the next state, that's a bug — not a case to
paper over. The correct response is to **fail loudly** with enough context to
diagnose the gap, then fix the gap.

**Smell test:** if a fallback contains a phase name literal (like
`'stateMainPhase'`), it's guessing. Replace it with a logged error and a
controlled failure.

### 9.4. Sentinel values must mean one thing

`null`, `undefined`, `-1`, and empty string are sentinel values. Each should
carry exactly one meaning. If `null` can mean "auto-advancing," "resolving,"
or "bug," split it into an explicit enum. The type system is free documentation —
use it.

**Smell test:** if you need a comment to explain what `null` means in a
particular context, it means too many things.

### 9.5. Derive, don't duplicate

If the same structure is described in two places (a legal-moves graph AND a
next-phase list), they will eventually disagree. Make one the source of truth
and derive the other. In this case: the turn sequence is the array; the legal
transition graph is computed from it.

**Smell test:** if adding a new phase requires edits in more than one place,
you have duplication.

### 9.6. Log at the decision point

When something goes wrong, the most valuable log line is the one that explains
*why* a decision was made. That line can only come from the component that made
the decision. If every caller logs its own transitions, the one path that forgets
to log is exactly the one you need.

**Smell test:** if a phase can complete with no log line explaining what happened
next, the decision point isn't logging.

---

## 10. The refactor, in brief

The fix is a 22-file refactor with four core changes:

1. **Remove Stack from the phase graph.** The stack stays as a zone; it stops
   being a phase. `previousPhase` is deleted. The fallback is deleted.

2. **Create a single `TURN_SEQUENCE` array.** The turn order lives in one place.
   The legal transition graph is derived from it. Adding a phase means editing
   one array.

3. **Build a Phase Director.** One method, `advancePhase()`, answers "what's
   next and who acts?" It auto-advances through mechanical phases and stops at
   phases that need player input. Every caller delegates to it.

4. **Disambiguate `null` priority.** Split the overloaded `null` into an explicit
   `engineState` flag. `priorityPlayerId === null` means only "no player holds
   the token right now." The reason why is a separate field.

The full spec is in `docs/superpowers/specs/2026-09-14-phase-control-refactor-design.md`.

---

## 11. How to catch this earlier next time

| Signal | When it appeared | What we should have done |
|---|---|---|
| `previousPhase` field added | Decision 1 | Asked: "Is this a zone or a state? If it's a zone, why does the phase clock need to know about it?" |
| Second hard-coded phase chain | Decision 2 | Extracted a helper immediately. Two copies is a pattern; five is a crisis. |
| Fallback with a guessed phase name | Decision 3 | Refused the fallback. Logged the gap and fixed the root cause instead. |
| `null` used for 3+ meanings | Decision 4 | Created an explicit enum. The type system is cheaper than debugging. |
| `TRANSITIONS` and server chains disagree | Decision 2 + ongoing | Derived the graph from the sequence. Two sources of truth is one too many. |

The common thread: **each decision optimized for local simplicity at the cost of
global complexity.** Adding `'Stack'` to the phase enum was one line. Hard-coding
a phase chain was eight lines. The `null` sentinel required zero new types. Each
was the easiest thing at the moment — and each pushed complexity onto every
future change.

The counter-pressure is: **when adding something easy, ask what it makes hard.**
If the answer is "every future phase-related change," the easy thing is too
expensive.