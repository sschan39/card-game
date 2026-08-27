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

## Edge Cases

- [ ] **Tie**: If both pick the same card, player1 goes first (deterministic)
- [ ] **Disconnect**: If a player disconnects during RPS, the remaining player should not be stuck (room cleanup TBD)

## Notes

- RPS choices are public — both players see each other's played card in `rpsState.playedCards`
- Remaining unplayed RPS cards are discarded (moved to graveyard) on resolution