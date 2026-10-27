# Milestone 3 completion report — persistence and saved decks

**Date:** 27 October 2026. **Branch:** `platform/foundation`.

Platform Milestone 3 is implemented: durable accounts/sessions, a public paged catalog, shared deck validation, owned deck CRUD and saved decks in match setup. The branch was pulled first (`git pull --ff-only`: already up to date). Verification follows the user's focused-test instruction; no browser smoke, long legacy socket suite or full regression run is claimed.

See [Appendix D](../ARCHITECTURE.md#appendix-d-persistence-catalog-and-saved-decks), the [architecture/operations supplement](persistence-deck-architecture.md) and [implementation ledger](milestone-3-implementation.md).

## Requirement audit

| Plan item / invariant | Delivered source | Authoritative evidence |
|---|---|---|
| 3.1 SQLite accounts/sessions/decks and migrations | `stores/sqlite-store.ts`, `stores/migrations/001-accounts-and-decks.ts`, migration runner; process entry supplies `DATABASE_PATH` | Real file-backed close/reopen tests retain accounts, valid scoped sessions and ordered deck entries. Migration reapplication, failed-step rollback and unknown-version rejection pass. |
| Rooms/seats remain ephemeral | `InMemoryStore`, process-local seat bindings in the SQLite adapter | Application restart test retains account/deck/token but restores no rooms or seat bindings. |
| Preserve expiry/rotation/logout and admin scope | Existing auth policy behind persistent repository | Real database tests retain old-token rejection and valid separate admin scope across reopen; expired sessions stay rejected. Existing auth core/acceptance checks pass. |
| Atomic auth/guest linking | Repository transaction seam and post-commit `SessionService.atomic` notifications | Injected session-write failure rolls back new account, guest-seat transfer and token revocation; no invalidation notification fires. |
| Restart-safe admin provisioning | `AuthService.bootstrapAdmin` | Repeated provisioning preserves existing ID/hash; wrong password or existing player identity fails without promotion/reset. |
| 3.2 paginated card catalog | `catalog/catalog.ts`, `http/catalog-router.ts`, shared printed DTO schema | Pagination is stable/bounded and rejects extra fields. Catalog schemas pass; DTOs exclude active state, UUIDs and effect/ability internals. |
| 3.3 shared deck contracts/rules | `protocol/src/decks/deck.ts` | Shared validator enforces 60–250 cards, four copies except explicit repeatable `land-red`, rejects duplicates/fractions/unknown/fixture cards. REST returns the same five-copy error as the pure validator. |
| 3.4 owned deck CRUD | `decks/deck-store.ts`, `decks/deck-service.ts`, `http/decks-router.ts` | Account B cannot list/read/update/delete A's deck. Guests, missing credentials and admin-scoped tokens cannot manage decks. Valid create/update/delete and strict bounds pass. Parameter-like deck names remain data. |
| 3.5 saved decks in game setup | Strict socket reference schemas; server-owned resolution; `SetupConfig.playerDecks`; engine deck instantiation/shuffle/deal | Short real HTTP/socket test creates distinct owned decks, denies foreign/raw-card input, runs RPS and legal land play, verifies exact 60-card multisets and correct ownership. Edits/deletion leave captured match setup unchanged. Opponent hands and private setup remain absent from player views. |
| Fixture gate | Server debug/environment selection policy | Production without explicit fixture enablement rejects an unselected deck before creating a room. Existing development-fixture auth/runtime/setup tests pass. |
| Small usable selection path | Existing game-client saved-deck loader/selector and action hooks; Vite API proxy | Client checks verify bounded bearer-authorized requests, cancellation propagation, incompatible/denied response rejection and reference-only create/join packets. Both builds/typechecks pass; no browser smoke claimed. |
| 3.6 remove Mongoose | Root/server manifests and lockfile | `npm ls` and lockfile inspection show no Mongoose dependency; installed tree was pruned. |
| 3.6 delta-log rotation | `deploy/logrotate/deltas`, deployment instructions | Config reviewed against append-per-write behavior: daily/10 MiB criteria, seven archives, private service-owned files. Linux installation, scheduling and forced rotation are explicitly unverified deployment work. |
| Backup and restore operation | `stores/backup.ts`, built process `backup` command, supplement | Online backup test reads committed data from a live WAL database and reopens the copy; existing destinations/missing sources are rejected. Offline restore/permissions/session invalidation are documented. |
| Clean library boundary | Server adapter and architecture test | Only the server storage adapter runtime-imports the driver. Architecture tests pass; built server retains external native `require("better-sqlite3")`; browser output contains no driver/schema/password-hash strings. |

## Library changes

Added exactly pinned `better-sqlite3` **12.11.1** in the server runtime and `@types/better-sqlite3` **9.6.0** in server development dependencies. The selected driver preserves the project's Node 20 support; version 13 requires Node 22. Local native operations passed on Node 24.22.1. The driver stays external to the server bundle and must be installed for the deployment platform; no ORM or migration framework was added. Existing Zod owns shared validation.

Removed unused Mongoose from both manifests. Compatible dependency resolution updates include Vite **8.3.5**, body-parser **1.20.9** and Vitest **4.1.12**. The final dependency prune/audit reported **0 known vulnerabilities**; this is a dependency-advisory result, not a security assessment of the application.

## Final verification

**142 passed, 0 failed across 16 targeted test files**, recorded in ignored `build/m3-focused-final.json`:

| Area | Passing checks |
|---|---:|
| SQLite/migrations/transactions/backup | 7 |
| Shared deck validation/catalog | 13 |
| Real HTTP and short saved-deck match | 5 |
| Auth core / authenticated lifecycle / bootstrap | 24 |
| Room runtime / reconnect | 37 |
| Engine room setup / card factory | 11 |
| Client deck loading / action feedback / auth / socket feedback / store | 26 |
| Import architecture, including native-driver boundary | 19 |

`npm run typecheck` passed for all four TypeScript projects. `npm run build` passed for server and client using Vite 8.3.5. Native SQLite loading and real operations were exercised by the focused tests. Whitespace checks pass. Earlier intermediate reports contain overlapping or superseded runs; their totals are not additional coverage.

Reproduce the focused acceptance from the repository root:

```sh
npx vitest run tests/server/sqlite-store.test.ts tests/server/deck-validation.test.ts tests/server/deck-acceptance.test.ts tests/server/auth-core.test.ts tests/server/auth-acceptance.test.ts tests/server/auth-bootstrap.test.ts tests/server/room-runtime.test.ts tests/server/reconnect.test.ts tests/engine/room-factory.test.ts tests/library/card-factory.test.ts tests/client/decks.test.ts tests/client/action-feedback.test.ts tests/client/auth-state.test.ts tests/client/socket-feedback.test.ts tests/client/gameStore.test.ts tests/architecture/import-boundaries.test.ts
npm run typecheck
npm run build
```

The original plan's blocking full `npm run verify` gate is replaced for this delivery by the user's standing focused-testing instruction. CI/full regression remains available. No Linux deployment, browser interaction, long-game socket scenario or full-suite result is implied.

## Remaining work and operational limits

The separate admin app remains Milestone 4; the separate deck-builder UI remains Milestone 5. Saved decks can currently be managed through the documented API and selected in the existing game client. There is no database server, match recovery, multi-process coordination, backup scheduler or encrypted database file. Accounts, valid sessions and decks survive restart; live matches intentionally do not. Production requires configured browser origins and owned deck selection unless fixtures are explicitly enabled. Linux TLS/service isolation, native deployment verification, logrotate installation/scheduling, monitoring and pentest campaigns remain later work.
