# Phase Advancement & Priority — A Design Lesson

> **What this doc is:** an educational walkthrough of a class of bug that shows
> up in turn-based game engines (and any stateful workflow). It explains *why*
> the bug happens, *why* the obvious fix is a trap, and *what* a cleaner design
> looks like. It deliberately stays conceptual — the goal is to teach the
> pattern, not to document one specific patch.

---

## 1. Background: two clocks in one game

A turn-based card game runs on **two independent clocks**:

| Clock | Question it answers | Example |
|-------|--------------------|---------|
| **Phase clock** | *Where are we in the turn structure?* | Main Phase → Combat → End Step |
| **Priority clock** | *Who is allowed to act right now?* | "Player A may cast a spell" |

These clocks are related but **not the same**:

- The phase clock advances on a fixed schedule (the turn structure).
- The priority clock moves *within* a phase, and can bounce back and forth
  between players many times before the phase advances.

Most of the interesting bugs in a turn engine come from **conflating the two**.
When code assumes "advancing the phase" and "handing out priority" are the same
event, the two clocks drift apart — and the game gets stuck.

---

## 2. The symptom: "stuck in a phase"

A typical failure looks like this:

```
ERROR engine transition:invalid
  Invalid transition from declareAttackersStep to stateMainPhase
```

The player is in the *declare attackers* step. They have no creatures to attack
with (or simply don't want to). They try to move on. Nothing happens. The game
is frozen.

The error message is a clue, not the disease. It says: *something tried to jump
from a combat step straight to the main phase* — a move that isn't legal in the
turn structure. The real question is **why** anything tried that jump.

---

## 3. Root cause: control flow scattered across layers

Here is the anti-pattern. Phase advancement logic gets written **wherever it was
first needed**, and then copied wherever it was needed next:

```
┌─────────────────────────────────────────────────────────┐
│  Action handler A  →  "advance to next phase, give      │
│                        priority to X"                    │
│  Action handler B  →  "advance to next phase, give      │
│                        priority to Y"                    │
│  Action handler C  →  "advance to next phase, give      │
│                        priority to Z"                    │
│  Fallback path     →  "advance to... main phase?"       │
└─────────────────────────────────────────────────────────┘
```

Each path hard-codes its own idea of:

1. **What the next phase is** (a literal list of phase names).
2. **Who gets priority next** (a literal player lookup).
3. **Which phases can be skipped** (auto-advance rules).

This is a **state machine implemented as a pile of `if` statements**. It works
for the happy path and breaks the moment a new edge case appears — because the
edge case has to be handled in *every* copy, and nobody remembers all the copies.

### Why the fallback is the dangerous part

The most fragile piece is usually a **generic fallback**:

> "If we don't know what comes next, just go to the main phase."

That fallback is a guess. It's correct for *some* phases and illegal for others.
When it fires from a combat step, the transition validator rejects it, the
handler returns an empty mutation list, and the game silently stalls — no crash,
no error to the player, just a frozen board.

**Lesson:** a fallback that guesses the next state is a bug waiting to happen.
If the engine can't determine the next state, that's a *design gap*, not a case
to paper over.

---

## 4. The second trap: `null` as a state

Many engines represent "nobody has priority right now" as `null`:

```ts
priorityPlayerId: PlayerId | null;
```

This seems harmless, but `null` is **ambiguous**. When priority is `null`, the
engine cannot tell whether it means:

- "We're between phases, auto-advancing." (transient, expected)
- "The stack is resolving." (a different subsystem owns control)
- "Something went wrong and nobody was assigned." (a bug)

Because the meaning is unclear, every consumer has to *guess* — and different
consumers guess differently. One subsystem treats `null` as "resolve the stack
now"; another treats it as "wait for input". The result is control flow that
depends on *who happens to read the state first*.

### The cleaner rule: priority is never `null`

Every phase has a **defined** player who holds priority:

| Phase | Who holds priority |
|-------|-------------------|
| Main phase | Active player |
| Declare attackers | Active player |
| Declare blockers | Defending player |
| Combat damage | *(auto-resolves — no one needs to act)* |
| End step | Active player |

If a phase genuinely needs no input, don't model that as `null` — model it as
**"this phase auto-advances"**. The engine should immediately move to the next
phase that *does* need input, and assign priority there. The transient
"no one" moment never needs to be observable.

**Lesson:** avoid sentinel values that carry more than one meaning. If a state
can mean three different things, it will eventually be read as the wrong one.

---

## 5. The fix pattern: one authority for advancement

The durable fix is to give **one place** the job of answering:

> "Given the current phase and the fact that it just completed, what happens
> next — and who acts?"

That single authority should:

1. **Determine the next phase** from the turn structure (a data table, not
   scattered literals).
2. **Auto-advance** through phases that need no player input, looping until it
   reaches a phase that does.
3. **Assign priority** to the correct player for that final phase.
4. **Return a description** of each change (mutations), applied **step by step**
   so later steps see the effect of earlier ones.

```
        ┌──────────────────────────────┐
        │   Phase completed            │
        └──────────────┬───────────────┘
                       ▼
        ┌──────────────────────────────┐
        │  Look up next phase          │
        │  (from the turn structure)   │
        └──────────────┬───────────────┘
                       ▼
              ┌────────────────┐
              │ Needs input?   │──no──┐
              └───────┬────────┘      │
                      │yes            │
                      ▼               ▼
        ┌──────────────────────┐  ┌──────────────────────┐
        │ Assign priority to   │  │ Auto-advance again   │
        │ the correct player   │  │ (loop back)          │
        └──────────────────────┘  └──────────────────────┘
```

### Apply step by step, not as one frozen batch

It's tempting to compute the entire chain against a single snapshot and return
it as one batch. **Don't.** Some steps depend on the result of earlier steps:

- The **untap step** untaps the *active player's* permanents.
- The **turn switch** changes who the active player is.

If you compute both against the same stale snapshot, the untap uses the *old*
active player — so the new player's permanents never untap. The bug is subtle
and only appears on the turn boundary.

The authority must be **iterative**: apply one step, re-read the state, decide
the next. The description it returns is still a list of mutations — but each one
is computed from the state *after* the previous one.

**Lesson:** a batch computed from one snapshot cannot model a chain where each
link depends on the last.

Now every caller — "end turn", "pass priority", "declare no attackers" — does
the **same thing**: hand control to the authority and apply the result. The
edge cases stop being special cases.

---

## 6. The third trap: two tables for one structure

Section 5 said "determine the next phase from the turn structure (a data
table)". That advice is right, but it hides a trap: **the engine probably
already has a table**, and adding a second one creates two sources of truth.

