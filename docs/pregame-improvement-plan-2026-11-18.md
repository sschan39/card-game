# Pregame improvement plan

Date: 18 November 2026 (Hong Kong)

Status: Phases 1–3 are implemented in the working tree, excluding UX-08 as requested. Phase 0 activation and the full acceptance gate remain incomplete. See [the current verification report](pregame-verification-2026-11-18.md) for passed checks, browser evidence and remaining blockers. Phase 4 remains deferred.

## Goal and scope

Help a new player understand setup, build or select a valid saved deck, and create or join a waiting room without unexplained errors or repetitive work. Help returning players distinguish saved versions and recover from session or room problems.

This plan covers UX-01 through UX-09 in [the pregame audit](pregame-ux-audit-2026-11-18.md), the three fixes documented in [the fix report](bug-fix-report-2026-11-18.md), and the audit's related waiting-room and layout observations. Gameplay rules, combat, card effects and a general match-layout redesign remain outside this scope. Existing bug fixes are the baseline to preserve.

## Delivery order

| Phase | Outcome | Findings covered | Relative size | Dependencies |
| --- | --- | --- | --- | --- |
| 0 | Verify and activate the bug-fix baseline | BUG-01, BUG-02, BUG-03 | Small | Matching server and frontend builds; permitted loopback testing |
| 1 | Make the path into a room understandable | UX-01, UX-06 | Medium | Phase 0; existing account and deck APIs |
| 2 | Explain validation where the player acts | UX-02, UX-03, UX-04 | Medium | Phase 1 establishes the setup states |
| 3 | Make building and choosing decks faster | UX-07, UX-08; saved-deck identification | Medium | Shared validation and quantity bounds |
| 4 | Explain sessions and recover waiting rooms | UX-05, UX-09; waiting state and viewport guidance | Large | Server ownership contracts and short HTTP/socket acceptance tests |

Deliver each phase as a reviewable change. Phase 4's UI explanations can ship earlier; its server recovery actions should be reviewed separately from presentation changes. The smallest useful release is Phases 0–2.

## Phase 0: Verify the fixed baseline

1. Restart the local server with the rebuilt bundle and reload the applications so the new copy-limit policy is active.
2. Verify the fifth copy of Ancient Weapon Battlefield through catalog Add and editor +, then import and save a valid deck containing more than four copies. Check the other four corrected exemptions and the overall 250-card limit.
3. Repeat save → navigate → edit → update, asserting the same saved ID and record count. Verify explicit Save as new creates another ID.
4. Repeat browser sign-out with a waiting-room tab open and confirm the explicit lobby recovery state.
5. Run the HTTP/socket acceptance suites in an environment that permits their loopback connections. The previously reported 19 environment-related failures remain an open verification item.

Completion: the source fixes and the running application agree, and the acceptance record distinguishes passing checks from blocked checks. Retain existing test decks unless a separate cleanup is requested.

## Phase 1: Guide entry and room setup

**UX-01: Give new visitors a clear starting point.** Resolve bare `/` to Home. Preserve `/play`, explicit room routes and legacy root URLs carrying a deck handoff; a valid or invalid `deckId` request must reach the existing handoff flow rather than disappear in a redirect. Preserve unrelated URL fields where navigation already supports them. Keep active-room restoration working.

Show an actionable setup sequence on Home and Play:

| Player state | Primary action | Supporting feedback |
| --- | --- | --- |
| Signed out | Sign in / Create account | Browsing and drafting remain available; saving and room setup require an account |
| Signed in, no saved deck | Build your first deck | Explain how to reach a valid saved deck |
| Saved-deck list loading or failed | Loading / Retry | Do not present missing data as an empty collection |
| Signed in, eligible deck selected | Create room / Join room | Show the selected deck name and card count |
| Existing room | Resume or manage room | Use only actions supported by verified ownership; complete the richer flow in Phase 4 |

Derive readiness from the current session, verified deck selection, loading state and handoff state. Place explanations next to unavailable actions. Server ownership and legality checks still decide whether room setup succeeds. Use action-specific error wording for Create versus Join.

**UX-06: Support keyboard joining.** Convert the join controls to a form. Enter and clicking Join use one submit handler, trimming and checking the code once. Prevent duplicate submissions while a request is pending, and retain the entered code when an error occurs.

Main locations: `packages/browser-session/src/index.ts`, `apps/game-client/App.tsx`, `components/Home.tsx`, `components/StartScreen.tsx`, `hooks/useGameActions.ts`, and the server's room-setup errors in `apps/server/src/application.ts`.

