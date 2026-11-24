# Accounts Authority (4A) — Integration Principles and Current Gaps

**Status:** Analysis, revised against `76e9e6f` · **Date:** 23 November 2026 · **Scope:** `apps/server/src/auth/**`, `apps/server/src/admin/**`, `apps/server/src/http/**`

> This document answers three questions:
> **"What does the game actually need from 4A?"**, **"Which 4A invariants must never be
> traded away?"**, and **"Where does the current code violate them?"**
>
> It is a **principles and gap analysis**, not a plan of record. It supersedes the 4A
> sections of [`authentication-architecture.md`](authentication-architecture.md), which
> predates the 4A integration and still describes local Argon2id login as the primary path.

---

## Status update — what has already been fixed

The original analysis was written against `435f3f2`. Four commits landed on `origin/main`
(`7e9b9d3`, `4cbd8c1`, `5759262`, `76e9e6f`) that implement most of the Phase 1, 2 and 3
recommendations below. The invariant audit in §4 and the remediation phases in §9 have been
annotated with the current state; the analysis that follows is retained because the
*reasoning* still governs future changes.

| Recommendation | Commit | State |
|---|---|---|
| TTL cache on `verify()` — 30 s | `4cbd8c1` — `PLAY_ACCESS_TTL_MS = 30_000` | ✅ Done |
| Drop the 3 s per-socket heartbeat | `4cbd8c1` — one 5 s `matchAccessTimer` for all sockets | ✅ Done |
| Circuit breaker — 5 failures, 30 s cooldown | `5759262` — `BREAKER_FAILURE_LIMIT = 5`, `BREAKER_COOLDOWN_MS = 30_000` | ✅ Done |
| `identity()` tolerates 503 | `5759262` — returns `authorityUnavailable: true` | ✅ Done |
| Startup probe against `/v1/projects/:id` | `4cbd8c1` — `authority.probeProject()` | ✅ Done |
| Resolve dual `disabled` authority | `76e9e6f` — `updateManagedAccount()` proxies to 4A | ✅ Done |
| `disabled: false` hardcode | `4cbd8c1` — `disabled: signedIn.account.disabled` | ✅ Done |
| Distinguish 503 from 401 | `5759262` — `userCanBeDenied`, `AuthorityLogoutUnconfirmed`, `'unavailable'` audit outcome | ✅ Done |
| Outage destroys live matches | `4cbd8c1` — `matchPaused()` pauses both seats, resumes automatically | ✅ Done |
| `tester` role is a dead signal | `7e9b9d3` — `tester` now projected and used for Test Rooms | ✅ Done |
| `activity()` is a write-only heartbeat | `4cbd8c1` — throttled to once per 20 s per sign-in | ⚠️ Mitigated, still write-only |
| Persist `authoritySessions` across restart | — | ❌ Still in-memory (now explicit and documented) |
| TTL cache on `authorize()` (HTTP path) | — | ❌ Still one round trip per request |
| Push-based revocation | — | ❌ Still polling |
| OIDC + JWKS instead of bespoke introspection | — | ❌ Still bespoke |
| MFA, refresh, recovery, email | — | ❌ Still absent |

**The remaining hot path is HTTP, not sockets.** `authorize()` still calls
`verifyAuthoritySession()` on every protected request — `decks-router`, `admin-router`,
`/api/browser/tab`. `verifyAuthoritySession()` dedupes *concurrent* calls via
`current.verification ??=`, but sequential requests each pay a full HTTPS round trip. That is
the last piece of Phase 1/3.

---

## 0. The one-paragraph summary

The game integrates with an external Accounts service ("4A") that owns credentials, account
lifecycle and role assignment. The **contract is correctly narrow** — four account fields and
three rights — but the **consumption was too deep**: `authorize()` called `authority.verify()`
over HTTPS on every HTTP request and every socket packet, with a 2-second timeout, no cache,
no circuit breaker and no push-based revocation. That single decision produced every
availability and consistency defect documented below. The fix is not a rewrite and not a
broader contract; it is **moving one check off the hot path** and restoring the invariants
that make a 4A system authoritative rather than merely present. The socket half of that fix
has landed; the HTTP half has not.

---

## 1. What the game consumes from 4A

### 1.1 The contract surface