A typical engine has a **transition map** — for each state, the list of states
you are allowed to move to:

```ts
const TRANSITIONS = {
  stateMainPhase: ['beginCombatStep', 'stateEndPhase', 'Stack'],
  beginCombatStep: ['declareAttackersStep', 'Stack'],
  // ...
};
```

This is a **graph**: it answers *"is this move legal?"* It does **not** answer
*"what comes next?"* — because a state can have several legal successors.
`stateMainPhase` has three. There is no single "next".

So when you need "what's next", you are tempted to add a **second** table:

```ts
const TURN_SEQUENCE = [
  'stateTurnStart', 'stateDrawPhase', 'stateMainPhase',
  'beginCombatStep', 'declareAttackersStep', /* ... */
];
```

Now the same turn structure is described **twice**:

```
        TRANSITIONS (graph)              TURN_SEQUENCE (list)
        ───────────────────              ────────────────────
        "what's legal?"                  "what's next?"
        stateMainPhase →                 [stateTurnStart,
          beginCombatStep                  stateDrawPhase,
          stateEndPhase                    stateMainPhase,
          Stack                            beginCombatStep,
                                           ...]
```

**This is why a `nextInTurn()` helper appears** — and it is a smell, not a
solution. The two tables can drift. Add a phase to `TRANSITIONS` and forget
`TURN_SEQUENCE`, and the engine silently skips it. The bug is invisible until
someone notices a step never runs.

### The fix: one table, derived views

Make the **ordered sequence primary**, and *derive* the legal-move graph from it:

```ts
// The single source of truth: the turn, in order.
const TURN_STRUCTURE = [
  'stateTurnStart', 'stateDrawPhase', 'stateMainPhase',
  'beginCombatStep', 'declareAttackersStep', 'declareBlockersStep',
  'combatDamageStep', 'endCombatStep', 'stateEndPhase', 'cleanupStep',
] as const;

// "What's next?" — read the list.
function nextInTurn(phase) {
  const i = TURN_STRUCTURE.indexOf(phase);
  return i === -1 ? null : TURN_STRUCTURE[(i + 1) % TURN_STRUCTURE.length];
}

// "Is this legal?" — derived from the same list.
function canTransition(from, to) {
  if (to === 'Stack') return stackOpen;   // the one non-linear edge
  return nextInTurn(from) === to;
}
```

