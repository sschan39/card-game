# Navigation and public sessions — Milestone 6

**Date:** 29 October 2026. **Status:** implemented; see [completion evidence](phase-6-status-2026-10-29.md), [implementation ledger/ADRs](milestone-6-implementation.md) and [Appendix G](../ARCHITECTURE.md#appendix-g-navigation-public-sessions-and-planned-test-lab). Milestone 7's Scenario Builder remains planned. Game rules and card content are unchanged.

## User journeys and routes

Home, Play and Decks share ordinary account sign-in. The workspace header displays the configured instance purpose/name, current workspace/breadcrumb and account controls. An active game's workspace links open another tab with no opener so its socket remains connected. Each game tab receives its own server-derived seat identity. A browser tab can retain/recover its existing credential; a new tab does not inherit another tab's seat through a room URL.

| Destination | Current behavior |
|---|---|
| `/home` | Lightweight public overview; reads browser identity, shows up to five real owned decks and an explicitly verified resume link for this tab's cached room. Opening Home alone does not issue a game credential or connect a socket. |
| `/play`, legacy `/` | Lobby, registration/login, owned-deck selection and room create/join. Root now owns connection startup; entering a lobby establishes the session before the game screen exists. |
| `/play/rooms/:roomId` | Bookmarkable reference, validated by a bearer-authenticated resume API and by seat ownership at the socket boundary. A missing/foreign room yields recovery/lobby feedback, not membership. |
| `/deck-builder/` | Existing catalog/editor, recoverable drafts, import/export and owned saves. “Play this deck” passes its UUID to a separate game tab using the browser sign-in. |
| Configured admin origin, existing `#rooms/#logs/#accounts/#config` | Existing operations sidebar plus shared navigation. Requires its own fresh admin-scoped password login. |
| Test Lab | Explicitly unavailable. Instance purpose can be displayed, but `/api/platform` reports `scenarios: false`; no editor/launch feature is advertised as working. |

Server static routing serves the public shell for supported Home/Play/room paths. `/api/*` misses remain versioned JSON 404s and never become SPA HTML. Admin production assets remain outside the public backend's static routes. Unknown client routes have a recovery page; old root, deck handoff and admin hashes remain supported. Validated post-login returns accept known public routes only; a builder return uses the configured builder destination, not an arbitrary caller URL.

## Workspace/config ownership

| Source | Owns |
|---|---|
| `packages/ui/src/config/navigation.json` | Shared top-level IDs/labels/destination keys and admin visibility |
| `packages/ui/src/WorkspaceHeader.tsx` | Header, account-menu slot, breadcrumbs, game-tab link behavior and configured workspace subpage links |
| `apps/server/src/config/navigation.json` | Built-serving URLs, instance ID/purpose/label and optional admin/lab destinations |
| `apps/server/src/config/navigation.vite.json` | Explicit Vite development destinations on 5173/5174/5175 |
| `packages/protocol/src/rest/platform.ts` | Strict public metadata/identity/route-response schemas and bounded extra-page registry |
| `packages/browser-session/src/index.ts` | Framework-independent cookie/CSRF transport, safe-return/route helpers, verified room-resume client and stale-read handling |
| Each frontend | Local router, account/game state and API adapters; no app imports another app |

`GET /api/platform` returns the validated frozen startup navigation and unavailable scenario capability. `extraPages` registers up to 32 uniquely named entries with label/href/workspace/admin visibility; each owning app still implements its page/route. Links do not authorize APIs. Public builds contain no admin API/session/editor implementation. The header can link to the configured admin frontend without importing it.

Navigation URLs allow root-relative paths or HTTP(S), without credentials/query redirects. Production public destinations must all be relative on one origin, or absolute HTTPS URLs sharing one origin. A configured production admin URL requires a separate HTTPS origin and absolute public destinations. This is necessary for host-only cookie reuse, not a cross-origin storage bridge.

## ADR M6-01: browser account family and tab game credentials

The server issues an opaque **browser-family** session in an HttpOnly, host-only, SameSite=Strict cookie. Production also uses Secure and the `__Host-` prefix. Its name incorporates the configured instance ID; local HTTP development uses the unprefixed variant. The cookie is not returned in JSON or exposed to JavaScript. Browser identity reads return account/session metadata plus an HMAC-derived CSRF token, retained in memory only.

Each game tab obtains a separate **child** bearer through the browser-session API. Child bearers stay in per-tab `sessionStorage`, with an in-memory fallback when storage is unavailable. They authorize sockets and tab-specific room resume. Browser cookies never authenticate sockets or admin APIs. The engine sees ordinary PlayerIds; accounts own saved decks while child credentials own room seats. Linked guest/legacy seats retain their existing engine PlayerIds, so rejoin authorization checks the seat ownership record and does not infer ownership from a matching player-ID string.

Defaults: browser/account lifetime eight hours, guest lifetime 24 hours, admin lifetime 15 minutes; child expiry cannot exceed its parent. There is no sliding extension/refresh token. Reusing a valid child returns the same credential/seat, including at capacity. Defaults bound browsers to five families per account and eight children per family, within the existing global 1,000-session limit. Config hard ceilings are 16 families and 32 children. Closed tabs can remain counted until logout/fixed expiry; end a game session or sign out the browser to release capacity. Password attempts share one configured rate-limit bucket across cookie, legacy and admin password endpoints.

A successful browser login replaces the previous cookie's family, preserving other bounded browser families. Merely opening Play/Decks does not log in again or rotate the family. Existing legacy bearer login retains its historical same-account game-scope rotation, including newer public families; this preserves old API behavior. New UIs use the cookie flow.

| Action | Effect |
|---|---|
| End this game session | Revoke this bearer; leave browser account access and sibling credentials intact |
| Sign out this browser | End the local game credential and cookie family/children; other browser families remain |
| Sign out all public sessions for an account | Revoke that account's browser families, children and legacy game credentials; admin scope remains independent |
| Disable account | Existing atomic admin operation revokes both scopes and retires associated sockets |
| Expiry | Reject credentials and their descendants; child timers/per-packet checks retire sockets |

Public account-wide logout supports an explicit game bearer even without a cookie, so a migrated legacy tab cannot accidentally leave the account's other families alive. If a stale credential needs cookie fallback, the account must match; it cannot sign out a different browser account. Mixed legacy/browser account context is shown in the account menu. Browser-family revocation walks descendants inside the transaction and emits notifications only after commit; a failed durable delete rolls back without publishing revocation.

## HTTP and request integrity

| Endpoint | Authentication / contract |
|---|---|
| `GET /api/browser/me` | Cookie; returns nullable browser identity and CSRF token, never its bearer |
| `POST /api/browser/register`, `/login` | Strict versioned credentials, approved Origin, JSON and `X-Card-Game-Client: browser-v1`; public/game scope only |
| `POST /api/browser/tab` | Cookie plus CSRF protections; optional existing game bearer and room reference to reuse/link a seat |
| `POST /api/browser/logout`, `/logout-all` | Cookie plus CSRF protections and strict versioned logout body |
| `POST /api/auth/logout` | Explicit bearer; revoke that credential (legacy compatibility/local game logout) |
| `POST /api/auth/logout-all` | Explicit public account game bearer; revoke all public sessions for its subject |
| `/api/decks` | Browser cookie with CSRF protection for mutations, or existing explicit game-account bearer; an invalid explicit bearer never falls back to cookie auth |
| `GET /api/rooms/:id/resume` | Explicit game bearer; returns only verified room/session/player references. A room-specific player can differ from a cached default after guest linking. |

Cookie mutations require exact configured Origin, JSON, the custom client header and the synchronizer token obtained from an authenticated read. Login/register use Origin plus the non-simple custom header to prevent login CSRF. CORS remains exact-allowlist with credentials, never wildcard. Missing/foreign origins, duplicate cookie values, bad tokens/CSRF, wrong scopes and malformed bodies fail closed. Explicit bearer APIs do not use ambient cookie fallback. The shared client restricts API destinations and ignores superseded identity/CSRF reads; generation checks prevent delayed session establishment after local logout. Writes are not silently retried after ambiguous failures.

These choices follow the [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) and [MDN cookie-prefix/attribute requirements](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie). HttpOnly does not prevent XSS from acting as the current user or requesting a child credential; escaping, CSP, origin checks and separately scoped admin access remain necessary.

## Persistence, isolation and rollout

Migration 003 adds session purpose/parent-digest fields and `instance_identity`. Existing rows default to legacy semantics. Raw parent/child credentials are not stored: digests and parent digests are durable. Rooms and seat bindings remain ephemeral, so restart preserves account/deck/session records but loses active matches. Old game bearers remain valid until expiry/rotation/revocation; the new builder discards its old dedicated session key and uses browser sign-in. A one-time public sign-in is required when adopting the new flow; no old bearer is silently copied into a shared cookie.

The application binds a persistent database to its instance ID/purpose on first use and refuses a mismatched live/lab identity. Set these values deliberately before first startup. A lab requires its own hostname/origin, instance ID, database, credentials and paths; do not copy live account/session data or remove the identity record to bypass the guard. Temporary independent instances demonstrate credential rejection in both directions. Displaying `purpose: lab` is not a Linux/network isolation claim, and scenario capability remains unavailable until Milestone 7.

Before upgrading, stop writers and take/verify a consistent backup using the **pre-upgrade release's** backup command. The backup helper opens its current `SqliteStore` and may apply its schema migrations; running the new helper on an old database is not a substitute for a pre-migration rollback backup. Keep application/static builds together. New migrations are not downgraded in place; rollback requires the matching pre-upgrade backup, source version and session invalidation as described in the [storage operations guide](persistence-deck-architecture.md#operations-and-failure-modes). Test fixtures/old preset files are not migrated in Milestone 6.

## Running and deployment

- **Built apps:** `npm run build`, then `npm start`. Open `http://localhost:3000/home`, `/play` or `/deck-builder/`. The default `FRONTEND_MODE=built` uses same-origin links.
- **Vite:** `npm run dev` builds/starts the backend with `--vite`; separately run `npm run dev:client`, `npm run dev:deck-builder` and optionally `npm run dev:admin`. Vite targets are selected from `navigation.vite.json`. API proxies share the localhost host cookie across their ports, while game credentials stay scoped to each tab's origin/storage. These local origins are trusted development surfaces.
- **Production:** use `NODE_ENV=production`, configure exact origins and HTTPS navigation through a protected operator file based on [the example](../deploy/platform-config.example.json). `FRONTEND_MODE=vite` is rejected. Cookie reuse requires Home/Play/Decks on the same public origin. Old `VITE_GAME_URL` and per-frontend development destination settings are replaced by server-owned navigation.
- Use the [public nginx example](../deploy/nginx/public.conf.example) alongside the separate [admin origin](../deploy/nginx/admin.conf.example). API misses must remain API responses; room paths receive the public shell. Public scripts remain external; the game example allows inline styles for existing positioning. Configure `http.trustProxy: loopback` only for the shown local proxy topology and overwrite forwarding headers. Default trust is false; broad trust is rejected. This follows the [Express proxy guidance](https://expressjs.com/en/guide/behind-proxies/).

`FRONTEND_MODE` selects a bundled navigation baseline after the environment profile; explicit operator/programmatic overrides then take precedence. Other allowlisted environment overrides retain their existing precedence. Source defaults require rebuild/restart; operator changes require restart. Do not expose the backend directly when relying on the proxy/firewall topology. Installed TLS, nginx, Linux native runtime/client-IP behavior and UI/browser interaction remain separate verification work, not claims from these examples.

## Verification boundaries

Focused logic/render checks exercise navigation registry/roles, compatible/invalid routes, approved returns, the lobby's connection lifecycle, storage fallback, stale reads/logout, session/seat verification and preserved editor/card rendering. Short real HTTP/socket checks cover shared sign-in → save → room → full turn → update without revocation; guest linking; sibling denial; legacy player-ID collisions; family/global/logout/disable/expiry; CSRF/origin/cookie flags; shared rate limits; independent instances and database binding; and supported static/API routing. All eight TypeScript projects and four application builds are required. Browser smoke, long socket/full-suite waits and target-host deployment are excluded by the user's standing instruction. See the report for exact results and limitations.