| Field | Type | Used for | Consumed at |
|---|---|---|---|
| `account.id` | UUID | Local primary key, deck ownership, seat ownership | `authorityLogin` projection |
| `account.username` | `^[a-z0-9][a-z0-9_.-]{2,63}$` | Display, uniqueness check | projection |
| `account.role` | `user \| tester \| admin` | `user → player`; `tester` and `admin` pass through | projection, Test Room gate |
| `account.disabled` | boolean | Access gate | projection, `assertAuthorityView` |
| `rights[]` | `string[]` (max 32) | Only 3 values are ever checked | `assertRight` |
| `expires_at` | ISO datetime | Session expiry | `assertAuthorityView`, `canPlay` |
| `idle_expires_at` | ISO datetime | Idle expiry | `assertAuthorityView`, `canPlay` |

### 1.2 The rights actually checked

```
'play'            → socket packets, deck routes
'lab.operate'     → Test Rooms, playtest seats
'accounts.manage' → admin routes
```

Three rights. All coarse. No fine-grained entitlements anywhere in the codebase.

### 1.3 The endpoints called

| Endpoint | Method | Called from |
|---|---|---|
| `/v1/accounts` | POST | `register()` |
| `/v1/sessions` | POST | `authorityLogin()` |
| `/v1/sessions/verify` | POST | `authorize()` — **hot path** |
| `/v1/sessions/activity` | POST | `activity()` — throttled to 20 s |
| `/v1/sessions/logout` | POST | `logoutAuthenticated()` |
| `/v1/projects/:id` | GET | `probeProject()` — startup, then cached |
| `/v1/admin/accounts` | GET, POST | `listManagedAccounts()`, `createManagedAccount()` |
| `/v1/admin/accounts/:id` | PATCH | `updateManagedAccount()` — role and `disabled` |

### 1.4 What is *not* in the contract

No email. No profile. No avatar. No friends list. No entitlements. No billing. No groups.
No SCIM. No webhooks. No token exchange. No OIDC discovery document. No JWKS.

### 1.5 What is local and must stay local

| Concern | Owner |
|---|---|
| Deck contents, ownership, validation | SQLite `decks` / `deck_cards` |
| Room state, seats, match history | `RoomRuntime` + SQLite |
| Game rules, card data, effect resolution | `packages/engine` — **zero auth imports** |
| Session records, digests, TTLs | SQLite `sessions` |
| CSRF, cookies, tab families | `browser-routes.ts` |
| Audit trail | SQLite `admin_audit` |

The engine has no account, session or password dependency. That boundary is correct and
should be protected.

---

## 2. Two signals that were dead in the contract

Both were evidence of ad-hoc creep that had already happened. One has since been revived.

### 2.1 `tester` role — **now live**

Declared in the 4A schema:

```ts
role: z.enum(['user', 'tester', 'admin']),
```

Originally collapsed on projection:

```ts
role: signedIn.account.role === 'admin' ? 'admin' : 'player',
```

`tester` became `player` and nothing in the game distinguished it. Commit `7e9b9d3` fixed
this: `managedAccount()` now maps `user → player` and passes `tester` through, and Test Room
access reads it. `FOURA_TESTER_NO_TIMEOUT=1` on the 4A service additionally lets a dedicated
lab issue Tester sessions without idle or fixed expiry.

### 2.2 `activity()`'s return value is still discarded

`activity()` returns a full `AuthoritySessionView`. Every call site ignores it:

```ts
if (authority && !result.duplicate) void auth.activity(session, 'player_command').catch(() => {
  serverLogger.warn('auth:activity:failed', 'Could not record player activity');
});
```

It is a write-only heartbeat. Commit `4cbd8c1` throttled it to at most once per 20 seconds
per sign-in (`PLAY_ACTIVITY_INTERVAL_MS`), which removes the traffic problem but not the
design problem: the game still pays a round trip to send a signal it never reads. The
returned view could be used to refresh the cached decision for free — it is not.

---

## 3. Scale features vs. invariants

A general-purpose 4A product ships both. They arrive in the same box, which is why they get
conflated. They are separable, and only one column is droppable.

| Scale features — **droppable for a home project** | Invariants — **never droppable** |
|---|---|
| Multi-tenant admin console | One writer per fact |
| SCIM 2.0 provisioning | Credentials never leave the authority |
| Groups, orgs, teams | The relying party never invents identity |
| Cross-service SSO | Privilege is granted by the authority, never by the RP |
| Token exchange / delegation | Revocation is authoritative and propagates |
| Fine-grained entitlements | Local state is a cache, and caches must be invalidatable |
| Audit federation | Unavailable ≠ denied |
| Billing hooks | |

