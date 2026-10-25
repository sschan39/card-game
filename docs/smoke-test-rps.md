# RPS and First Turn — Production Browser Smoke Test

Run from the repository root: `npm run build` followed by `npm start`. Open two independently created tabs at `http://localhost:3000`. The server is `apps/server/dist/index.js`; the page and assets come from `apps/game-client/dist/`.

This checklist uses the unchanged default development setup: 12-card deck, five opening cards, first-player draw enabled, and debug mode `flow`. It describes the current client labels; advancing normal priority requires both players to act.

## Create and join

- [ ] Tab A: click **Create New Room** and copy the Room ID.
- [ ] Tab B: enter that ID and click **Join Room**.
- [ ] Both tabs show three RPS cards (石頭/布/剪刀) and no normal turn actions. The existing phase label remains **Precombat Main** during RPS; status is represented by the RPS hand and waiting prompt.
- [ ] Tab A plays rock. Its hand drops to two cards and **Waiting for opponent…** appears; Tab B still has three cards.
- [ ] Tab B plays scissors. Both clients enter **Upkeep**; Tab A is the active player, both have five opening cards and seven cards in the library.

## Reach the first main phase

- [ ] The player with priority clicks **Continue**, then the other player clicks **Continue**. Both tabs reach **Draw Step**, with the active player holding six cards and six remaining in the library.
- [ ] Repeat the priority passes. Both tabs reach **Precombat Main**. The active player has **Go to combat**; the other player waits.
- [ ] Verify Chinese card names, mana costs, type lines, and creature power/toughness render correctly.

## Play a land and resolve a creature

- [ ] Tab A clicks a **血炎山** in its hand. It moves directly to **Your Permanents**, the hand drops to five, and the stack remains empty.
- [ ] Right-click that land and select **Tap: add 1 red mana**. It becomes tapped and **Mana: red:1** appears.
- [ ] Click **帝國奴僕** in hand. The hand drops to four, the creature appears on **Stack (1)**, and the red mana is consumed.
- [ ] Both players click **Pass**, in priority order. The stack clears and the creature appears on the battlefield with summoning sickness. Both tabs show the same public battlefield.

## Advance and reconnect

- [ ] With an empty stack, expand **Debug actions** and click **End Turn** (available only because the default setup explicitly enables flow debugging). This shortcut advances directly to Tab B’s **Precombat Main**, including its draw; Tab B has six cards and both clients agree on the active player.
- [ ] Reload Tab A. It rejoins the same room and seat and restores the current board. Tab B remains in the game.

## Additional regression cases

- [ ] In a fresh match, both play rock: player 1 starts deterministically.
- [ ] A temporary disconnect can rejoin before the 30-second destruction grace period. Permanent disconnect cleanup is covered by the room-runtime and live-routing suites.

For detailed combat scenarios, see `smoke-test-battle-phase.md`; authoritative automated coverage is in `tests/server/live-routing.test.ts` and `tests/engine/`.

Private full snapshots and client-supplied player identity remain known security gaps for later phases. This smoke gate verifies that restructuring preserves gameplay, not that the application is hardened.