Acceptance: a fresh guest can identify the next step without triggering a server error; an account with no decks has a direct builder action; Enter produces the same join result as clicking; direct `/play`, room links and deck handoffs retain their intended behavior.

## Phase 2: Put validation beside each action

**UX-02: Show import results in Import/Export.** Distinguish a syntax error, which preserves the current draft, from a syntactically valid import with deck-rule errors, which remains editable. Show imported card count, validation issues and an Open in editor action in the transfer panel. Preserve the existing replace-draft confirmation and clear the saved-record association only when replacement actually occurs. Reuse `validateDeck` for rule results.

**UX-03: Explain an empty or incomplete deck.** Start with `0 / 60 minimum cards`, the 250-card maximum and the applicable copy rules. Once a player starts editing, show actionable messages such as the number of cards still needed or the offending card. Keep strict server save validation; an ordinary empty editor does not need to display the generic structural-error message.

**UX-04: Make registration errors specific.** Validate registration with the same password bounds and Unicode normalization/counting as the protocol. Associate feedback with the password field and provide an account-creation message when the server rejects registration. Apply this consistently to the game and builder account menus. Preserve the separate login contract so registration requirements do not accidentally block existing login attempts. Never display raw schema details or echo passwords.

Main locations: `apps/deck-builder/App.tsx`, `model.ts`, `components/AccountMenu.tsx`, `apps/game-client/components/AccountControls.tsx`, `packages/protocol/src/rest/auth.ts`, and `apps/server/src/auth/browser-routes.ts`. Share pure validation helpers where needed; keep each application's network and state adapters local.

Acceptance: `2 does-not-exist` shows actionable issues in the panel where it was imported; malformed text preserves the previous draft; an empty draft explains how to become valid; short registration passwords receive inline feedback in both applications. Account expiry during any of these flows preserves the draft.

## Phase 3: Reduce deck-building effort

**UX-07: Add editable quantities.** Extend shared count controls with an optional quantity-input mode, enabled by the standard builder. Commit on Enter or blur; Escape restores the previous value. Temporary blank input stays local to the control. Zero removes the entry. Reject fractions, negative values, non-numbers and values above either the card's copy limit or the remaining deck capacity with a visible explanation. Keep + and − as shortcuts.

Use a pure quantity operation and the catalog's policy so catalog Add, editor quantities, imports and saves agree. Preserve Scenario Lab's separate rules when extending `packages/ui/src/BuilderControls.tsx`; its existing callers must continue to work without adopting standard-deck limits.

**UX-08: Add Copy and Download.** Keep the editable export text and add Copy text and Download `.txt` controls using the existing exporter. Report clipboard failure with a manual-copy fallback, and do not announce success before the operation succeeds. Downloaded text must round-trip through the importer, including names with Unicode or line breaks.

**Distinguish saved records.** Display card count and last-updated time in My Decks. Give same-name entries a short stable identifier as a fallback; name, count and timestamp can all collide. Keep Update and Save as new distinct and make the result of each clear. Preserve the verified recovery association introduced by BUG-01. Do not automatically merge or delete existing duplicates.

**Optional follow-up: starter decks.** Curate at least one playable 60-card list from current legal cards, show its contents, and let the player explicitly save a personal copy. Validate it against the live catalog before offering it. This is a separate content task; an all-land validation fixture should not be presented as a playable starter. Track template identity for an acknowledged save and do not automatically retry ambiguous writes.

Main locations: `packages/ui/src/BuilderControls.tsx`, `apps/deck-builder/App.tsx`, `model.ts`, and `packages/protocol/src/decks/editor.ts`. Copy/download behavior belongs in the owning frontend adapter rather than in protocol code.

Acceptance: a player can set a land quantity to 60 without 60 clicks or knowing a card ID; copy and deck-size bounds hold; copying and downloading preserve the export format; same-name saved records can be distinguished. Shared Scenario Lab controls retain their existing behavior.

## Phase 4: Explain session scope and recover waiting rooms

**UX-09: Explain each session action.** Use consistent descriptions in both account menus:

| Action | Player-facing explanation |
| --- | --- |
| End this game session | Ends this tab's game session; other game tabs and browser sign-in remain |
| Sign out this browser | Signs out Home, Play and Decks in this browser and ends its game sessions |
| Sign out all public sessions | Signs this account out of public game sessions across browsers |

Retain the explicit session-ended lobby behavior from BUG-03 and show useful recovery actions for expired, unavailable and unauthorized room links. Keep network outages distinguishable from confirmed sign-out.

