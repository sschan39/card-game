# Battle Phase — Manual Smoke Test Checklist

> Run after `npm run build && node dist/server.js`. Open two browser tabs at `http://localhost:3000`.

Verifies the end-to-end **MTG-style 5-step combat pipeline**:

```
Main Phase
  → (Enter Battle) → Beginning of Combat   [priority window — both players pass]
  → Declare Attackers                       [active player declares]
  → Declare Blockers                        [defender declares]
  → Combat Damage                           [auto — damage dealt simultaneously]
  → End of Combat                           [auto]
  → End Step → Cleanup → next turn
```

Combat is **not** Hearthstone-style. There is a real declare-blockers step, and
damage is dealt in a dedicated combat damage step (not immediately on attack).

## Setup

- [ ] **Tab A**: Click "Create Room" — note the room ID shown
- [ ] **Tab B**: Enter the room ID from Tab A, click "Join Room"
- [ ] **Both tabs**: Play RPS to start the game (both players play a card)
- [ ] **Winner's tab**: phase shows "Main Phase", hand count is 5 (4 starting + 1 draw)

## Entering Combat

- [ ] **Winner's tab**: the phase bar shows an **"Enter Battle"** button (Main Phase only)
- [ ] **Winner's tab**: click **"Enter Battle"**
  - **Expected:** Phase bar shows **"Beginning of Combat"**
  - **Expected:** The **"Enter Battle"** button disappears; **"End Turn"** and **"Pass Priority"** are shown
  - **Expected:** Only the winner (active player) has priority — the opponent's tab shows no action buttons

## Passing Through the Beginning of Combat Step

> The beginning-of-combat step is a priority window. Both players must pass
> priority before the game moves to declaring attackers (MTG CR 507).

- [ ] **Winner's tab**: click **"Pass Priority"**
  - **Expected:** Priority passes to the opponent (opponent's tab now shows "Pass Priority")
- [ ] **Opponent's tab**: click **"Pass Priority"**
  - **Expected:** Phase advances to **"Declare Attackers"**
  - **Expected:** Priority returns to the active player (winner's tab)

## Declaring Attackers

> Requires a creature on the battlefield without summoning sickness. If you
> don't have one, play 帝国奴僕 (1/1 creature) during Main Phase, then End Turn
> to pass to the opponent, then End Turn again to come back — the creature
> untaps and loses summoning sickness at the start of your next turn.

- [ ] **Winner's tab**: in "Declare Attackers", a **"Declare Attackers (N)"** button appears (N = number of legal attackers)
- [ ] **Winner's tab**: click **"Declare Attackers (N)"**
  - **Expected:** Phase advances to **"Declare Blockers"**
  - **Expected:** The attacker(s) tap and are marked as having attacked
  - **Expected:** The `CombatDisplay` shows the declared attacker(s)
  - **Expected:** Priority passes to the **defender** (opponent's tab now shows "Declare Blockers (0)")

## Declaring Blockers

- [ ] **Opponent's tab**: in "Declare Blockers", a **"Declare Blockers (0)"** button appears
- [ ] **Opponent's tab**: click **"Declare Blockers (0)"** (declares no blockers)
  - **Expected:** Phase auto-advances through **Combat Damage → End of Combat → End Step → Cleanup**
  - **Expected:** The attacker's power is dealt to the defending player (e.g. 20 → 19 for a 1/1)
  - **Expected:** Both tabs show the updated life total
  - **Expected:** The `CombatDisplay` clears (declared attackers reset at end of combat)
  - **Expected:** The turn passes to the opponent — opponent's tab shows "(your turn)", hand count is 5 (4 + 1 draw)

## Creature-vs-Creature Combat

> Requires an opponent creature on the battlefield. Blocking is currently
> limited to the "no blockers" button in the UI — a blocker-selection UI is
> deferred. This scenario is covered by the automated test
> `tests/engine/combat-integration.test.ts`; verify manually only if a
> blocker-selection UI has been added.

- [ ] **Defender**: declare a blocker against the attacker
  - **Expected:** Both creatures take damage equal to the other's power simultaneously
  - **Expected:** If a creature's damage ≥ toughness, it dies (moves to graveyard) via state-based actions
  - **Expected:** The `CombatDisplay` shows attacker → blocker arrow

## Ending the Turn from Combat

- [ ] **Winner's tab**: click **"End Turn"** at any point during combat
  - **Expected:** The director skips straight to the End Step and completes the turn
  - **Expected:** The `CombatDisplay` clears
  - **Expected:** Opponent's tab shows "(your turn)", hand count is 5 (4 + 1 draw)

## Edge Cases

- [ ] **Cannot enter battle outside Main Phase**: "Enter Battle" only appears in Main Phase
- [ ] **Cannot attack twice**: After attacking, the creature is tapped and marked `attackedThisTurn` — it is excluded from the "Declare Attackers (N)" count until your next turn
- [ ] **Summoning sickness**: A creature played this turn is excluded from the attacker count until your next turn
- [ ] **Empty combat**: Enter Battle → pass through beginning of combat → declare 0 attackers is not possible (at least one attacker is required); instead click "End Turn" to complete the turn normally (no crash)
- [ ] **End Turn during stack**: "End Turn" is hidden while the stack is non-empty (MTG 116 — the turn cannot end during the stack)

## Notes

- Combat is **MTG-style**: a real 5-step pipeline with a declare-blockers step and a dedicated combat damage step.
- The phase bar button is phase-aware: **"Enter Battle"** in Main Phase, **"End Turn"** everywhere else.
- The beginning-of-combat step is a priority window — **both players must pass priority** before attackers can be declared.
- Test deck: 4x 帝国奴僕 (1/1 creature, `{R}`, taps for red) + 4x 血炎山 (land, taps for red)