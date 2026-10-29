# Milestone 6 — navigation and public-session completion report

**Date:** 29 October 2026. **Branch:** `platform/foundation`. The tracked branch was pulled first (`git pull --ff-only`: already up to date). Implementation follows roadmap 6.1–6.6 and the user's focused-testing instruction. No game rules/cards or Milestone 7 scenario features changed.

See [Appendix G](../ARCHITECTURE.md#appendix-g-navigation-public-sessions-and-planned-test-lab), [current architecture/setup](navigation-session-architecture.md) and [implementation ledger/ADRs](milestone-6-implementation.md).

## Requirement audit

| Requirement | Delivered behavior/artifacts | Evidence |
|---|---|---|
| 6.1 lifecycle/transport ADR and public continuity | HttpOnly browser-family cookie, separate tab bearers/seat owners, fixed expiry, bounded families/children/global sessions, explicit local/family/account-wide public logout | M6 ADR; real cookie/child lifecycle and complete play/update test; local/global expiry/disable checks; shared password rate-limit proof across legacy/cookie endpoints. |
| 6.1 admin/guest/migration behavior | Admin scope remains separate; server transfers guest/legacy seats only with their credential proof, retaining engine identity; legacy bearer routes remain usable | Existing auth/admin acceptance plus new guest migration, sibling denial, player-ID collision and admin-scope-preservation checks. Old schema rows and new purpose/parent fields survive reopen. |
| 6.2 shared navigation and future pages | React-only header/account slot/breadcrumbs, JSON workspace registry, server-owned destinations and bounded extra workspace pages; local admin sidebar retained | Render/registry tests show role-conditional admin entry, active-game no-opener links, configured subpages, disabled lab and escaped content. Import graph positively verifies shared UI/transport consumers. |
| 6.3 Home and compatible routes | Home reads real owned decks and verifies this tab's cached resume reference; Home, lobby, room, legacy root, builder handoff and admin hashes remain supported | Route/return/ownership tests, lobby-root lifecycle check and real HTTP static-shell/API-fallback checks. Home does not open a game connection merely by rendering/entering. |
| 6.4 active-game continuity and authority | Dedicated game tab, independently authenticated child credentials, UUID/reference-only links, server-authorized room resume/rejoin, preserved drafts and explicit safe login returns | Real sign in once → save via builder → child game/RPS/land/full turn → update via builder without revocation. Sibling/foreign/stale references fail. A matching legacy player-ID string cannot inherit a transferred seat. Delayed initialization after logout and stale identity/CSRF reads are covered. |
| 6.5 trusted instance metadata and unavailable lab | Strict `/api/platform`, actual instance ID/purpose/label/destinations; scenario capability fixed false; database identity binding and independent credentials/data | Two temporary instances reject credentials both ways; persistent database reuse under a mismatched live/lab identity fails. UI states Test Lab is unavailable. No launch/editor or installed-isolation claim. |
| 6.6 real built/Vite behavior and config | Built-origin URLs by default; explicit Vite baseline selected by `npm run dev`/`--vite`; production public apps share HTTPS origin and admin uses a distinct origin | Configuration tests cover mode/override precedence, invalid production origin mixes and safe proxy trust. Typechecks/builds and artifact-base inspection confirm packaging. Old `VITE_GAME_URL`/frontend destination settings are replaced. |
| Request integrity and privacy | Cookie mutations require approved Origin, JSON, custom header and CSRF; login CSRF protection; explicit invalid bearer cannot fall back to cookie | Real missing/foreign-origin, missing/bad CSRF, duplicate-cookie, wrong-scope, production cookie-flag and denied-admin checks. Browser bearer cannot enter a socket. Family delete failure rolls back notifications/state. |
| Documentation and operations | Architecture appendix, transport/scenario distinction, config/storage/deployment updates and public/admin nginx examples | Sources identify exact setup, namespace binding, pre-upgrade backup, scope behavior and target-host limits. Historical milestone reports remain unchanged. |

## Verification

**221 passed, 0 failed across 19 focused files**, captured in ignored `build/m6-focused-final.json`:

| Area | Passing checks |
|---|---:|
| New browser-family/seat/CSRF/continuity/static-route checks | 14 |
| Configuration/content/startup preservation | 16 |
| Legacy auth core/short authenticated lifecycle | 22 |
| Admin API/atomic audit | 8 |
| Owned-deck HTTP/match behavior | 5 |
| SQLite migration/family persistence/instance binding/backup | 10 |
| Room runtime/reconnect | 37 |
| Navigation/public SDK/resume/client lifecycle | 10 |
| Player auth state, delayed results and storage fallback | 12 |
| Existing builder/admin/card/action/socket/deck/store regressions | 65 |
| Import architecture | 22 |

`npm run typecheck` passes all eight projects. `npm run build` passes all four applications. Artifact inspection confirms referenced files/base paths and public/admin bundle separation. Workspace installation introduced one local package link and reported 0 known npm vulnerabilities; this is not a security assessment. Whitespace and changed-document links/anchors are checked. Earlier intermediate reports are not additional unique test counts.

Reproduce the focused gate:

```sh
npx vitest run tests/server/browser-navigation.test.ts tests/server/configuration.test.ts tests/server/auth-core.test.ts tests/server/auth-acceptance.test.ts tests/server/deck-acceptance.test.ts tests/server/admin-acceptance.test.ts tests/server/admin-audit.test.ts tests/server/sqlite-store.test.ts tests/server/reconnect.test.ts tests/server/room-runtime.test.ts tests/client/navigation.test.tsx tests/client/auth-state.test.ts tests/client/deck-builder.test.tsx tests/client/admin.test.tsx tests/client/action-feedback.test.ts tests/client/socket-feedback.test.ts tests/client/gameStore.test.ts tests/client/decks.test.ts tests/architecture/import-boundaries.test.ts --pool=threads --maxWorkers=2
npm run typecheck
npm run build
```

## Operations and limits

Run `npm start` after building for same-origin `/home`, `/play`, `/deck-builder/`. For Vite, run `npm run dev` and the separate frontend dev commands. The server's navigation files select destinations; operator overrides remain explicit. Production needs HTTPS, approved origins, a shared public origin and a separate configured admin origin. Cookie flags/header/auth logic were checked over short HTTP tests; this is not a browser-cookie/TLS/nginx deployment test.

Migration 003 adds purpose/parent fields and instance binding. Take the rollback backup with the **pre-upgrade release** before installing the new code: the new backup helper opens the current store and may migrate schema. Set the intended instance ID/purpose before first upgraded startup. A lab requires a separate database/credentials/origin; do not bypass a binding mismatch or copy live account data. Rollback uses the matching old release/backup and invalidates restored sessions. Room/seat state remains ephemeral.

Old game bearers retain legacy expiry/rotation semantics. New UI sign-in is a browser family; opening another game tab creates a child without another password login. Existing tab credentials are reused on reload; closed/lost-storage tabs can remain counted until logout/expiry. Defaults are five families/account, eight game children/family and 1,000 total sessions. Public global logout preserves separate admin scope. Runtime navigation does not merge apps or make routes authoritative.

Root lobby connection initialization was corrected while implementing navigation: the prior hook ran only after a game screen existed. Tests now assert that the lobby root starts the lifecycle and passive Home/unknown routes do not. Reconnect also now verifies explicit seat ownership instead of relying on a potentially colliding retained engine PlayerId.

No browser interaction/visual smoke, long socket/full-suite wait, installed Linux/TLS/nginx, network isolation, production load or animation frame-rate verification was run. Full `npm run verify` remains available for CI. Milestone 7's Scenario Builder and Milestone 8's UI/animation revamp remain future work.
