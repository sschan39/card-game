# Server storage adapter

`sqlite-store.ts` is the sole runtime importer of pinned `better-sqlite3`. It implements `AccountRepository` and `DeckRepository`; consumers use those contracts. No ORM, driver object or SQL enters the engine, protocol or client. Migration files import driver types only and bundle their schema strings with the server.

The process entry point injects a file-backed store; isolated application tests can keep in-memory repositories. Accounts, hashed sessions and owned decks persist. Rooms and seat bindings do not. Close the store when its owning application closes. Password hashing is asynchronous and stays outside short synchronous transactions; socket revocation notifications publish after commit.

Add a new numbered migration rather than changing an applied schema. Tests cover reapplication, rollback, unknown versions, ownership, failed auth/deck writes and backup content. See the [architecture and operations supplement](../../../../docs/persistence-deck-architecture.md) for dependency rationale, native-runtime requirements, backup/restore and file permissions.
