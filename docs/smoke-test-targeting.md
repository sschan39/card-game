# Targeting Smoke Test

Verifies the end-to-end targeting flow: cast a spell → choose a legal target → validate at cast time → re-validate at resolve time.

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
   - **Expected:** Targeting mode opens, highlighting legal creatures (matching `cardTypes: ['Creature']`).
4. Click a legal creature.
   - **Expected:** The creature is highlighted as selected.
5. Click **Confirm**.
   - **Expected:** The spell goes on the stack. When it resolves, the chosen creature takes 2 damage (`damageTaken` becomes 2).

## Scenario: Cast with no legal target

1. Ensure there are NO creatures on the battlefield.
2. Left-click 火焰箭 in your hand.
   - **Expected:** Targeting mode opens with "No legal targets" shown.
3. The **Confirm** button is disabled (no target collected).
4. Click **Cancel**.
   - **Expected:** Targeting mode closes; the spell is not cast.

## Scenario: Cast a non-targeting card (e.g. 帝國奴僕)

1. Left-click 帝國奴僕 in your hand.
   - **Expected:** No targeting mode; the card is cast immediately (existing behavior unchanged).