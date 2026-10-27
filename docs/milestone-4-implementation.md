# Configuration refactor and Milestone 4 implementation ledger

The user asked to continue after the configuration-folder proposal and Milestone 4 explanation. Scope includes the proposed data/config separation, then the separate admin application and its server APIs. Standing verification preference: focused logic and short integration checks, typechecks and builds; no browser smoke or long/full-suite wait. Commit when complete.

## Requirements and decisions

1. Extract editable server auth/HTTP/storage/room/logging values and development/production profiles into dedicated JSON files. Strict Zod validation, deterministic replacement merge, optional operator override, narrow environment overrides and startup failure with setting names only. Keep secrets in protected external sources. Add no configuration framework.
2. Extract engine rules, elements and named development decks into clear config/preset files. Split authored card definitions into grouped content folders with an explicit catalog index. Preserve every existing card ID/definition and preset. Keep engine-independent shared deck rules/eligibility in protocol JSON, move account quota to server settings, and expose only safe public config to browsers.
3. Snapshot effective gameplay settings into each room, retain compatibility imports during refactoring and avoid changing running rooms when global defaults change. Reject invalid configuration rather than silently falling back to development. Config remains restart-loaded.
4. Build `apps/admin` as an independent React/Vite app with routes for rooms, logs, accounts and read-only effective configuration. Use a separate storage key, fresh admin-scoped login, expiry/logout handling, cancel stale requests, bounded pagination and polling. Keep admin code out of the player build. Reuse existing dependencies; a small hash router avoids adding a routing framework for four pages.
5. Require valid admin scope/current role on every admin route, including the separate inspector. Provide paged accounts and account disabling with immediate revocation of both scopes/sockets. Protect against disabling the final active administrator. No role promotion/password reset/config editing is added.
6. Append credential-safe audit records with actor/action/target/outcome/time for privileged reads/actions. Account changes and their durable audit event commit together, with JSONL export to `data/admin-audit.jsonl`; retain pending export on failure. Add a migration and test atomic failure behavior.
7. Implement bounded seek-based diagnostic-log reads using opaque signed cursors, page/byte/line limits and rotation/truncation detection. Support the plan's initial offset while bounding work. Verify pagination through a 100,000-line fixture without whole-file reads.
8. Add independent build/typecheck commands, development origin/proxy and nginx serving examples for an admin origin. Update architecture appendices/supplements, setting/file inventory, operator instructions and completion evidence.

## Evidence required before completion

- Config schema/precedence/array replacement, production isolation, secret redaction and invalid override tests; equality of card catalog and preset data before/after extraction; room snapshot stability.
- Admin API 401/403/expiry/inspection flag behavior; persistent account list/disable and immediate game/admin session invalidation; final-admin protection and audit consistency.
- Large diagnostic-file paging with bounded reads/memory, malformed/oversized lines, bad cursor and rotation/truncation cases.
- Admin login/storage/API/routing/expiry/cancellation logic and rendered component checks; no admin API paths/code in player build.
- Focused affected auth/storage/deck/gameplay/import checks; all typechecks and three builds; final source/diff/documentation audit and commit.
