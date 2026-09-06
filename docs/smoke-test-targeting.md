# Targeting Smoke Test

Verifies the end-to-end tap-based targeting flow: cast a spell → tap a legal target on the battlefield → validate at cast time → re-validate at resolve time.

## Setup

1. Start the server: `npm run dev`
2. Start the client: `npm run dev:client`
3. Open two browser tabs to the client URL.
4. Create a room in tab 1, join it in tab 2.
5. Play RPS to start the game (both players play a card).

## Scenario: Cast 火焰箭 (fire-bolt) targeting a creature

1. Draw 火焰箭 into your hand (it is in the test deck).
2. Ensure an opponent creature is on the battlefield.
3. Left-click 火焰箭 in your hand.
   - **Expected:** A targeting banner appears at the bottom: "Choose target — 火焰箭".
   - **Expected:** Legal creature cards on the battlefield glow with a gold pulsing outline.
4. Tap a legal creature on the battlefield.
   - **Expected:** The creature's outline turns red (selected). Banner shows "(1 selected)".
5. Click **Confirm** in the banner.
   - **Expected:** The spell goes on the stack. When it resolves, the chosen creature takes 2 damage (`damageTaken` becomes 2).

## Scenario: Deselect and re-select

1. Enter targeting mode for 火焰箭.
2. Tap a creature → it becomes selected (red outline).
3. Tap the same creature again → it becomes deselected (gold outline).
4. Tap a different creature → it becomes selected.
5. Click **Confirm**.

## Scenario: Cast with no legal target

1. Ensure there are NO creatures on the battlefield.
2. Left-click 火焰箭 in your hand.
   - **Expected:** Targeting banner appears. No cards glow.
3. The **Confirm** button is disabled (no target collected).
4. Click **Cancel**.
   - **Expected:** Banner disappears; the spell is not cast.

## Scenario: Cast a non-targeting card (e.g. 帝國奴僕)

1. Left-click 帝國奴僕 in your hand.
   - **Expected:** No targeting banner; the card is cast immediately (existing behavior unchanged).

## Scenario: Cancel targeting

1. Enter targeting mode for 火焰箭.
2. Click **Cancel** in the banner.
   - **Expected:** Banner disappears; targeting mode ends.