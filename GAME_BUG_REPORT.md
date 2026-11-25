# Card Game Bug Report

November 19, 2026 · Windows · Microsoft Edge and Google Chrome · `localhost:3000`

These findings come from black-box testing with two local accounts and saved 60-card decks. Priorities reflect player impact. The [full QA audit](GAME_ROOM_QA.md) records coverage and usability recommendations.

## Regression retest · November 19, 2026

All seven reported behaviors passed the targeted retest on the refreshed localhost build. The original observations remain below for reproduction history. Edge hosted and Chrome joined.

| ID | Retest result |
| --- | --- |
| ROOM-01 | Edge had a tapped land, no creatures, and both players’ auto-pass toggles enabled. After entering combat through priority passes, **No attacks** recorded the declaration and displayed “No attackers declared.” The match reached End of Combat, then Turn 2. |
| ROOM-04 | At 150% zoom in the same approximately 1,028-pixel-wide Edge window, the board and the primary phase control stayed visible. Edge was restored to 100% after the check. |
| ROOM-05 | Edge placed the open log above the phase panel at 100% and 150% zoom. **Go to combat** and **No attacks** were usable while the log was open at 100%. |
| ROOM-06 | The header now says **Current match**. Clicking it in Edge preserved the enabled auto-pass state and the same room. |
| ROOM-02 | The newly played land’s Edge preview omitted **Summoning Sick**. The visible one-click **Tap for mana** button worked, and the preview then showed **Tapped**. |
| ROOM-07 | Both browsers initially showed “Your turn to pick.” The prompt included “Opponent is ready” when the other player had already chosen. |
| DECK-01 | Edge reported “Imported 0 eligible cards. 2 copies need correction.” The unknown ID remained visible for correction and was excluded from the minimum. |

The room now explains `W = cold energy`. The land’s right-click menu showed the same mana action and a working **Close actions** control. The retest also verified pregame **Leave room** in Chrome and confirmed that a paid Frost Soul spell resolved and appeared on both boards. Creature combat, blockers, and full keyboard coverage were outside this retest.

## Original bug list

| ID | Priority | Bug | Observed in |
| --- | --- | --- | --- |
| ROOM-01 | P1 | **No attacks** can stall the match | Edge active player, Chrome opponent |
| ROOM-04 | P2 | Browser zoom can hide the entire match | Edge |
| ROOM-05 | P2 | Game Log overlaps the phase controls | Edge |
| ROOM-06 | P2 | Clicking **Play** in a live room resets auto-pass | Edge |
| ROOM-02 | P3 | A land displays **Summoning Sick** while it can tap | Edge and Chrome |
| ROOM-07 | P3 | Opening-choice status tells players to wait before they pick | Edge and Chrome |
| DECK-01 | P3 | Deck import reports unknown cards as imported | Edge and Chrome |

## ROOM-01 · No attacks can stall the match

1. Host a two-player room in Edge and join from Chrome. Get to an Edge turn with no creatures on the battlefield.
2. Enable **Auto-pass when no actions** in both browsers. Play a land in Precombat Main and tap it for mana.
3. Let priority passes take the game through Beginning of Combat to **Declare Attackers**. Click **No attacks** in Edge.

**Actual.** Edge still shows **No attacks**. Chrome shows “Waiting for opponent’s combat declaration.” Both logs stay at the same event count. Turning off auto-pass in both browsers after the stall and reloading Edge did not recover the match.

**Expected.** Submit an empty attacker declaration, acknowledge it, and allow both players to pass priority into End of Combat. If the declaration is rejected, explain the reason and give the player a way to proceed.

**Reproduction evidence.** Observed on Edge’s Turn 1 and again on Turn 2 in a separate room. The two runs stopped at 10 and 30 log events. In a control run, Chrome successfully submitted **No attacks** on an empty battlefield with auto-pass off from the start. That run advanced to Turn 2. The exact trigger remains unisolated.

## ROOM-04 · Browser zoom can hide the entire match

1. Open a live match in Edge in a landscape desktop window approximately 1,028 pixels wide.
2. Increase browser zoom from 100% to 150%.

**Actual.** The board and match controls are replaced by **Turn your device sideways**. The notice specifies a minimum width and height. Returning to 100% restores the live board.

**Expected.** The board and essential controls remain usable at increased zoom. If the viewport falls below a supported size, give desktop-specific recovery instructions and keep a clear path back to the match.

## ROOM-05 · Game Log overlaps the phase controls

1. In Edge, enter a live match and play through several priority passes so the log contains multiple entries.
2. Open the vertical **Log** tab while the bottom-right phase panel is showing **Continue**.

**Actual.** At the tested window size, the open log overlaps the phase panel and its primary button. The button is harder to read until the log is closed. Click interception was not verified.

**Expected.** The log and the current phase action remain readable and independently usable while the log is open.

## ROOM-06 · Clicking Play in a live room resets auto-pass

1. In a live Edge match, turn **Auto-pass when no actions** on.
2. Click **Play** in the room header.

**Actual.** Edge ends up back in the same room, with auto-pass set to **Off**. The player has to re-enable it to resume automatic priority passing.

**Expected.** Returning to the same live match preserves the player’s current auto-pass selection.

## ROOM-02 · A land displays Summoning Sick while it can tap

1. Play `ancient-weapon-battlefield` and inspect the newly played land on the battlefield.
2. Right-click it and select **Tap: add 1 white mana** before it has been in play for a full turn.

**Actual.** The preview shows **Summoning Sick**, yet the land taps and adds one mana. This was observed on the turn the land entered in Edge and during the opponent’s next upkeep in Chrome.

**Expected.** The preview shows only statuses that apply to the land’s current actions. When tapping is legal, the status display should make that clear.

## ROOM-07 · Opening-choice status tells players to wait before they pick

1. Create a room and have the second player join.
2. Read the status under **Rock**, **Paper**, and **Scissors** before either player chooses.

**Actual.** The screen says “Waiting for opponent’s pick” while the local player still needs to choose and all three buttons are enabled.

**Expected.** Prompt the local player to choose. Show the waiting message after their own choice is locked in.

## DECK-01 · Deck import reports unknown cards as imported

1. Open **Decks → Import/Export** with an empty draft.
2. Enter `2 zzqa_no_such_card_731` and click **Import text**.

**Actual.** The summary says “Imported 2 cards.” Validation flags the same ID as an unknown card definition, while the draft count shows two cards toward the minimum.

**Expected.** Report zero valid cards imported. If the editor retains the unknown entry for correction, exclude it from the valid-card count and identify it separately.

The cold-energy versus white-mana terminology remains a rules question. The catalog uses `W` for cold-themed cards, which is consistent with an intentional mapping. Concede controls and unverified combat outcomes are tracked in the QA audit.
