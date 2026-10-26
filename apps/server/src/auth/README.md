# Server authentication boundary

Implemented in platform Milestone 2 / security-lab Phase 1. See the [architecture supplement](../../../../docs/authentication-architecture.md) for decisions, configuration and the later admin panel design, and the [completion report](../../../../docs/phase-2-status-2026-10-26.md) for verification.

Authentication belongs to the server transport. The engine receives a stable seat PlayerId and has no password, account, session or HTTP dependency.

```text
HTTP guest/register/login → opaque scoped session
socket handshake → session validation → owned seat binding → RoomRuntime → GameEngine
admin HTTP → session validation → admin scope + current role + inspection flag
```

| File | Responsibility |
|---|---|
| `password.ts` | Argon2id hashing/verification and offline password policy; server-only parameters in `../config.ts` |
| `session.ts` | Random token issuance, hashed records, expiry, rotation, revocation and capacity |
| `account-store.ts` | Account, session and room-seat ownership repository; current implementation is in memory |
| `service.ts` | Bounded password work, account flows, guest linking and credential-safe audit messages |
| `routes.ts` | Strict protocol schemas, auth HTTP endpoints and credential rate limits |
| `bootstrap.ts` | Explicit operator-provisioned admin account; no default credentials |
| `redaction.ts` | Recursive credential redaction before structured logging |
| `BLOCKLIST.md` | Offline list provenance, source fingerprint, license and update procedure |

Guests receive server-issued tokens too. Client player IDs never prove ownership. Linking a seated guest to an account changes its server-owned binding while preserving engine references. `rooms/reconnect.ts` keeps socket and player identity separate.

Game and admin sessions use shared validation code but separate scope, lifetime and rotation. Admin access requires a fresh password login with `scope: "admin"`; game tokens cannot inspect, and admin tokens cannot connect to the game socket. Inspection also requires `INSPECTOR_ENABLED=true`.

Accounts and sessions currently disappear at restart; Phase 3 adds persistence behind `ServerStateStore.auth`. Passwords, hashes and tokens must never reach logs. Focused tests assert both redaction and an actual login log line.
