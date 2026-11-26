# Pregame phases 0–3: verification

Date: 18 November 2026 (Hong Kong)

Scope: verify the current implementation through phase 3, excluding UX-08. This is a new check of the current working tree; the earlier 516-test result is not used as evidence here. No application source changes were needed during this verification.

## Result

The exercised onboarding, validation, quantity editing, saved-deck identity, same-tab Play and session-ended flows pass. The release gate remains incomplete: the full suite cannot complete successfully under the current loopback restrictions, and the existing server still serves the old copy-limit policy.

| Check | Result | Evidence |
| --- | --- | --- |
| Typecheck | Passed | `npm run verify` completed `tsc -b` and proceeded to coverage |
| Focused new/affected regressions | 43 passed, 3 files | `docs/reports/evidence/verification-focused-2026-11-18.log` |
| Client, shared, architecture and deck-policy regressions | 522 passed, 46 files | `docs/reports/evidence/verification-regressions-2026-11-18.log` |
| Full test/coverage attempt | 3,636 passed; 150 failed; 13 failed files out of 257 | `docs/reports/evidence/verification-2026-11-18.log`; not a passing coverage result |
| Builds | Passed: server, game client, admin, deck builder | `docs/reports/evidence/verification-build-2026-11-18.log`; separate build run because verify stops on test failure |
| Whitespace checks | Passed | `git diff --check` |

The focused 43 tests are included in the broader runs, not an additional independent test count.

## Browser checks at localhost:3000

Used visible UI controls and keyboard input. Started with the existing local test account `phase3-test-1118`, which had no saved decks. Tested both the browser's default narrow view and a temporary 1280 × 800 desktop view; this was functional smoke verification, not a complete responsive/accessibility audit.

| Finding / behavior | Observed result |
| --- | --- |
| UX-01: entry and setup | Bare `/` renders Home. Signed-in/no-deck state offers Build your first deck. Guest Home offers Sign in / Create account and explains public drafting. Guest Play explains the prerequisite and disables room actions. |
| UX-02: rule-invalid import | `2 does-not-exist` imports two cards and displays count, minimum-size error, unknown-card error and Open in editor beside the text box. |
| UX-02: malformed import | `not a valid deck line` reports the line-specific syntax error and says the draft is unchanged. Returning to Create confirms the preceding two-card draft remains. |
| UX-03: empty deck | Displays `0 / 60 minimum cards`, maximum 250, copy-rule guidance and naming guidance; Save is disabled. |
| UX-04: registration | Both account forms reject a short password inline with `Use 15–128 characters for your new password.` No account was created by these checks. |
| UX-06: keyboard Join | With a saved deck selected, Enter on a whitespace-padded nonexistent room code submits and returns `Room not found`. The entered text remains and the form is usable again. |
| UX-07: direct quantities | Changing land-red from 1 to 60 commits on Enter. Changing empire-servant from 1 to 4 commits on blur. |
| UX-07: rejection | Fifth empire-servant copy is rejected. Fractional input is rejected. Land quantity 251 is rejected; 247 lands with four other cards is rejected by the total 250-card limit. Failed edits leave the displayed deck total unchanged. |
| UX-07: Escape / zero | Escape restores the previously committed quantity and removes its error. Setting empire-servant to zero removes the entry. |
| Saved-deck identification | My Decks displays card count, updated time and a short stable ID. Two intentionally same-name records are distinguishable. |
| Same-tab Play | Clicking a My Decks Play link keeps browser tab 2, reaches `/play`, consumes the deck handoff and shows the intended saved deck selected. The tab inventory still contains one tab at this point. |
| BUG-01: update identity | Save → Play → Decks recovers Update saved deck. Changing 60 lands to 61 and updating retains the same saved ID. |
| Explicit Save as new | Creates a different ID, explains that the copy is now being edited, and leaves both records visible. |
| Room setup | Create New Room with the saved deck reaches a waiting room. No opponent joined; gameplay was not tested. |
| BUG-03: sibling sign-out | Sign out this browser in a separate builder tab returns the room tab to `/play` with `Session ended. Sign in again to continue.` Guest prerequisites and disabled room buttons are visible. |

The two retained test decks are both named `Verification phase 3`, with 61 land-red cards:

| Purpose | Saved ID |
| --- | --- |
| Original, updated after navigation | `ef8d2ed6-80dd-4eb5-b83c-8af4dc161b38` |
| Explicit copy | `6594ab61-f8e8-4b07-9f60-3ca271563676` |

These all-land records are validation fixtures, not recommended playable decks. Existing user records were not deleted. The test account was signed out for the cross-tab test.

## Same-tab decision

Play from Home and Decks stays in the current tab. Shared-header regression coverage confirms that Play has no new-tab target, while Home and Decks retain their separate-tab target when a room is active. A live click on Decks left the active room tab in place, but a new popup did not appear in the accessible tab inventory; successful opening of that popup is not claimed.

The existing waiting-room layout and minimum gameplay viewport remain phase-4 work. At the default narrow view, the room shows the landscape/size gate; at 1280 × 800 it shows the existing waiting board shell.

## Remaining blockers and follow-up

1. **Restart the existing server on port 3000.** The catalog still exposes four copies for Ancient Weapon Battlefield and the other newly corrected exemptions. The source policy and automated deck-policy/persistence tests pass, but the fifth-copy browser check is not yet verified against the active backend. Rebuilt server bundles are ready. A separate rebuilt instance started on port 3001 with an isolated test database, but the browser timed out reaching it; that instance was stopped.
2. **Run `npm run verify` where Node can connect to loopback.** The full attempt grouped 143 failing tests under `fetch failed` / `connect EACCES 127.0.0.1`, and seven under session-ready socket timeouts. The live-routing suite additionally fails its teardown assertion because no room timers were created after the connection failures. These are failed/blocked checks, not evidence that the HTTP/socket behavior passed. Coverage thresholds were not changed.
3. **Finish the broader acceptance matrix before release.** Network-failure/retry transitions, successful two-identity Join, duplicate pending submission, timeout/reconnect races, import-cancel recovery association and a full keyboard/layout/accessibility pass were not independently exercised in this browser run. Pure readiness, password normalization, handoff routing, quantity policy and recovery-identity cases are covered by the passing regressions.

UX-08 Copy/Download remains excluded. Phase 4 room recovery and session-scope explanations remain deferred, as requested.
