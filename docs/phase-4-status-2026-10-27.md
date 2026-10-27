# Configuration refactor and Milestone 4 completion report

**Date:** 27 October 2026. **Branch:** `platform/foundation`.

The user's continuation after the configuration/Milestone 4 proposal is implemented: owned configuration/content files, then the separate administrator app and protected administration/audit APIs. The branch was pulled first (`git pull --ff-only`: already up to date). The user-adjusted gate remains focused logic/short integration checks, typechecks and builds; no browser smoke, long socket/full-suite run or Linux deployment is claimed.

See [Appendix E](../ARCHITECTURE.md#appendix-e-configuration-ownership-and-admin-application), [configuration ownership](configuration-architecture.md), [admin architecture/setup](admin-architecture.md) and the [implementation ledger](milestone-4-implementation.md).

## Requirement audit

| Requirement | Delivered artifacts and behavior | Evidence |
|---|---|---|
| Dedicated editable config folders | Server auth/HTTP/storage/rooms/logging/profiles JSON with schema/loader; engine rules/elements/diagnostics/presets; protocol format/eligibility; frontend UI settings | Schema tests cover precedence, array replacement, invalid values/profiles, dangerous keys, secret-safe errors and frozen output. A startup test proves one effective config is passed through without a second operator-file read. |
| Preserve content/gameplay | Grouped single-card JSON with explicit manifest; five named presets; per-room settings snapshots; compatibility reexports | Complete canonical hashes match all 79 pre-extraction definitions and five presets. Every ID normalizes. Snapshot tests retain original rules/card arrays after later changes. Existing gameplay/setup/deck tests pass. |
| Meaningful settings, maintained boundaries | Account quota moved from public protocol to server settings; explicit catalog eligibility; configurable page defaults and bounded deck-loader paging | Real API tests apply changed page defaults/quota. Client test loads later saved-deck pages. Unknown/conflicting catalog-policy IDs fail. Engine/admin/package import checks pass. |
| 4.1 current role/scope gate | `http/admin-router.ts`, existing session verifier and separate debug boundary | All admin endpoints return 401 without valid credentials, 403 for game scope, and appropriate approved results for admin scope. Expired/withdrawn-role tokens fail. Inspection still requires its flag. |
| 4.1 audit trail | Migration 002, durable audit repository/outbox, JSONL export and retry | Privileged reads/actions record actor/action/target/outcome/time; raw credentials/hashes/tokens are absent. Filesystem export failure retains events across reopen and retries. Durable audit insertion failure rolls back disabling and session invalidation. |
| 4.2 independent admin app | `apps/admin` workspace with login, four hash routes, own storage/key, expiry, request validation and cancellation | Admin client logic/render tests exercise storage separation, fresh scoped login, expiry/401/logout, stale-response handling, all route shells and escaped inspector data. Resource tests prevent stale results/overlapping polls. All builds/typechecks pass. |
| 4.3 bounded log viewer | `admin/log-reader.ts`, signed generation/byte/fingerprint cursors; paged UI | A 100,000-line file is paged and directly sought near its end using small reads. Tests cover append, tampering, truncation/rotation, oversized/malformed/partial lines, redaction and missing/disabled sources. No whole-file read/split is used. |
| 4.4 room inspector | Paged summaries and authenticated full-state room endpoint, with periodic/cancellable list/selection reads | HTTP tests verify current room data, role/flag gates and auditing of both new and legacy full-state inspection paths. Render tests verify inspector content is escaped. Player projections remain private. |
| 4.5 account list/disable | Paged safe records; confirmation UI; atomic disabled state, both-scope revocation and audit event | Real HTTP/socket test immediately retires a target's live game socket and rejects its game/admin tokens and future login. Final-active-admin protection passes. Notification listener failure does not contradict a committed disable/audit result. |
| 4.6 serving/build separation | Independent admin build/dev origin; dedicated-origin nginx TLS/CSP example; production backend excludes same-origin admin frontend | Built admin asset URLs use `/admin/`; player bundle inspection finds no `/api/admin` path or `cardgame.adminSession.v1` key. Production HTTP check returns 404 for backend admin assets. nginx/Linux/TLS installation remains unverified deployment work. |
| Documentation and operations | Architecture Appendix E, config/admin supplements, updated roadmap/map/README/card-authoring instructions and audit logrotate policy | Sources describe exact config precedence, rebuild/restart distinction, bootstrap setup, bounded reading/audit semantics and remaining limits. Historical milestone reports remain unchanged. |

## Dependencies and scope

The admin app reuses existing React, ReactDOM, Vite and protocol dependencies. A small typed hash router supports the four pages; no router/configuration/UI framework was introduced. Existing **Zod 4.6.7** is declared directly in the server workspace for its new schemas rather than relying on a transitive dependency. The existing native SQLite adapter remains the sole runtime driver importer. The final npm audit reports **0 known vulnerabilities**; this is not a security assessment.

The initial public deck format and stored identifier remain unchanged. Production defaults now explicitly disable debug/fixtures and retain only configured origins. Source JSON defaults/card content are bundled and require rebuild/restart; external operator JSON/environment changes require restart. Permissions and hard safety bounds are not editable through admin or config files.

## Final verification

**186 passed, 0 failed across 21 targeted files**, recorded in ignored `build/m4-focused-final.json`:

| Area | Passing checks |
|---|---:|
| Configuration, complete content/preset preservation and startup snapshots | 14 |
| Admin API / atomic audit / bounded log reader | 12 |
| Admin client storage/API/routing/resource/render logic | 16 |
| Existing auth, bootstrap, authenticated lifecycle | 24 |
| SQLite persistence/migrations/backup | 7 |
| Deck rules and short saved-deck lifecycle | 18 |
| Room runtime/reconnect and engine/card factories | 48 |
| Player client auth/decks/actions/socket/store | 27 |
| Import architecture and native-driver boundaries | 20 |

`npm run typecheck` passed for engine, protocol, server, player and admin. `npm run build` passed for all three applications using Vite 8.3.5. Built artifacts were inspected for admin/player separation. Whitespace checks pass. Earlier overlapping reports are intermediate evidence and must not be added to this total. The TSX admin tests are explicitly included in the client test project's patterns.

Reproduce the final focused checks:

```sh
npx vitest run tests/server/configuration.test.ts tests/server/admin-log-reader.test.ts tests/server/admin-acceptance.test.ts tests/server/admin-audit.test.ts tests/server/sqlite-store.test.ts tests/server/auth-core.test.ts tests/server/auth-acceptance.test.ts tests/server/auth-bootstrap.test.ts tests/server/deck-validation.test.ts tests/server/deck-acceptance.test.ts tests/server/room-runtime.test.ts tests/server/reconnect.test.ts tests/engine/room-factory.test.ts tests/library/card-factory.test.ts tests/client/admin.test.tsx tests/client/decks.test.ts tests/client/action-feedback.test.ts tests/client/auth-state.test.ts tests/client/socket-feedback.test.ts tests/client/gameStore.test.ts tests/architecture/import-boundaries.test.ts
npm run typecheck
npm run build
```

The original blocking `npm run verify` gate is replaced for this delivery by the user's standing focused-testing instruction. It remains available for CI/full regression. The long legacy routing helper was adapted to an explicit fixture-provider seam but its long scenarios were not executed. React rendering/logic checks are not a claim of a browser smoke test.

## Operator entry point and remaining work

Provision an admin username and protected password file through the existing bootstrap environment; enable room inspection deliberately. Run `npm run dev:admin` and open `http://localhost:5174/admin/`, or use the built development backend path `/admin/`. The implementation creates no default or real operator password. Production admin hosting uses its own configured origin and the provided nginx example, not the backend's development static route.

The deck-builder UI remains Milestone 5. Rooms remain ephemeral. Live config editing, role promotion/re-enable/password reset, MFA, external/tamper-proof audit storage, retention scheduling, Linux/TLS/native deployment verification, monitoring and security-lab campaigns remain outside this milestone. JSONL audit export is retryable/at-least-once with event UUIDs; durable SQLite records remain authoritative. Deployment examples and logrotate files must be installed/validated on the intended host before being treated as operational.