> **Rule of thumb:** drop the features that make 4A *convenient*. Never drop the ones that
> make it *authoritative*.

The test for any proposed shortcut:

> *"If this local write disagrees with 4A, which one wins — and does the operator find out?"*
>
> - 4A wins **and** the operator is told → fine, it is a cache.
> - 4A wins **and** the operator is **not** told → this is the bite-back.
> - Local wins → you no longer have a 4A system.

---

## 4. Invariant audit — current state

| # | Invariant | Status | Evidence |
|---|---|---|---|
| 1 | One writer per fact | ✅ Honoured | `disabled` and `role` are written only by 4A; `updateManagedAccount()` proxies admin edits |
| 2 | Credentials never leave the authority | ✅ Honoured | Local `password_hash` is `''` for 4A accounts |
| 3 | The RP never invents identity | ✅ Honoured | `disabled: signedIn.account.disabled` — a projection, not a literal |
| 4 | Privilege granted by the authority | ⚠️ Partial | `admin-router` still reads local `role` before the 4A check |
| 5 | Local state is a cache | ⚠️ Partial | `activeAdminCount()` still guards on local projections, but is unreachable under 4A |
| 6 | Revocation propagates | ⚠️ Partial | No push channel; polling only, now 5 s global instead of 3 s per socket |
| 7 | Unavailable ≠ denied | ✅ Honoured | `userCanBeDenied`, `AuthorityLogoutUnconfirmed`, `'unavailable'` audit outcome |

Five of seven were violated at `435f3f2`. Three are now fully honoured and two are partial.

### 4.1 Invariant 1 & 3 — `disabled` had two writers (**fixed**)

The 4A projection, on every login, used to assert a literal:

```ts
// before 4cbd8c1
createdAt: existing?.createdAt ?? this.now(), disabled: false,
```

and the local admin action wrote the same column independently:

```ts
this.auth.repository.saveAccount({ ...target, disabled: true });
this.auth.sessions.revokeSubject({ kind: 'account', id: target.id }, 'disabled');
this.audit.record(actorId, 'account.disable', target.id);
```

The local write was never sent to 4A, so the next login overwrote it with `disabled: false`.
**The operator's disable was silently discarded.**

Both halves are now fixed:

- `4cbd8c1` projects the real value: `disabled: signedIn.account.disabled`.
- `76e9e6f` routes the admin action through 4A:

```ts
const account = auth.authority
  ? await auth.updateManagedAccount(response.locals.adminSession, id.data, { disabled: true })
  : accounts.disable(response.locals.actorId, id.data);
```

`updateManagedAccount()` sends `PATCH /v1/admin/accounts/:id` with the **admin's own session
token**, so 4A authorizes the actor, protects the last enabled admin, writes the record and
revokes affected sessions. The local row is now a cache with a single writer.

### 4.2 Invariant 4 — local role still does security work (**partial**)

`admin-router` middleware:

```ts
const session = requireSession(auth, request);
const account = session.subject.kind === 'account'
  ? auth.repository.findAccount(session.subject.id) : undefined;
actor = account?.id ?? null;
if (session.scope !== 'admin' || !account || account.role !== 'admin')
  throw new AuthError(403, 'An admin-scoped session and current admin role are required.');
await auth.authorize(session);
```

This fails closed, so it is not a privilege escalation. But a stale local `role='admin'` can
satisfy the first gate; the 4A check is what actually denies. The local role is doing security
work it should not be doing. `76e9e6f` added `asManagedAdmin()`, which re-checks
`session.scope === 'admin'` and the live authority session before every managed operation —
so the *managed* paths are now correct. The middleware gate itself is unchanged.

### 4.3 Invariant 5 — the last-admin guard reads a stale cache (**now unreachable**)

```ts
activeAdminCount() {
  return (this.statement(
    "SELECT count(*) AS total FROM accounts WHERE role='admin' AND disabled=0"
  ).get() as { total: number }).total;
}
```

The guard is computed from **local projections**. If 4A demotes an admin to `user`, the local
row stays `admin` until that person logs in again. The failure sequence was:

