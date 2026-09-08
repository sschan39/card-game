# Battle Phase — Manual Smoke Test Checklist

> Run after `npm run build && node dist/server.js`. Open two browser tabs at `http://localhost:3000`.

Verifies the end-to-end battle phase flow: Main Phase → Battle Phase (auto-enter via "Enter Battle"), declare attackers (each attack resolves damage immediately), then End Turn to complete the turn.

## Setup

- [ ] **Tab A**: Click "Create Room" — note the room ID shown
- [ ] **Tab B**: Enter the room ID from Tab A, click "Join Room"
- [ ] **Both tabs**: Play RPS to start the game (both players play a card)
- [ ] **Winner's tab**: phase shows "Main Phase", hand count is 5 (4 starting + 1 draw)

## Entering the Battle Phase

- [ ] **Winner's tab**: the phase bar button reads **"Enter Battle"** (not "End Turn") while in Main Phase
- [ ] **Winner's tab**: click "Enter Battle"
  - **Expected:** Phase bar shows "Battle Phase"
  - **Expected:** The button now reads **"End Turn"**

## Declaring Attackers

> Requires a creature on the battlefield without summoning sickness. If you don't have one, play 帝国奴僕 (1/1 creature) during Main Phase, then End Turn to pass to the opponent, then End Turn again to come back — the creature untaps and loses summoning sickness at the start of your next turn.

- [ ] **Winner's tab**: right-click a creature on your battlefield
  - **Expected:** Context menu shows an **"Attack"** option (enabled during Battle Phase)
- [ ] Click **Attack**
  - **Expected:** Targeting mode enters — the **opponent** player panel glows gold (legal target)
- [ ] Tap the opponent player panel
  - **Expected:** Panel outline turns red (selected)
- [ ] Click **Confirm**
  - **Expected:** The creature taps, and the opponent's life drops by its power (e.g. 20 → 19 for a 1/1)
  - **Expected:** The `CombatDisplay` shows the attacker → target arrow with P/T snapshot
- [ ] **Opponent's tab**: life total updates to match

## Creature-vs-Creature Combat

> Requires an opponent creature on the battlefield. If the opponent has one, attack it instead of the player.

- [ ] **Winner's tab**: right-click a creature → **Attack** → tap the **opponent's creature** on the battlefield
  - **Expected:** Both creatures take damage equal to the other's power
  - **Expected:** If a creature's damage ≥ toughness, it dies (moves to graveyard) via state-based actions
  - **Expected:** The `CombatDisplay` shows attacker → defender arrow

## Ending the Turn from Battle Phase

- [ ] **Winner's tab**: click **"End Turn"** (now in Battle Phase)
  - **Expected:** Phase advances through End of Combat → End Step → Cleanup → opponent's turn
  - **Expected:** The `CombatDisplay` clears (declared attackers reset at end of combat)
  - **Expected:** Opponent's tab shows "(your turn)", hand count is 5 (4 + 1 draw)

## Edge Cases

- [ ] **Cannot attack outside battle phase**: In Main Phase, right-click a creature — the "Attack" option is disabled (or absent)
- [ ] **Cannot attack twice**: After attacking, the creature is tapped and marked `attackedThisTurn` — the "Attack" option is disabled until your next turn
- [ ] **Summoning sickness**: A creature played this turn cannot attack (option disabled) until your next turn
- [ ] **Empty battle phase**: If you enter Battle Phase and click "End Turn" without attacking, the turn completes normally (no crash)

## Notes

- Combat is **Hearthstone-style**: no declare-blockers step. Each attack resolves damage immediately (turn-based action, not on the stack).
- The "End Turn" button is phase-aware: **"Enter Battle"** in Main Phase, **"End Turn"** in Battle Phase.
- Test deck: 4x 帝国奴僕 (1/1 creature, `{R}`, taps for red) + 4x 血炎山 (land, taps for red)