Now adding a phase means editing **one array**. The graph and the sequence can
never disagree, because one is computed from the other.

### The one honest wrinkle: branches

Real turn structures are not perfectly linear. In this engine, `stateMainPhase`
can go to combat **or** skip straight to `stateEndPhase`. That branch is real —
do not hide it in a table.

Model it as an **explicit named action** ("skip to end step") rather than an
implicit default. Then the branch is visible at the call site, and the linear
sequence stays linear.

**Lesson:** if the same structure is written down twice, it will eventually be
written down *differently*. Keep one table; derive the rest.

---

## 7. Make the authority observable

The single authority from Section 5 is also the **best place to log**, because
it is the only place that knows all four of:

1. which phase just completed,
2. which phase comes next,
3. whether that step was **auto-advanced** or **stopped for input**,
4. who received priority.

If instead every caller logs its own transitions, you get N copies of the same
event in N different formats — and the one path that forgets to log is exactly
the one you need when the game freezes.

### What to log

| Event | When | Why |
|-------|------|-----|
| `phase:advance` | A phase completes and the next is chosen | The core trace: `from → to`, auto or decision, priority holder |
| `phase:auto-skip` | A mechanical phase is skipped | Explains *why* several phases passed in one action |
| `phase:no-next` | No successor could be determined | **The design-gap alarm** — should never fire in normal play |

### Why `phase:no-next` matters most

The original bug was a **silent stall**: the transition validator rejected an
illegal move, the handler returned an empty mutation list, and the board simply
froze. No crash, no message, nothing to grep for.

A single log line at the authority turns that into:

```
WARN engine phase:no-next  no successor from declareAttackersStep
```

Now "the game is stuck" becomes "here is the phase that had no successor" — a
one-line diagnosis instead of an afternoon of guessing.

**Lesson:** the component that *decides* is the component that should *explain*.
Log at the decision point, not at the call sites.

---

## 8. Why a reducer fits naturally

The pattern above is exactly what a **reducer** is good at:

```
nextState = reduce(currentState, event)
```

- The **event** is "the current phase completed" (or "player passed", etc.).
- The **reducer** is pure: same state + same event → same next state.
- The **output** is a description of the change (a list of mutations), not a
  side effect.

This gives three concrete benefits:

1. **Testability.** You can unit-test "what happens when the declare-attackers
   step completes with zero attackers?" without a server, a socket, or a client.
2. **Single source of truth.** The turn structure lives in one table. Adding a
   new step means editing one place.
3. **No hidden coupling.** Each step is a pure `(state, event) → mutations`
   function. The authority from Section 5 sequences them, so no *caller* has to
   know the order — and each step still sees the state produced by the last.

The key discipline: **the reducer decides, the caller applies.** Callers should
never re-derive "what comes next" — that's how the scattered logic creeps back in.

---

## 9. Checklist: signs you have this bug

Use this as a smell test on any turn/phase engine:

- [ ] The same phase sequence appears as a literal list in **more than one file**.
- [ ] A handler contains a comment like *"advance through A → B → C → D"*.
- [ ] There's a fallback that "just goes to the main phase" (or any guessed state).
- [ ] `null` / `undefined` is used to mean more than one thing.
- [ ] Adding a new phase requires edits in **more than one place**.
- [ ] A player can get stuck with no error shown to them.
- [ ] The transition validator logs errors during *normal* play.
- [ ] The turn order is encoded in **two** tables (a legal-moves graph *and* a
      next-phase list).
- [ ] A phase can complete with no log line explaining what happened next.

If two or more are true, the phase logic wants to be centralized.

---

## 10. Summary

| Concept | Takeaway |
|---------|----------|
| Two clocks | Phase advancement and priority are separate concerns — don't conflate them. |
| Scattered control flow | Copy-pasted advancement logic drifts; edge cases get missed. |
| Guessing fallbacks | A fallback that guesses the next state hides design gaps and stalls the game. |
| `null` sentinels | Overloaded sentinel values get misread; prefer explicit states. |
| Single authority | One component decides "what's next and who acts". |
| Two tables | If order lives in two places, they drift. Make the sequence primary; derive the graph. |
| Step-by-step | Apply each step before computing the next — chains can't be batched from one snapshot. |
| Observability | Log at the authority; it's the one place that knows what happened and why. |
| Reducer shape | Pure `(state, event) → mutations` makes the logic testable and centralized. |

The bug that started this doc was a *symptom*. The disease was **control flow
spread across layers with no single owner**. Fixing the symptom unblocks the
player; fixing the disease prevents the next dozen symptoms.