1. Local count says 2 admins; 4A has 1.
2. Operator disables the real admin → guard passes (`2 > 1`).
3. Local write succeeds; audit records `account.disable` **success**.
4. 4A still has them as admin.
5. They log in → `disabled: false` → they are back.

**The audit trail recorded a disable that never happened.** This is the bite-back: not a
crash, but a false record of a security action.

`76e9e6f` makes this path unreachable under 4A: `AdminAccountService.disable()` is now only
the non-4A branch, and 4A enforces last-admin protection itself. The stale guard remains in
the standalone-account mode, where the local table *is* the authority and the count is
therefore correct.

### 4.4 Invariant 6 — revocation is polled, not pushed (**partial**)

There is no push channel. The RP polls. `4cbd8c1` replaced the 3-second per-socket heartbeat
with a single 5-second `matchAccessTimer` that refreshes every socket's cached decision, plus
a 20-second activity throttle. Revocation latency is now bounded by 30 seconds
(`PLAY_ACCESS_TTL_MS`) rather than by packet frequency, and the polling no longer scales with
player count. It is still polling.

### 4.5 Invariant 7 — unavailable is treated as denied (**fixed**)

`authorize()` used to revoke on 401 and propagate 503, and `identity()` rethrew 503, so a
network blip became an authentication failure. `5759262` separates the two:

- `AccountsAuthority.request()` takes `userCanBeDenied?: true` and only treats a 401/403 as a
denial when the endpoint can legitimately deny a *user*.
- A 5xx, a transport failure, or a project-credential rejection becomes `unavailable()` (503).
- `AuthorityLogoutUnconfirmed` reports a sign-out that 4A could not confirm, instead of
  pretending it succeeded.
- Migration `007-audit-unavailable` adds `'unavailable'` to the `admin_audit` outcome CHECK,
  so the audit trail can record "we could not ask" distinctly from "the answer was no".
- `identity()` returns `authorityUnavailable: true` rather than 503, and the deck builder
  degrades to local draft editing and export with a retry control.

The system can now say "I don't know".

---

## 5. Failure behaviour

### 5.1 4A absent (environment variables unset)

`loadAccountsAuthority()` returns `undefined` and every `authority` conditional takes the
local branch. This is a designed mode and degrades cleanly.

| Concern | Behaviour |
|---|---|
| Passwords | Local Argon2id; `bootstrapAdmin()` seeds the first admin |
| `authorize()` | Returns `undefined` immediately — no network |
| Socket middleware | Simple `socket.use` — session presence only |
| Auto-pass | Falls back to "socket connected" |
| Admin UI | Local `Accounts` page renders |
| Test Rooms | **Gone** — `operatorTestRooms = !!authority && scenariosEnabled(config)` |
| Scenario lab playtest | Still works (local operator sessions) |

Covered by `auth-acceptance.test.ts`, `admin-acceptance.test.ts`, `deck-acceptance.test.ts`.

### 5.2 4A configured but unreachable

`probeProject()` now runs at startup (`4cbd8c1`), so a known project or credential mismatch
fails loudly at boot instead of serving 503s forever. A *temporary* failure is logged as
`auth:project:unavailable` and the process continues, retrying when the service is needed.

```
request() → AbortSignal.timeout(2000), redirect: 'error'
         → 5 consecutive transport/5xx failures → breaker opens for 30 s
         → while open: fail fast, no network call
         → after cooldown: one probe request; success closes the breaker
```

Timeline of a 30-second outage, **after** `4cbd8c1`:

| t | Event |
|---|---|
| 0 s | 4A stops responding |
| 0–2 s | In-flight `verify()` calls hang, then 503 |
| 0–20 s | Cached decisions remain valid (`PLAY_ACCESS_TTL_MS = 30_000`) — **play continues** |
| ~20 s | `matchAccessTimer` tries to refresh; fails; the cached decision ages out |
| ~30 s | `canPlay()` returns false → `matchPaused(roomId)` → both seats receive `matchAccess: { paused: true }` |
| 30 s+ | **The room is not destroyed.** Sockets stay connected, the board stays in place, commands are refused with `'Account service unavailable. Play will resume automatically.'` |
| recovery | Next successful refresh clears the pause; `matchAccess: { paused: false }`; play resumes |

**An outage no longer destroys matches.** It pauses them, visibly, and resumes them. The
30-second `scheduleDestroy` timer is no longer reachable from an authority outage.

