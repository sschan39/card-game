# Targeting Smoke Test

Verifies the end-to-end tap-based targeting flow: cast a spell → tap a legal target on the battlefield → validate at cast time → re-validate at resolve time.

## Setup

1. Start the server: `npm run dev`
2. Start the client: `npm run dev:client`
3. Open two browser tabs to the client URL.
4. Create a room in tab 1, join it in tab 2.
5. Play RPS to start the game (both players play a card).

## Scenario: Cast 破裂火球 (broken-fireball) targeting the opponent player

1. Draw 破裂火球 into your hand (it is in the test deck).
2. Left-click 破裂火球 in your hand.
   - **Expected:** A targeting banner appears at the bottom: "Choose target — 破裂火球".
   - **Expected:** The **opponent** player panel glows with a gold pulsing outline (legal target). Your own panel does **not** glow.
3. Tap the opponent player panel.
   - **Expected:** The opponent panel's outline turns red (selected). Banner shows "(1 selected)".
4. Click **Confirm** in the banner.
   - **Expected:** The spell goes on the stack. When it resolves, the opponent's life drops by 3 (20 → 17).

## Scenario: Deselect and re-select

1. Enter targeting mode for 破裂火球.
2. Tap the opponent panel → it becomes selected (red outline).
3. Tap the same panel again → it becomes deselected (gold outline).
4. Tap it again → it becomes selected.
5. Click **Confirm**.

## Scenario: Cast with no legal target

1. Left-click 破裂火球 in your hand.
   - **Expected:** Targeting banner appears. The opponent panel glows (it is always a legal target).
2. The **Confirm** button is disabled (no target collected).
3. Click **Cancel**.
   - **Expected:** Banner disappears; the spell is not cast.

## Scenario: Cast a non-targeting card (e.g. 帝國奴僕)

1. Left-click 帝國奴僕 in your hand.
   - **Expected:** No targeting banner; the card is cast immediately (existing behavior unchanged).

## Scenario: Cancel targeting

1. Enter targeting mode for 火焰箭.
2. Click **Cancel** in the banner.
   - **Expected:** Banner disappears; targeting mode ends.