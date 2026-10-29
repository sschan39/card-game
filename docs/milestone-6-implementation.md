# Milestone 6 implementation ledger

**Date:** 29 October 2026. **Status:** acceptance complete. Scope: roadmap 6.1–6.6, no game-rule changes. Branch pulled first; completed work is recorded in the Milestone 6 commit. Focused logic/short HTTP/socket checks, architecture, all typechecks/builds; no browser smoke, long socket/full suite.

## ADR M6-01 — public browser family plus tab credentials

Use an opaque HttpOnly, host-only, SameSite=Strict browser cookie for shared public account access. Production cookies require Secure and use the __Host- prefix; local HTTP development uses a distinct unprefixed name. Names include the configured instance ID. Production public apps share an origin; localhost Vite proxies share the host cookie across ports. Separate lab instances require distinct hostnames/instance IDs and databases. Admin retains fresh per-tab bearer credentials on its own origin; browser credentials are never accepted by admin or game sockets.

The browser family issues bounded child game bearer credentials, stored per game tab. Children have distinct seat ownership/PlayerIds; reload/reconnect reuses the same child only with validated ownership. Guest/account linking transfers the existing seat server-side. Child expiry cannot exceed the parent. Browser-family login rotates only the prior browser family; other devices remain bounded and independent. A fresh login is not required when moving to the builder. No refresh token or sliding lifetime: an 8-hour fixed family expiry requires another login. Renewing a valid tab credential does not extend the family or create a new seat.

Unsafe cookie requests require an approved Origin, JSON, a custom request header and a synchronizer token from an authenticated same-origin read. Login/register require approved Origin plus the non-simple custom header (login CSRF protection). Bearer-only legacy APIs keep their explicit-credential semantics. Cookie auth never silently rescues an explicitly invalid bearer. CORS stays allowlisted, never wildcard. No credentials in URLs, localStorage or cross-origin message/storage bridges.

Local game logout revokes that tab only; browser sign-out revokes its family/children; explicit account-wide public sign-out revokes all game/browser families and legacy game sessions, preserving separate admin scope. Disabling revokes both scopes. Expiry/revocation walks children and notifies sockets after commit. Global and per-account/family bounds prevent unlimited session growth. Migration adds session purpose/parent fields with legacy defaults, retaining old bearer clients until their fixed expiry; stale legacy builder storage is discarded by the new UI. Old game credentials remain usable through existing bearer routes and never silently become a shared browser cookie.

Alternative: cross-app bearer copying would expose credentials and fail separate-origin dev; a single account-wide socket credential conflates tabs/seats. A cookie directly authenticating every socket would also conflate tab ownership. This family model adds migration/CSRF and lifecycle work but preserves explicit game credentials and scoped admin behavior.

## ADR M6-02 — navigation and instance identity

Shared React-only UI header/registry, app-owned API/router adapters. Trusted server public config owns approved navigation destinations, instance ID/purpose/label and unavailable Test Lab metadata. Home lives in game-client; direct/legacy routes remain compatible. Room/deck references are validated input, not authority. Existing game tabs keep sockets while workspace actions open new tabs. Public builds may link to admin frontend but contain no admin API/session/editor code. Lab launch remains unavailable until Milestone 7; no isolation claim from a badge.

## Acceptance checklist

- [x] Browser-family/CSRF/migration/bounds and atomic revocation behavior; shared password rate limits and account-wide legacy logout.
- [x] Single public sign-in → save → child game room/turn → update without disconnection; sibling seats, foreign rooms and legacy player-ID collisions rejected.
- [x] Shared navigation, Home, bookmarkable routes, old URLs, safe returns, draft recovery, active-game tab behavior.
- [x] Trusted environment metadata, persistent instance binding, admin separation, unavailable Test Lab.
- [x] 221 passing checks across 19 focused files, all eight project typechecks and four application builds; bundle/import checks.
- [x] Architecture appendix/supplement, operations/migration and evidence report prepared for the Milestone 6 commit.

See the [completion report](phase-6-status-2026-10-29.md) for the requirement-by-requirement audit, commands, setup and verification limits. Milestone 7 owns scenario editing/launch and fixture migration; Milestone 8 retains the original UI revamp.
