# Milestone 3 implementation ledger

The goal is durable accounts/sessions, an ownership-scoped saved-deck API, a paged card catalog and saved decks in real match setup. Live rooms remain ephemeral. Verification follows the user's focused-test preference; no browser smoke or long/full-suite wait is required.

## Decisions and sequence

1. Use exactly pinned `better-sqlite3` in the server workspace, plus its TypeScript declarations as a development dependency. Keep SQL, migrations and driver APIs inside `stores/`; no ORM or additional validation library. Remove unused Mongoose from root and server manifests.
2. Add numbered transactional migrations, foreign keys, unique account identities, hashed session records, owned decks and normalized deck entries. Use prepared statements and short synchronous transactions; never hold a transaction across password hashing. Inject the repository into existing auth code. Keep room-seat bindings process-local.
3. Make register/link/rotate/issue atomic at the repository boundary, with revocation notifications delivered after successful commit. Preserve scope/role/expiry checks. Repeated bootstrap verifies an existing admin's secret and never promotes a player or resets a password implicitly.
4. Define public catalog/deck DTOs and strict request/response schemas in protocol. A pure shared validator uses a versioned `standard` format: minimum 60, maximum 250, four copies except explicit unlimited `land-red`. Exclude RPS and development-only fixtures from legal saved decks. This is the project's initial constructed format, not a claim of universal MTG/card-game rules.
5. Expose public paged catalog reads and account/game-scope-only deck CRUD. All ownership derives from the session, never request fields. Enforce payload, page and per-account deck bounds. Return identical deck-validation errors from the shared validator and REST API.
6. Accept only an owned deck reference over the socket. Resolve/validate its contents server-side, then copy each player's cards into serializable room setup. Shuffle saved decks with the engine's runtime randomness; later edits/deletion cannot mutate an active match. Development fixtures are available only under the server debug setting. Add a small existing-client deck selector; the builder UI remains Phase 5.
7. Add logrotate configuration, a database backup command using the driver's backup API, restore instructions and failure-mode documentation. Verify native driver/build packaging and focused acceptance before committing.

## Completion evidence to collect

- Close/reopen persistence of account, valid game/admin sessions and saved decks; expiry/revocation remain effective; rooms/seats do not restore.
- Migration reapplication and failed-migration rollback; ownership predicates/constraints; transaction rollback without orphan account or lost valid session.
- Catalog pagination/schema safety; minimum/copy/unknown/fixture/duplicate-entry limits; cross-account read/list/update/delete/play denial.
- Real short socket RPS-to-play with distinct saved decks, exact card composition, hidden information intact and immutable room snapshots after deck edits.
- Repeatable admin bootstrap with current credential, denied collision/credential mismatch; focused prior auth/runtime/client/architecture regressions; typechecks and both builds.
- Clear library ownership, pinned dependency/lockfile changes, migration/backup/restore/log rotation documentation and final completion report.