**UX-05: Discover an owned room without granting another tab its seat.** Add a server-authenticated current-room summary, exposed only to the owning account. Proposed fields: room ID, waiting/started status, whether this tab can resume, and supported recovery actions. Return no credentials, opponent-private state or saved card snapshots. Define its DTO and compatible browser-session transport before wiring UI controls.

For a verified credential belonging to this tab, use the existing bearer-authenticated resume flow. For a sibling tab, explain that the game is open elsewhere and direct the player to that tab. Do not advertise a Resume button that the existing authorization checks will reject.

Provide an explicit **Leave waiting room** action for the owning account when the original tab is unavailable. The server must recheck ownership and waiting status, close the room, release its seat binding, and notify affected sockets through the existing lifecycle cleanup. Require browser-write/CSRF protections and confirmation that the waiting room will close. A room that starts between discovery and the leave request must reject this waiting-only action and refresh the summary. Never infer seat authority merely from a room ID or a matching player-ID string.

Moving an active match to another tab is a separate design decision involving credential transfer and concurrent connections. The first release keeps the existing seat boundary and does not promise cross-tab takeover or restoration of a revoked seat.

**Waiting-room clarity.** Render a dedicated view for the server's waiting status: room code and Copy action, selected deck summary, opponent status and Leave room. Display room information from verified server data. Show the board when the room advances into its supported opening/game state; hide placeholder life, hand and phase controls while waiting.

**Viewport guidance.** Make the waiting view usable at the audited narrow viewport. Before room setup, explain any retained gameplay minimum dimensions using the same configuration as the existing size gate. Do not claim mobile gameplay support from a responsive lobby alone. Verify the reported header-overlap observation before adjusting shared spacing or opacity.

Main locations: `apps/game-client/components/Home.tsx`, `StartScreen.tsx`, `GameScreen.tsx`, `AccountControls.tsx`, `RoomControls.tsx`, `RotateGate.tsx`, `apps/game-client/socket.ts`, `apps/server/src/application.ts`, auth/room lifecycle modules, `packages/protocol/src/rest/platform.ts`, and `packages/browser-session/src/index.ts`. Add a dedicated waiting-room component rather than expanding the board's placeholder state.

Acceptance: a sibling tab explains the account's existing room and offers only permitted actions; another account cannot discover or close it; leaving a waiting room frees the account to create another; a concurrent start cannot be closed through the waiting-only action; sign-out and stale links never leave an indefinite loading board.

## Validation and release criteria

Use meaningful regressions for readiness transitions, handoff preservation, atomic import failures, quantity boundaries, saved identity and room authorization/lifecycle races. Verify straightforward copy and layout changes through visible browser controls rather than implementation-mirroring tests.

| Layer | Required checks |
| --- | --- |
| Pure/client behavior | Registration versus login validation, readiness, quantity limits, import/export round-trip, account changes and saved-draft recovery |
| HTTP/socket behavior | Existing ownership/CSRF rules, current-room discovery isolation, waiting-room close and concurrent start/close, sibling sign-out |
| Browser journeys | Guest → sign in → build/import → save → select → create/join; same-ID updates; explicit copies; Enter submission; sibling sign-out; waiting-room recovery |
| Layout and accessibility | Keyboard-only setup, named quantity inputs, inline error associations and focus, narrow audited viewport and desktop layout, reduced-motion behavior |
| Repository checks | Typecheck, affected tests, architecture checks and all application builds; run the repository verify gate in a loopback-capable environment before release |

Use `http://localhost:3000/` for browser checks. Test authenticated room flows with separate player identities where needed. Assert user-visible outcomes and verified IDs; do not bypass the UI by invoking React handlers or injecting application state.

For each phase, record passed and blocked checks, changed behavior and retained limitations. Do not carry the previous 516-test result forward as evidence for future changes. Update the audit with links to implementation evidence as each finding is completed.

## Decisions to revisit during implementation

- The default is Home for a bare root visit, with explicit Play and handoff routes preserved. Revisit only if a concrete compatibility case requires it.
- Keep validation and copy-limit policy shared; keep frontend adapters and Scenario Lab rules separate.
- Use explicit server-authorized waiting-room closure for recovery. Design active-seat transfer separately if later requested.
- Reuse existing React, protocol, session, storage and room-lifecycle infrastructure. No new framework or persistent onboarding state is required for the core phases.
- Validate candidate starter lists as a separate content deliverable before promising a starter-deck shortcut.
