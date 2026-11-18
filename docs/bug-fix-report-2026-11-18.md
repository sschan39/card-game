# Pregame bug fixes — 18 November 2026

The three functional defects in [the browser bug report](browser-bug-report-2026-11-18.md) are fixed in source. The player, builder, admin and server bundles have been rebuilt. BUG-01 and BUG-03 were also verified through visible browser controls at `http://localhost:3000/`. BUG-02 passes automated policy and persistence checks; the already-running server must be restarted to load its new catalog policy.

## BUG-01: Preserve the saved deck when recovering a draft

**Cause:** `apps/deck-builder/storage.ts` persisted the editable name, format and quantities but omitted the saved record ID. Returning through ordinary workspace navigation remounted the builder with `saved = null`. Its primary action therefore called `POST /api/decks`, creating another record.

**Fix:** Draft recovery now writes a version-2 envelope under the existing per-tab draft key. It contains the draft and an optional `{ accountId, deckId }` hint. Existing plain drafts remain readable. No credentials or full saved-record snapshot are stored.

`apps/deck-builder/App.tsx` verifies browser identity, fetches the current account's owned decks, and restores the update target only when both the account and record match. An unresolved recovery hint blocks saving, including after a failed list request. It cannot silently fall through to creating a duplicate. Unsaved draft changes remain intact; the verified saved record supplies the baseline for the saved/unsaved indicator.

Sign-out, account changes, New deck and successful imports discard the previous association. A successful list refresh that cannot find the record, or an update returning 404, releases the stale ID. Explicit **Save as new** continues to create a separate record. Server ownership checks remain authoritative.

**Verification:** Automated checks cover recovery, legacy drafts, invalid metadata, wrong-account and missing-record rejection, and PUT versus explicit POST requests. In the browser, a new 60-card deck was saved, renamed without saving, taken through Play → Decks, and updated. Its ID remained `6daf1109-3b63-4d3b-af77-c46b73e71273`, with one corresponding saved entry. Explicit Save as new created `6fc5757c-8245-4044-8ee7-324940d2cd19`.

## BUG-02: Align copy limits with printed exemptions

**Cause:** The card text granted a copy-limit exemption, but `packages/protocol/src/decks/config/eligibility.json` omitted it. `buildCatalog()` therefore published the default four-copy limit. Catalog Add, editor + and server validation consistently enforced that incorrect policy.

**Fix:** Treat the explicit printed exemption as authoritative and add the missing entries to the shared `unlimitedCopies` policy:

| Card ID | Published copy limit |
| --- | --- |
| `ancient-weapon-battlefield` | `null` (unlimited copies within deck size) |
| `blazing-dragon-habitat` | `null` |
| `divine-wind-torii` | `null` |
| `nether-ancient-land` | `null` |
| `thunder-main-camp` | `null` |

The four additional cards had the same omission and identical exemption wording. The existing client controls and shared validator consume the catalog's `copyLimit`; no UI-only exception or runtime interpretation of rules text was introduced. The 60–250-card deck-size rule and other cards' configured limits still apply.

**Verification:** A regression checks every catalog card carrying this exemption wording against the compiled policy. Separate checks accept a 60-copy Battlefield deck, create its saved record, update it to 250 copies with the same ID, and reject 251 copies. Existing four-copy and custom-limit tests also pass. The fifth-copy browser check remains pending until the running backend is restarted.

## BUG-03: Leave the room route when its session ends

**Cause:** The socket `sessionEnded` handler cleared authentication and room state but left `/play/rooms/:roomId` in the address bar. `App.tsx` renders the match view for that route even without a room, producing the unexplained loading board.

**Fix:** `apps/game-client/socket.ts` now uses the existing `returnToLobby()` cleanup for ended sessions, clearing snapshot recovery, cached room state and the room URL together. It changes the route to `/play`, notifies the router, and retains the existing message: **Session ended. Sign in again to continue.** The account menu uses the same cleanup when signing out from a room; signing out on Home does not force navigation. The special linked-session handoff retains its existing behavior.

**Verification:** A socket regression asserts the lobby URL, router notification, cleared credential and room, and session-ended message. In the browser, a waiting room was created in one tab and **Sign out this browser** was selected in the builder tab. The affected room tab displayed **Play / Lobby**, the lobby controls and the session-ended explanation. No opponent joined and no gameplay was exercised. Sign-in/resume after revocation was not tested and is not claimed to restore the previous seat.

## Automated results

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test -- tests/client tests/shared tests/architecture tests/server/deck-validation.test.ts` | Passed: 45 files, 516 tests |
| `npm run build` | Passed: server, player, admin and deck builder |
| Acceptance run including `tests/server/deck-acceptance.test.ts` and `tests/server/browser-navigation.test.ts` | Blocked by environment: 19 failures from denied `127.0.0.1` connections (`EACCES`) and a resulting socket timeout; these acceptance suites are not reported as passing |

No full-suite coverage result is claimed. The independent browser checks used `localhost`, as requested.

## Activate and recheck

The new bundles are built. Stop the existing local server, then start it normally with `npm start` to load the new copy-limit policy. Reload open application tabs. No database migration is required.

1. Save a deck, navigate Play → Decks, edit and update it. Confirm its ID and saved-record count remain unchanged. Confirm Save as new creates a different ID.
2. Add a fifth Battlefield copy through both catalog Add and editor +. Import and save a valid 60-card deck containing more than four copies. Confirm the overall 250-card limit still applies.
3. Leave a waiting room open, sign out in a sibling tab, and confirm the room tab reaches the lobby with an explicit session-ended message.
4. Run the HTTP/socket acceptance suites in an environment that permits their loopback connections.

Two clearly named regression decks were added to the existing local test account `playtest-b-1118`: `Bugfix regression 1118 renamed` and `Bugfix regression 1118 copy`. Existing duplicate decks were retained. Unrelated workspace changes, including the pre-existing `ARCHITECTURE.md` edits, were left untouched.
