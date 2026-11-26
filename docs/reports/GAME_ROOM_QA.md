# Game room QA

November 19, 2026 · Windows · Microsoft Edge and Google Chrome · `localhost:3000`

Black-box testing through the browser UI with two disposable players. Both browsers hosted a room across the smoke test and audit. The combat progression retest used Edge as host and Chrome as guest. A second 60-card deck with affordable creatures and artifacts was saved for each player for deeper combat checks.

## Bugs and discrepancies

| ID | Severity | Finding | Reproduction and observed result |
| --- | --- | --- | --- |
| ROOM-01 | High | **No attacks** can stall the match on **Declare Attackers**. | Reproduced twice with Edge as the active player, no creatures in play, a tapped land, and auto-pass enabled when entering combat. The enabled button stayed visible, Chrome waited for the declaration, and the logs stayed at 10 and 30 events respectively. Reloading Edge or disabling both auto-pass toggles after arrival did not recover the stalled state. A separate Chrome turn with an empty battlefield and auto-pass off from the start accepted **No attacks**, exposed **Continue**, and skipped to **End of Combat** after both players passed. The two paths differ by browser, board state, and how combat was entered. The exact trigger remains unisolated. |
| ROOM-02 | Medium | A newly played land is labeled **Summoning Sick** even though its tap ability works immediately. | In Edge, play `ancient-weapon-battlefield`, then inspect it on the battlefield. The preview shows **Summoning Sick**. Right-click the land and select **Tap: add 1 white mana**. The land taps and the mana pool gains one. The status display suggests a restriction that the observed action does not enforce. |
| ROOM-03 | Needs rules verification | The land’s printed resource and action label use different terminology. | `ancient-weapon-battlefield` describes producing one cold-element energy (`寒屬性能量`). The action menu, mana pool accessibility label, and log all say white mana. Cold-themed creatures in the catalog display a `W` cost, consistent with a deliberate mapping. Explain that mapping in the room. |
| ROOM-04 | Medium | Browser zoom can make the game room unusable. | In the approximately 1,028-pixel-wide Edge window, increasing page zoom from 100% to 150% replaced the live board with **Turn your device sideways** and hid all match controls. Returning to 100% restored the same match. The message gives minimum dimensions, but its heading is misleading on a landscape desktop. Provide a usable compact board or a desktop-specific recovery message. |

## Usability improvements

- Put **Tap for mana** on the land itself or in a discoverable action button. The action was reachable by right-click, while the visible preview offered no activation control. Verify the resulting control can be reached and activated by keyboard.
- Keep the **Game Log** clear of the phase controls. At the observed Edge window size, the open panel overlaid the phase card and its primary button. The vertical log tab worked for opening and closing, and the empty log had an explicit empty state.
- Translate log actors into **You** and **Opponent**. Entries such as `by tab:6dad` and raw change counts make an otherwise useful history harder to scan.
- Show **Your turn to pick** before a player chooses Rock, Paper, or Scissors. The initial screen says “Waiting for opponent’s pick” while the local player still has an action to take. After both selected Scissors, Edge was assigned first and the display gave no reason for the tie-break. Make the tie rule visible in the result.
- Show the room code beside **Copy room ID** and give clear **Copied** feedback. The clipboard worked and the copied code joined the correct room. The observed button and waiting screen did not show a copy acknowledgment.
- Explain why a card cannot be played before the click where possible. An unaffordable creature produced “Invalid mana payment.” Showing the amount and color still required would make that feedback actionable. The second-land rejection already gave a clear reason.
- Mark **Home** and **Decks** as opening a new tab from the room. Both preserved the original match, but browser tabs shared a similar title and the room UI gave no indication that a new tab had opened. Clicking **Play** returned Edge to the same room with auto-pass reset to Off. If **Play** means return to the active room, preserve the preference and make the destination clear.
- Distinguish the local connection from opponent presence. After the Chrome match tab closed, Edge continued to show **Live** without a visible peer-offline message during the observation. Edge later returned to the lobby and could start a fresh room. During the original active match, a separate lobby showed an enabled **Create New Room** button and explained the account restriction only in a brief toast after clicking. Show the restriction and a way back to the live tab before the click.

## Click and control audit

