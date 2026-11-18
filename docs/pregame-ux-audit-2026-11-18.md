# Pregame interaction audit — 18 November 2026

## Scope and method

Audited the visible Home, Play lobby, account menu, card catalog, deck editor, My Decks, and Import/Export flows in the Codex browser at `http://localhost:3000/`. Used visible controls, text entry, and keyboard actions, including malformed imports, incorrect credentials, invalid room codes, missing deck selection, and invalid deck sizes. Tested primarily at the browser's approximately 580 × 603 default viewport. A temporary 1280 × 800 viewport was used to inspect the waiting-room shell, then reset.

The user explicitly narrowed the audit to before the game room. Match setup beyond the waiting room, combat, card effects, and exhaustive card checks remain untested. This is an exploratory audit of the exercised flows, not exhaustive coverage of every branch or device.

Confirmed functional defects have separate reproduction reports in [the bug report](browser-bug-report-2026-11-18.md). The findings below are usability gaps and recommendations; they do not all imply broken game logic.

## Findings

Follow-up: UX-01, UX-02, UX-03, UX-04, UX-06 and UX-07 now have implementation and verification evidence in [the phases 0–3 verification report](pregame-verification-2026-11-18.md). UX-08 was explicitly excluded; UX-05 and UX-09 remain deferred. The observations below record the original audit behavior.

| ID | Priority | Finding | Observed behavior | Suggested change |
| --- | --- | --- | --- | --- |
| UX-01 | High | The application starts on Play, where a new guest cannot meaningfully proceed | `/` opens the Play lobby with Create New Room and Join. Guest Create and Join require an owned saved deck, but sign-in and saved-deck prerequisites are not explained beforehand. Creating without a deck produces `Select an owned saved deck before joining a match.` even though the action was Create. | Start new visitors on Home or provide a visible setup sequence: sign in/create account, choose or build a deck, create/join. Offer a starter deck. Make blocked actions explain and link to the missing step. This is the first problem specifically identified by the user. |
| UX-02 | Medium | Import hides deck validation in another tab | Importing `2 does-not-exist` leaves the user in Import/Export without a visible invalid-deck summary there. Switching to Create reveals `Use 60–250 cards.` and `does-not-exist: Unknown card definition.` | Show import results and validation next to the text input, including imported count and actionable errors. Link directly to affected rows or the editor. |
| UX-03 | Medium | Empty-deck validation is not actionable | A new empty deck displays only `Invalid deck structure.` and a disabled Save deck button. A nonempty undersized deck gives the much better `Use 60–250 cards.` | Show deck-size and copy-limit rules from the start, with progress toward the minimum. Avoid an implementation-oriented structural error for the normal empty state. |
| UX-04 | Medium | Short-password registration returns the wrong kind of explanation | With a five-character password, Create account displays `Invalid public sign-in request.` The page separately says new passwords need at least 15 characters. | Validate the password inline and state the unmet length requirement. Use account-creation language for registration failures. |
| UX-05 | Medium | A room owned by the account is difficult to recover from another tab | Attempting to join in a second tab returned `This account already has a room. Leave it before joining another.` Home says only a room owned by the current game tab can be resumed there. The error provides no direct path to the existing room. | Provide an explicit route to the existing room or a clear account-level room-management flow. Explain the difference between browser sign-in and a game tab's seat. |
| UX-06 | Low | Enter does not submit the join field | With a saved deck selected and `NO-SUCH-ROOM` entered, pressing Enter produced no visible result. Clicking Join then returned `Room not found`. | Make the join controls a keyboard-submittable form with the same validation as the Join button. |
| UX-07 | Medium | Building a large quantity requires repetitive clicking or technical import | The deck editor exposes per-card −, +, and remove-all controls, but no quantity input. Import supports quantities, but requires card IDs such as `land-red`. | Add an editable quantity or bulk-add control with visible limits. Keep ordinary deck construction possible without knowing internal card IDs. |
| UX-08 | Low | Export requires manual text handling | Export deck to text writes the result into the Deck text box. No dedicated Copy or Download control was visible in that panel. | Add Copy text and Download deck controls with confirmation feedback; keep the editable text for users who want it. |
| UX-09 | Medium | Session actions use overlapping concepts without explaining their effects | The account menu offers End this game session, Sign out this browser, and Sign out all public sessions. Their different scope is not explained alongside the actions. Browser sign-out also affects other open game tabs. | Add a short scope explanation for each action and make the expected cross-tab effect clear. Use an explicit session-ended state when applicable; see BUG-03. |

## Checks that worked

| Area | Exercised check | Result |
| --- | --- | --- |
| Home | Guest and signed-in entry states | Visible navigation and deck-building links; the guest state explains that browsing and drafting are public. |
| Catalog search | Nonsense query and Chinese card-name query | Correct no-results state and matching result. |
| Catalog filters | Land + red + 血炎山 | Returned the expected single land. |
| Catalog legality | Toggle Deck-legal only | Result count changed from 155 to 159; fixture cards could be browsed but their Add buttons were disabled with help text `Not legal in saved decks`. |
| Authentication | Incorrect sign-in password | Clear `Invalid username or password.` feedback; sign-in with valid test credentials worked. |
| Registration | Valid local test accounts | Account creation completed through the visible account form. |
| Import syntax | `four empire-servant` | Reported `Use "quantity card-id" on line 1.` |
| Import and save | Valid 60-card test decks | Imported, validated, and saved successfully. |
| Saved editing | Reduce 60 cards to 59 | Update/Save as new disabled, `Use 60–250 cards.` shown, and unsaved state explained. |
| Saved editing | Restore to 60, rename, update | Update succeeded and the editor showed `This version is saved.` |
| Export | Export saved test deck | Deck text contained the deck name, format, and quantities. Reimport of the exported text was not independently tested. |
| My Decks | Edit a saved entry | Returned to the editor with saved-deck update controls. |
| Lobby | Whitespace-only join input | Join disabled. |
| Lobby | Invalid room with a saved deck and no existing room | `Room not found`; the lobby remained usable. |
| Lobby | Same account attempting another room | Request rejected with an explicit existing-room message. |
| Deck-to-game handoff | Play from My Decks | Opened a separate game tab with the intended deck selected. |

## Additional observations and limits

- The default narrow viewport can reach onboarding and build decks, but the waiting-room screen requires at least 900 px width and 520 px height. Warn about this before entering a room if that restriction remains intentional.
- At one scrolled lobby position, page text was visible behind the fixed/translucent header. This is a visual-polish observation, not a confirmed initial-layout defect; a later top-of-page view placed the hero correctly.
- Before an opponent joined, the room shell displayed 20 life, a zero-card deck, an empty hand, and a main phase. A dedicated waiting state would be clearer. No deck-loss bug was established.
- The duplicate My Decks entries from BUG-01 were visually indistinguishable by name and count. Dates, summaries, or explicit version information would help users distinguish saved versions.
- Windows Chrome input/screenshot control was unreliable during the attempt to establish an independent opponent identity. This is a test-environment limitation, not a product bug.
- No automated tests, code changes, account deletion, or deletion of existing decks were performed.

## Suggested order

1. Fix the starting experience in UX-01 so a new player can understand and complete setup.
2. Fix saved-deck identity and accidental duplication (BUG-01).
3. Make displayed card rules agree with deck validation (BUG-02).
4. Improve session termination/recovery and existing-room navigation (BUG-03, UX-05, UX-09).
5. Bring validation beside the action that caused it, then reduce repetitive deck-building interactions.
