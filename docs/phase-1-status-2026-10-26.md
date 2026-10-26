# Platform Milestone 1 — Completion Evidence

**Date:** 26 October 2026. **Branch:** `platform/foundation`.

**Status:** Milestone 1 implemented. Accepted verification passed: **49 targeted tests in 7 files**, strict project typechecks and both production builds.

## Scope and acceptance

This delivers Phase 1 of the [platform plan](platform-plan-2026-10-24.md): the protocol package and per-player projection boundary. It builds on committed Phase 0. The branch was pulled with fast-forward-only behavior before this work; it was already up to date. The user waived browser smoke tests and subsequently waived further long socket tests and time-consuming full-suite runs. This report claims the targeted verification below.

| Plan item | Implementation and authoritative evidence |
|---|---|
| 1.1 Protocol workspace | `packages/protocol` owns version 1, player/card/choice DTOs, deltas, action parser, client/server event contracts and presentation helpers. Workspace dependency/lockfile and TypeScript references include it. `protocol-contract.test.ts` checks action vocabulary parity, version rejection and identity-field stripping. |
| 1.2 Server-resolved views | `projection/view-builder.ts` and `card-view.ts` build explicit DTOs from effective characteristics and retained public source information. Projection tests check displays, mutation isolation and rejected unknown viewers. Characteristic scopes reuse a board evaluation during projection and expire afterward; engine cache tests check independent-result parity, retained incarnations and nested/exception cleanup. |
| 1.3 Audience policy | `projection/reveal-policy.ts` controls hands, public source visibility and RPS disclosure. Both libraries expose counts only. Tests check hidden UUIDs, future nested fields, source/event payloads and private attachment references. Explicit reveal receipts preserve intended public names without publishing raw cards. |
| 1.4 Projected synchronization | `delta-projector.ts` diffs projected before/after state; `SyncService` emits `ViewDelta` while retaining internal mutation logs. Create/join/RPS/options/actions/reconnect use the projection boundary. The real socket helper compares each receiver's applied state with a fresh projection after accepted actions. A dedicated lifecycle test inspects actual packets for hidden IDs, blueprints, decks, continuations and event batches. |
| 1.5 Inspector boundary | `projection/debug-channel.ts` requires debug enablement, authenticated identity and an admin/inspector role. Six HTTP logic tests cover disabled, absent authentication, missing role, authorized roles and absent room. Production composition intentionally supplies no authenticator and denies access until Phase 2. No temporary authentication bypass or public full-state route was introduced. |
| 1.6 Client migration | Client store mirrors `PlayerView`. Cards, choices, stack, combat and targeting read server display/candidate fields. Local selection uses canonical target revisions and drops newly illegal/reincarnated targets. Version, audience, room, duplicate/gap and unsafe-path logic tests protect updates. UI logging/flags have no engine dependency. |
| 1.7 Import policy | Five-edge exception list is empty. AST tests enforce no client engine imports, type-only protocol engine dependencies, app/package boundaries and existing rule ownership constraints. R-B is clarified to allow authoritative server engine imports. |

## Verification

The accepted final checks are:

- `npm run typecheck`: passed for engine, protocol, server and client through project references.
- `npm run build`: passed for the server and independent player production build.
- Targeted Vitest run: **49 passed, zero failed, 7 files** — `player-projection`, `protocol-contract`, `debug-channel`, `public-event-notifications`, `view-contract`, `characteristic-projection-cache`, and `import-boundaries`.
- `npm run test:architecture`: **18 passed**, with the client engine exception list empty.

These targeted tests cover audience filtering, hidden IDs, effective displays/targets, opaque choice/ability handles, RPS secrecy, future nested fields, reveal-source privacy, protocol versions, inspector roles, sequence/unsafe-path rejection and characteristic-cache parity. Both build outputs were inspected; the player bundle contains neither engine implementation names nor card catalog/blueprint data.

Real socket scenarios remain in the repository and compare applied views with fresh projections after accepted actions. Earlier focused runs passed the packet-privacy lifecycle scenario, complete fresh ST01A match, and other socket regressions. Existing rule assertions are retained or adapted to the explicit wire contract. Socket test allowances account for the added projection comparisons; no assertions were removed to accommodate duration.

Earlier broad verification passed 1,373 tests across the 118 files excluding the long socket suite. Combined runs encountered socket timeouts, including a run with a large host wall-clock jump. The last combined run was stopped at the user's request. **A clean final full-suite result is not claimed or required by the accepted verification scope.**

No browser smoke test was run. Visual browser behavior and hosted deployment health are outside the accepted verification scope.

## Decisions and limits

The [architecture supplement](protocol-projection-architecture.md) contains the diagram and ADRs. [ARCHITECTURE.md Appendix B](../ARCHITECTURE.md#appendix-b-protocol-and-player-projection), the workspace supplement, concept map and import policy describe the current boundaries.

Top-level projected patches prioritize an auditable visibility policy over minimum bandwidth. Choice and generated ability handles are stable for the life of the in-memory process and do not provide authentication. A sequence gap asks the player to reconnect; reconnect restores the complete view and current sequence. Internal JSONL logs remain privileged server artifacts; socket tests use temporary logs.

Account authentication, guest linking, session trust, persistence, durable restart recovery, hosted deployment, an admin UI and a deck builder remain later milestones. Closing the raw-state disclosure path does not fix the unauthenticated guest identity issue. The inspector's authentication seam is ready for Phase 2 and currently fails closed.