### 5.3 HTTP blast radius

`decks-router` still calls `await auth.authorize(session)` on **every** request, reads
included, and `authorize()` still performs a live `verify()` when the cached decision is
older than 30 seconds. This is the remaining hot path.

What changed: `identity()` no longer rethrows 503. `GET /api/browser/me` returns
`authorityUnavailable: true` with the session intact, so the deck builder keeps the browser
identity, allows local draft editing and export, and offers a "Retry account service"
control. Saved-deck reads and writes still require a current 4A check and are disabled while
the flag is set.

### 5.4 What survives an outage

- **Guests** — `authorize()` returns early on `subject.kind === 'guest'`. Unaffected.
  (In practice guests cannot play in production: `decks-router` requires
  `subject.kind === 'account'`, and `selectedCards()` throws without an owned deck unless
  development fixtures are enabled.)
- **Live matches** — paused, not destroyed (§5.2).
- **Client-side sessions** — `auth-state.ts` does not clear stored auth on 503.
- **Server-side sessions** — `authorize()` revokes only on 401, never on 503.
- **Deck builder drafts** — editable and exportable; saving is disabled.

But `authoritySessions` is still in-memory and never rehydrated. **An outage preserves
sessions; a restart during or after one destroys them.** This is now explicit rather than
accidental — the `AuthService` constructor revokes every account session on boot with the
comment *"The authority credentials are held in memory. After a restart these account
sessions cannot authenticate and must release their slots."* Every 4A user is still signed
out by a deploy.

### 5.5 Misconfiguration is now loud

`probeProject()` runs at startup. A project ID that 4A rejects, or a credential without the
required permissions, throws `ConfigurationError` → `unavailable()` and the startup handler
rethrows anything that is not a 503. A healthy process serving nothing is no longer possible
without a log line explaining why.

---

## 6. Where auth data lives

| Data | Location | Notes |
|---|---|---|
| Credentials, password hash | **4A only** | Local `password_hash` is `''` for 4A accounts |
| Account identity | 4A → projected to SQLite `accounts` | On every login |
| `role` | 4A → projected | Read locally first in `admin-router` middleware |
| `disabled` | 4A → projected | Single writer since `76e9e6f` |
| Session records | SQLite `sessions` | SHA-256 digest only, never the token |
| 4A session token | **Process memory** (`authoritySessions`) | ← the remaining fragility |
| Cached 4A decision | **Process memory** | `checkedAt` + view; 30 s TTL, 20 s refresh |
| Browser credential | HttpOnly cookie `cardgame-<instanceId>` | `__Host-` prefix in production, `SameSite=Strict`, `Secure` in production |
| CSRF token | Derived from session token | Held in `PublicSessionClient.csrf` |
| Deck builder | **No localStorage** | Cookie-only |

### 6.1 Session TTLs (`config/auth.json`)

| Session | TTL |
|---|---|
| Game | 8 h |
| Admin | 15 min |
| Guest | 24 h |
| Max browser sessions per account | 5 |
| Max tabs per browser | 8 |
| Max sessions (global) | 1 000 |
| Max accounts | 10 000 |

---

## 7. What is already good

This is not a naive auth system. Several things are better than typical:

- **Digests, not tokens**, in the database
- **Argon2id** at 19 456 KiB / t=2 / p=1 — OWASP-aligned
- **Offline blocklist** — no network dependency, no privacy leak
- **Dummy hash** on unknown accounts — closes the timing oracle
- **Atomic transactions** with revocation notifications deferred until commit
- **Separate admin scope** with a 15-minute TTL — game token cannot inspect, admin token cannot play
- **Strict Zod schemas** in both directions
- **Redaction** before structured logging
- **Cookie flags** all correct, including `__Host-` in production
- **No localStorage** in the deck builder
- **Circuit breaker with generation-based recovery** — a stale probe cannot close a newer breaker
- **In-flight verification dedupe** — `current.verification ??=` collapses concurrent checks
- **Pause, don't destroy** — an authority outage pauses a match instead of reaping the room
- **Audit outcomes distinguish `unavailable` from `denied`** — the trail can say "we could not ask"
- **Admin operations carry the admin's own token** — 4A authorizes the actor, not the game server

The bones are good. The remaining problem is one uncached HTTP path.

---

