# RPS Phase — Manual Smoke Test Checklist

> Run after `npm run build && node dist/server.js`. Open two browser tabs at `http://localhost:3000`.

## Setup

- [ ] **Tab A**: Click "Create Room" — note the room ID shown
- [ ] **Tab B**: Enter the room ID from Tab A, click "Join Room"

## RPS Phase

- [ ] **Both tabs** show "Phase: RPS" in the phase bar
- [ ] **Both tabs** show 3 cards in hand (rock, paper, scissors)
- [ ] **Both tabs**: phase bar action buttons (End Turn, Pass Priority, Resolve Stack) are hidden

## Playing RPS

- [ ] **Tab A**: Click a card (e.g., rock) — card disappears from hand, "Waiting for opponent…" appears
- [ ] **Tab B**: Still shows 3 cards, no "Waiting for opponent…" yet
- [ ] **Tab B**: Click a card (e.g., scissors)
- [ ] **Both tabs**: RPS resolves — winner is determined, phase transitions to `stateTurnStart`
- [ ] **Both tabs**: phase bar action buttons reappear
- [ ] **Winner's tab** shows "(your turn)"

## Post-RPS: Deck & Starting Hands

- [ ] **Both tabs**: after RPS resolves, each player has a 4-card hand (帝国奴僕 / 血炎山)
- [ ] **Both tabs**: deck count shows 4 (8-card test deck minus 4 dealt)
- [ ] **Both tabs**: graveyard shows the discarded RPS cards (2 unplayed + 1 played)
- [ ] **Both tabs**: cards show mana cost badge (帝国奴僕 = `{R}`, 血炎山 = no cost) and type line

## Turn Loop

- [ ] **Winner's tab**: phase shows "Main Phase" (auto-advanced from Untap → Draw → Main)
- [ ] **Winner's tab**: hand count is 5 (4 starting + 1 draw)
- [ ] **Winner's tab**: click a land (血炎山) — it moves to battlefield, taps for red mana
- [ ] **Winner's tab**: click 帝国奴僕 — it moves to battlefield with summoning sickness (tapped state)
- [ ] **Winner's tab**: click "End Turn" — opponent's turn starts (draw + main phase)
- [ ] **Opponent's tab**: now shows "(your turn)", hand count is 5 (4 + 1 draw)
- [ ] **Both tabs**: deck count decreases by 1 each turn (draw step)

## Edge Cases

- [ ] **Tie**: If both pick the same card, player1 goes first (deterministic)
- [ ] **Disconnect**: If a player disconnects during RPS, the remaining player should not be stuck (room cleanup TBD)

## Notes

- RPS choices are public — both players see each other's played card in `rpsState.playedCards`
- Remaining unplayed RPS cards are discarded (moved to graveyard) on resolution
- Test deck: 4x 帝国奴僕 (1/1 creature, `{R}`, taps for red) + 4x 血炎山 (land, taps for red)
- Starting hand: 4 cards dealt after RPS resolves
- Draw step: active player draws 1 card on entering `stateDrawPhase`