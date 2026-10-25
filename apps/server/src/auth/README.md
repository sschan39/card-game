# apps/server/src/auth/

**Status:** empty. Planned in Phase 1 of
[`../../../../docs/security-lab-plan.md`](../../../../docs/security-lab-plan.md).

This directory does not exist in the current build. Nothing imports it yet.

## Intended boundary

Authentication is a **transport-layer concern**. It sits beside `reconnect.ts` and
`action-packet.ts` in `apps/server/src/rooms/`, and it must not leak into `packages/engine/src/engine/`.

```
socket handshake → auth/session.ts → PlayerId → GameEngine
```

The engine keeps receiving a `PlayerId` and stays unaware of accounts, tokens, or passwords.

## Planned files

| File | Responsibility |
|---|---|
| `password.ts` | Argon2id hashing and verification; parameters from a new server-only `apps/server/src/config.ts` |
| `session.ts` | Token issue, validate, rotate, revoke; bounded in-memory table |
| `account-store.ts` | Account records behind the existing `StateStore` shape |
| `routes.ts` | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout` |
| `redaction.ts` | Strips credential material before anything reaches `game-logger.ts` |

## Constraints

- `PlayerId` is derived from the authenticated account, never from client input. The current
  client-generated id in `apps/game-client/session.ts` becomes a pre-login placeholder only.
- `apps/server/src/rooms/reconnect.ts` already separates socket identity from player identity. Preserve
  that split; do not merge the two maps.
- No password, hash, or token may appear in a log entry. A test must assert this.
- Session state is in-memory for the lab. Persistence is out of scope (see plan §"Out of scope").