## 8. The right-sized integration

### 8.1 Keep — cheap and load-bearing

| Thing | Why |
|---|---|
| Project scoping (`accounts_project_id`) | This *is* the tenant concept. One project = one tenant. Already correct. |
| The four fields (`id`, `username`, `role`, `disabled`) | Minimal honest contract |
| The three rights (`play`, `lab.operate`, `accounts.manage`) | Coarse is fine |
| Credential format + project pinning | Prevents cross-project token reuse |
| The local projection table | Necessary — decks and seats need a local FK |

### 8.2 Drop — scale features not needed here

| Thing | Why not |
|---|---|
| Multi-tenant console | One project |
| SCIM | No directory to sync |
| Groups / orgs | No teams |
| Token exchange | No downstream services |
| Fine-grained entitlements | Three rights |
| `activity()` heartbeat | Still write-only; its returned view could refresh the cache for free |

`tester` was on this list and has been removed from it: `7e9b9d3` made it load-bearing for
Test Room access, so it is no longer a scale feature the game ignores.

### 8.3 The minimal honest contract

```
POST /v1/accounts              → create
POST /v1/sessions              → sign in, returns { account, rights, expires_at }
POST /v1/sessions/verify       → is this still valid?
POST /v1/sessions/logout       → end
GET  /v1/projects/:id          → pin the tenant
```

Five endpoints. Four fields. Three rights. No `activity`, no `tester`.

### 8.4 The target consumption model

```
Login      → 4A → persist { accountId, role, disabled, rights, expiresAt } locally
Per-action → read the local row. No network.          ← sockets: done, HTTP: open
Refresh    → 4A verify every N minutes, update the row ← 20 s refresh age, 30 s TTL
Revoke     → 4A pushes → delete local row + disconnect ← still polling
Outage     → serve from the cached row until TTL, then pause and fail closed
```

This keeps 4A's revocation guarantee while removing the per-packet round trip. The socket
half is implemented; the HTTP half is not.

---

## 9. Remediation phases

### Phase 1 — Stop the bleeding — **mostly done**

| Change | File | State |
|---|---|---|
| Persist `authoritySessions` (encrypted at rest) | `auth/service.ts` + migration | ❌ **Open** — restart still signs everyone out |
| TTL cache on `verify()` — 30 s | `auth/service.ts` | ✅ `4cbd8c1` |
| Circuit breaker — open after 5 failures, 30 s cooldown | `auth/accounts-authority.ts` | ✅ `5759262` |
| `identity()` tolerates 503 | `auth/browser-routes.ts` | ✅ `5759262` |
| Startup probe against `/v1/projects/:id` | `application.ts` | ✅ `4cbd8c1` |
| Drop the 3 s heartbeat | `application.ts` | ✅ `4cbd8c1` — one 5 s loop for all sockets |

One item remains: the in-memory token store. Everything else in Phase 1 has landed.

### Phase 2 — Resolve dual authority — **done (Option A)**

`76e9e6f` took Option A. Under 4A, `POST /api/admin/accounts/:id/disable` proxies to
`PATCH /v1/admin/accounts/:id` with the admin's own session token. New routes `POST /accounts`
and `PATCH /accounts/:id` cover create, promote, demote, disable and enable. The local
`disabled` column is a cache with a single writer, and the `disabled: false` hardcode is gone.

Option B (a separate `locally_suspended` column) was not taken. It remains the answer if
operators ever need emergency local suspension during a 4A outage.

### Phase 3 — Move off the hot path — **half done**

| Now | Target | State |
|---|---|---|
| `authorize()` → `verify()` per socket packet | `canPlay()` reads a cached view | ✅ `4cbd8c1` |
| 3 s socket heartbeat | Background refresh loop | ✅ `4cbd8c1` — 5 s global loop, 20 s refresh age |
| `authorize()` → `verify()` per HTTP request | Cached view, same as sockets | ❌ **Open** |
| Poll for revocation | `POST /internal/4a/revocations` webhook | ❌ **Open** |
| 503 propagates | Serve cached view until TTL expires | ✅ `5759262` |

**The remaining work is the HTTP path.** `authorize()` still calls
`verifyAuthoritySession()` on every protected request. `verifyAuthoritySession()` dedupes
concurrent calls (`current.verification ??=`), so a burst of parallel requests costs one round
trip — but sequential requests each pay their own. `decks-router`, `admin-router` and
`/api/browser/tab` are all affected. Reusing `canPlay()`'s cached decision here, with a
`refreshPlayAccess()` call when it is stale, would close the gap with no new concepts.