| Area | What the test showed | Assessment |
| --- | --- | --- |
| Clicks per action | Playing a legal land took one left-click. Tapping it took one right-click to open the menu and one left-click to select the only action. Copying the room ID and toggling the log each took one click. | Keep direct actions direct. Put **Tap for mana** on the permanent as an explicit one-click control, with a keyboard equivalent. |
| Clicks per turn | In the fully manual empty-board run, both players took eight phase/priority actions to reach **Declare Attackers**, one click to submit **No attacks**, and two more priority passes to reach **End of Combat**. | Eleven shared actions for an empty stretch of play is a lot. Preserve response windows while using reliable auto-pass or a clearly scoped yield option to reduce repetition. |
| Auto-pass | Both players progressed through steps with no legal actions. It paused when the active player could play a land, and it stayed paused when the responding player had an untapped mana source. The countdown showed up to five seconds. Combat declaration still required input. | The basic behavior matched the toggle label. The empty-attack stalls occurred after auto-passed combat entry, so that transition needs investigation. **Waiting for no legal actions** is vague. Tell the player whether a land ability, a declaration, or the other player is holding the step. |
| Phase panel | The bottom-right panel identified the phase and showed one primary action, including **Go to combat** and **No attacks**. It used the same generic **Continue** across several steps. On a successful **No attacks**, the phase title stayed on **Declare Attackers** and only the button changed to **Continue**. An open log overlapped the panel in Edge. | The phase and primary action are useful. Show a confirmation such as **No attackers declared** after submission and label priority actions **Pass priority**. Keep the panel in view while the log is open. |
| Card option and detail panels | Right-click opened a small **Tap: add 1 white mana** panel with no visible keyboard hint. The large card preview and native tooltip sometimes overlapped it. | The panel needs clearer action affordances and layering. Keep the preview from covering actions, leave one visible way to dismiss the panel, and expose the same actions without right-click. |
| Left versus right click | Left-click on a hand card attempted to play it immediately. Left-clicking a battlefield land produced or retained the hover preview, while right-clicking exposed **Tap**. The empty **Graveyard** counter did not open a panel when clicked. | The behavior is functional but hard to infer. Use a consistent rule for selection and inspection, expose named actions on the board, and style read-only counters differently from controls. |

## Verified coverage

| Control or flow | Observed result |
| --- | --- |
| Host, wait, copy ID, join | Edge hosted, the waiting state appeared, and Chrome joined by pasting the copied ID. The earlier smoke test also verified Chrome hosting and Edge joining. |
| Rock, Paper, Scissors | All three buttons were exercised across the two runs. A choice locked in, the other browser showed readiness, Paper beat Rock, and Scissors versus Scissors assigned Edge first. |
| Opening state and draws | Both players saw five opening cards and 55 cards remaining. The starting player drew to six, and the opponent hand and deck counts updated. |
| Continue and auto-pass | Manual priority passed between browsers. With both players set to auto-pass, Upkeep and Draw advanced and the match paused in the main phase when a land was playable. Edge’s auto-pass could be turned off. |
| Play land and land limit | A land moved from hand to battlefield and updated the opponent board. A second land was rejected with “No land plays remaining this turn.” |
| Unaffordable creature | The card stayed in hand and the room displayed “Invalid mana payment.” |
| Inspect and tap a land | The preview showed card details. The right-click action tapped the land, added one white mana, and logged the action. |
| Combat entry and turn handoff | In the successful manual run, **Go to combat**, **No attacks**, and subsequent passes reached End of Combat, Postcombat Main, End Step, and Turn 2. Chrome could play its first land in Postcombat Main. Edge then drew on Turn 2. The separate auto-pass path stalled as documented in ROOM-01. |
| Game log | Open and close worked. Empty and populated states appeared. Entries recorded passes, phase changes, land play, and tapping for mana. |
| Reload and resume | Chrome restored the live board after the earlier land play. Edge reloaded into the same combat step during this audit. |
| Room navigation and disconnect | Home and Decks opened separately and the original match remained accessible with the browser tab shortcut. Chrome used Tab and Enter to join from the lobby. Closing Chrome’s match tab eventually returned Edge to the lobby, where a fresh room could be created. |

## Open coverage

- Combat with creatures, attacker selection and confirmation, blocker assignment, damage, and a normal win remain unverified. A new room was created with the revised test decks, but Chrome control stopped on browser URL verification before it could join.
- Successful spell casting, stack response and resolution, targeting, and a populated graveyard remain unverified.
- The earlier **Concede** attempt stopped browser control before its outcome could be observed. The follow-up excluded **Concede** and **Concede & Leave** at the user’s request. Pregame **Leave room** also remains unverified.
- The audit covered some keyboard actions and a 150% Edge zoom check. Full keyboard traversal, screen-reader operation, touch, and other sizes remain unverified.

## Crowded match in the Codex browser

Tested in Scenario Lab at 1280 × 720 and 615 × 720. The working fixture had 13 permanents, 20 cards in hand, 26 in the library, 18 in the graveyard, and 15 in exile per seat.

| Area | Result |
| --- | --- |
| Battlefield | All 26 permanent slots rendered. Creatures and lands wrapped across rows without separate scrolling lanes or horizontal page overflow. The last land remained reachable and added one cold energy when clicked at 615 px. At that width the page grew to roughly 1,960 px tall. |
| Hand | The 20-card fan remained keyboard-operable at 1280 px. Pressing Enter on the last Frozen Snowball put it on the stack and reduced the hand to 19. At 615 px, four of the 19 card bounds extended beyond the clipped table edges. |
| Other zones | Both seats showed the expected library, graveyard and exile counts. The room displayed each graveyard and exile as a read-only count without an in-room control to inspect the cards. |
| Heavy mixed battlefield | Starting from Combat practice, a single setup recipe added 11 Frozen Snowballs, 12 Ancient Weapon Battlefields, four Ice Dragon Staffs, and three Dragon Tombs per seat, plus the same large hands and piles. The editor stayed busy and a second tab timed out loading Home. Restarting the disposable lab restored access. The minimum failing setup and cause are unverified. |
