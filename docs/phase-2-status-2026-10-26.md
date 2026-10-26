# Milestone 2 completion report — accounts and admin API access

**Date:** 26 October 2026. **Branch:** `platform/foundation`.

Platform Milestone 2 / security-lab Phase 1 is implemented with the user's verification adjustment: focused tests, strict typechecks and production builds. The user chose authenticated admin endpoints only and requested a proposed panel design. This report does not claim deployment readiness or a full regression run.

The branch was pulled before implementation (`git pull --ff-only`: already up to date). Milestone 1 remains the player projection boundary. See [Appendix C](../ARCHITECTURE.md#appendix-c-accounts-sessions-and-admin-access), the [authentication supplement](authentication-architecture.md) and the [implementation ledger](milestone-2-implementation.md).

## Delivered behavior

| Requirement | Implementation and evidence |
|---|---|
| Password storage/policy | Server-only Argon2id parameters, fresh salts, 15–128 Unicode characters, NFC normalization, no composition rules, offline common/breached-password list with source fingerprint/license. Hash, verification, normalization and rejection tests pass. |
| Session lifecycle | Random opaque tokens; SHA-256 records; bounded accounts/sessions/password concurrency; expiry, rotation and logout revocation. Active sockets expire and are disconnected when revoked. |
| Auth HTTP boundary | Guest/register/login/logout/me; strict shared Zod request and response schemas; role injection rejected; safe errors and redacted structured auth logs. An actual login log line contains no password/hash/token. |
| Authenticated game identity | Extracted handshake validates game-scoped sessions and derives identity. Claimed playerId cannot claim another seat. Short real-server tests cover register/login, create/join, a turn, logout and rejected old tokens. |
| Guest linking/reconnect | Registration or login with a verified seated guest transfers ownership through a server binding; engine PlayerIds stay stable. Reconnect returns the same view/seat. Conflicting account-seat links fail; waiting guest rooms survive credential replacement. |
| Client access | Guest bootstrap and per-tab session storage; seated registration/login/logout controls; authoritative session identity; stale session messages cannot clear a newer login. Passwords are not persisted. |
| HTTP/socket hardening | Shared exact origin allowlist, rejected unlisted preflight/WebSocket origins, Helmet, 8 KiB body limit, credential and guest rate limits, no-store API responses. Production only accepts configured browser origins. |
| Admin API access | Explicit operator bootstrap with no default credentials; fresh password login requests admin scope. `/api/admin/me`, paged `/api/admin/rooms` and the separate full-state debug endpoint require admin scope/current role; room inspection also requires its flag. Tests cover success, player denial, missing/expired credentials and disabled inspection. |
| Architectural separation | Reusable application composition, process-only entry point, `ServerStateStore.auth` repository seam, unchanged credential-free engine boundary. Architecture checks reject forbidden imports/cycles. |

## Why share verification code but separate admin sessions?

The verifier answers whether a token is authentic, current, unrevoked and attached to an enabled account. Reusing that implementation prevents the admin path from accidentally omitting expiry, revocation or account-status checks. Authorization separately answers whether that session may inspect a room.

An ordinary game token cannot inspect even if its account is an admin. Admin login requires the password again and explicitly requests `scope: "admin"`, issuing a separate 15-minute token. Game account sessions last eight hours and guest sessions 24 hours. Rotation is scope-specific. An admin token cannot connect to the game socket. Every admin request checks current role; full-state inspection independently needs `INSPECTOR_ENABLED=true`. Separate verifier implementations would add maintenance and inconsistency risk without providing this permission boundary by themselves.

Tokens remain bearer credentials: possession grants that token's authorized access until expiry/revocation. The later panel should isolate its browser origin/storage and add stronger admin authentication for wider deployment.

## Verification evidence

Environment: Windows, Node 24.22.1, TypeScript 6, Vite 8, Vitest 4. Native Argon2 hashing was exercised successfully.

| Check | Result |
|---|---|
| Final focused security/client/architecture run | **50 passed, 0 failed**: auth core 13, actual-server acceptance 9, bootstrap 2, client auth state 5, socket feedback 3, import architecture 18. |
| Earlier focused runtime/reconnect run | **75 passed, 0 failed**, including room-runtime 25 and reconnect 11 alongside auth/architecture checks. |
| Earlier focused client regression run | **33 passed, 0 failed**, including action-feedback 8 and gameStore 7 alongside auth/client socket checks. |
| Final `npm run typecheck` | Passed for engine, protocol, server and client. |
| Final `npm run build` | Passed for server and client; native Argon2 remains external, password blocklist remains server-only. |

The focused runs overlap; their totals must not be added together. Local JSON reports are under ignored `build/m2-security-final.json`, `build/m2-focused-server.json` and `build/m2-focused-client.json`.

Reproduce the final focused run from the repository root:

```sh
npx vitest run tests/server/auth-core.test.ts tests/server/auth-acceptance.test.ts tests/server/auth-bootstrap.test.ts tests/client/auth-state.test.ts tests/client/socket-feedback.test.ts tests/architecture/import-boundaries.test.ts
npm run typecheck
npm run build
```

No browser smoke, long legacy socket scenario suite or full suite was run for this milestone, per the user's instruction. The legacy real-routing test helper was adapted to obtain server-issued guest credentials, but its long scenarios were not executed. CI/full regression remains available through `npm run verify`; earlier milestone test counts are historical evidence.

## Access and remaining limits

No real admin credential is generated or committed. The operator supplies `ADMIN_BOOTSTRAP_USERNAME` and exactly one password source, preferably `ADMIN_BOOTSTRAP_PASSWORD_FILE`, and enables `INSPECTOR_ENABLED=true` for room inspection. Then `POST /api/auth/login` with `protocolVersion: 1`, username/password and `scope: "admin"` returns a token for bearer-authorized admin requests. See the supplement for the complete API/configuration contract.

Accounts, sessions and room-seat ownership remain in memory; restart clears them. Explicit admin bootstrap is reapplied at startup. Phase 3 must add repository persistence/migrations before durable account use. Diagnostic JSONL logs still require retention/access controls. TLS, Linux deployment, monitoring, IDS, a pentest campaign, MFA and privileged audit/account-management APIs are later work. This milestone supplies meaningful auth/session/ownership attack boundaries for that campaign; implementation tests alone are not pentest experience.

## Proposed admin panel

Build `apps/admin` as a separate bundle on its own origin with its own storage key. Use fresh admin-scoped login, show the 15-minute expiry, and start with a read-only paged room list beside a room inspector. Display phase, priority, stack, choices and zones; offer a JSON view for debugging. Cancel old requests when selection changes and use short polling initially. Keep all permission decisions on the server.

Phase 4 can add a bounded cursor-based log viewer, account management and an audit trail. Account disabling must invalidate both session scopes. Add MFA and reauthentication for destructive operations before broader deployment. A future live admin stream should have its own authenticated audience and per-message checks rather than reuse the game channel.