### Phase 4 — Industry completeness — **unchanged**

Gaps that exist regardless of 4A:

| Gap | Note |
|---|---|
| **No MFA** | Acknowledged as future work. TOTP or WebAuthn. |
| **No refresh/rotation** | 8 h hard expiry, no silent renewal — users are logged out mid-session |
| **No account recovery** | No password reset flow at all |
| **No email verification** | Username-only; no recovery channel exists |
| **No auth metrics** | No latency/failure-rate observability on `verify()` |
| **`activeAdminCount()` on stale projections** | Unreachable under 4A; still live in standalone mode |
| **1 000 global session cap** | Will bite at scale; should be per-account or removed |

### 9.1 Priority

```
Phase 1  ███████████░  nearly done — only the in-memory token store remains
Phase 2  ████████████  done        — 4A owns disabled and role
Phase 3  ██████░░░░░░  half done   — sockets fixed, HTTP still per-request
Phase 4  ████░░░░░░░░  backlog     — real gaps, none urgent
```

---

## 10. The bespoke-protocol observation

The 4A contract is **custom**, not standard:

```
POST /v1/sessions/verify
Authorization: Bearer a4_<32hex>.<43base64url>
X-Accounts-Session: a4s_<32hex>.<43base64url>
```

This is a hand-rolled session-introspection protocol. It is close to
[RFC 7662](https://datatracker.ietf.org/doc/html/rfc7662) (OAuth 2.0 Token Introspection) but
not it — different header, different response shape, different credential format.

A standard **OIDC** integration would deliver the same four fields (`sub`,
`preferred_username`, `role`, plus a `disabled` claim) with:

- A discovery document instead of hardcoded paths
- JWKS for local signature verification — **no per-request network call at all**
- Standard libraries instead of a bespoke client
- Interoperability if the IdP is ever swapped

That is the real architectural gap: not "too much integration", but the **wrong kind** of
integration. A JWT-based OIDC flow would let the RP verify locally against cached keys, which
is exactly the property this system lacks. The 30-second cache in `4cbd8c1` is a hand-built
approximation of that property; it works, but it is a cache with a TTL rather than a
signature that can be checked offline.

---

## 11. Decision records

| ADR | Decision | Status | Alternatives and consequences |
|---|---|---|---|
| A4-01 | Keep the contract narrow: four account fields, three rights. | ✅ Held | A broader contract (profile, entitlements, groups) adds coupling with no gameplay benefit. |
| A4-02 | Drop scale features (SCIM, groups, token exchange, multi-tenant console) for this project. | ✅ Held | These are convenience features; none is load-bearing for a single-project card game. |
| A4-03 | Never drop the invariants in §3, even at home-project scale. | ✅ Held | Dropping them produces an ad-hoc system whose failures are silent and whose audit trail lies. |
| A4-04 | 4A is the sole writer of `disabled` and `role`; local rows are caches. | ✅ Implemented `76e9e6f` | Dual writers produce silent reverts and false audit records (§4.1, §4.3). |
| A4-05 | Move `verify()` off the packet path; refresh on a timer, revoke by push. | ⚠️ Half — sockets done, HTTP open | Per-packet remote introspection couples gameplay availability to IdP availability (§5.2). |
| A4-06 | Distinguish *unavailable* (503) from *denied* (401) at every call site. | ✅ Implemented `5759262` | Conflating them turns a network blip into an authentication failure and tears down live matches. |
| A4-07 | Prefer OIDC + JWKS over the bespoke introspection protocol if 4A can expose it. | ❌ Open | Local signature verification removes the hot-path network call entirely. |

---

## 12. Related documents

- [Accounts, sessions and admin access](authentication-architecture.md) — **predates 4A**; describes local Argon2id as primary
- [Tester manual](tester-manual/README.md) — Test Room workflows and long-lived lab sessions
- [Admin app, account disabling and auditing](admin-architecture.md)
- [Persistence, saved decks and database operations](persistence-deck-architecture.md)
- [Configuration folders, content and operator overrides](configuration-architecture.md)
- [Concept map](MAP.md)
- [Current architecture](../ARCHITECTURE.md)
