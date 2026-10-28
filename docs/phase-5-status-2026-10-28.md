# Milestone 5 completion report — deck builder

**Date:** 28 October 2026. **Branch:** `platform/foundation`.

Milestone 5 implements the independent deck builder and connects it to owned-deck matches. The tracked branch was pulled first (`git pull --ff-only`: already up to date). The user's standing gate applies: focused logic/short integration checks, typechecks and builds; no browser smoke, long socket/full-suite wait or deployment verification.

See [Appendix F](../ARCHITECTURE.md#appendix-f-deck-builder-and-shared-card-display), [the architecture/setup supplement](deck-builder-architecture.md) and [implementation ledger](milestone-5-implementation.md).

## Requirement audit

| Requirement | Current implementation | Evidence |
|---|---|---|
| 5.1 independent builder workspace | `apps/deck-builder`, React/Vite at port 5175, base `/deck-builder/`, `/api` proxy; root scripts, project references and workspace lock updated | Builder and all other apps build; seven TypeScript projects pass; built asset URLs point to existing files under the correct base. |
| 5.2 public searchable/filterable catalog | Typed paged `/api/cards` loading; local search/type/color/eligibility filters; displayed stable IDs, printed rules and copy limits | Pure filter tests combine criteria; client paging checks inspect public requests with no bearer and cancellation, reject duplicate/malformed pages; real integration loads the complete printed catalog publicly. |
| 5.2 identical shared card face | React-only `packages/ui` exports `CardSurface` and common CSS; game wrapper retains runtime labels/state/actions | SSR compares the game hand face directly with shared face output, verifies battlefield labels/state classes and escaped content; architecture check positively verifies both consumers import UI. |
| 5.3 editable local draft and live shared rules | Name and copy controls, incomplete draft recovery, shared protocol `validateDeck`, visible errors and guarded save | Editor/model tests cover immutable add/remove, zero removal, empty-draft persistence, size/copy/excluded/unknown rules; render tests show validation and guest save guards. Existing deck rule tests also pass. |
| 5.3 owned save/load/update | Dedicated account login; typed owned list/create/update; saved record selection, save-as-new, dirty-state play gating; mutations lock edits | Client contract checks cover bearer/envelopes, create/update IDs, pagination and denial/error replies. Real HTTP checks prove ownership, updates, private lists, quota/persistence, foreign 404 and strict validation responses. |
| 5.3 text import/export | Stable-ID lines, JSON-quoted name, standard format, bounded parsing, duplicate merge and sorted export | Roundtrip tests include special names/CRLF, duplicate lines and unknown IDs; syntax/format/size/count failures leave the prior draft unchanged. Real acceptance imports/exports and edits the draft before saving. |
| 5.4 play handoff | Saved unchanged valid deck opens configured game in a new tab with no opener; UUID only; game retains request through fresh login and owned-list resolution | URL tests reject unsafe destinations, malformed/duplicate UUIDs and foreign IDs. Start-screen render blocks accidental room creation while sign-in is pending. Real acceptance uses a fresh login, observes builder-token rotation, resolves the owned deck, creates/joins with references, finishes RPS, plays a land and completes the turn. |
| 5.5 public browsing/drafting, authenticated saving | Separate per-tab builder session/draft namespaces; account-only saves; expiry/401/403/focus verification; server authorization unchanged | Storage tests reject guest/admin/expired/malformed sessions and tolerate unavailable storage. Public UI renders without auth; real no-session POST returns 401 and guest save returns 403. Account changes/sign-out clear the update target while preserving draft data. |
| Preserve boundaries and gameplay | Builder/UI import no engine/other-app code; one shared validator; server snapshots selected decks and keeps private lists out of projections | Import architecture gate passes. Real match compares public-catalog and server validator results, checks foreign create/join denial, private hands and unchanged room snapshots after saved-deck edits/deletion. |
| Documentation, appendix and operations | Appendix F, architecture/ADRs/failure semantics, roadmap/README/map/workspace/import/config guides and nginx public-location fragment | Reviewed against actual paths/configs and build scripts. Examples require target-host installation/validation; deployment is not claimed. |

## Focused verification

**202 unique checks passed across 15 focused files, with 0 failures.** The main run is recorded in ignored `build/m5-focused-final.json`:

| Area | Passing checks |
|---|---:|
| Builder model/storage/API/render/handoff | 25 |
| Player actions/shared face/pending handoff | 11 |
| Player auth/deck paging/store/socket feedback | 18 |
| Deck rules and short real saved-deck lifecycle | 18 |
| Configuration/content preservation | 14 |
| Authentication acceptance | 9 |
| SQLite persistence | 7 |
| Room runtime and reconnect | 37 |
| Engine player-command boundary | 42 |
| Import architecture | 21 |

After review, the draft schema was corrected to permit an empty array without inheriting the saved-deck minimum. The builder and real saved-deck lifecycle files were rerun: **30 passed, 0 failed** in `build/m5-final-draft.json`. These are a subset of the 202 cases, not 30 additional unique tests. The final `npm run typecheck` and `npm run build` both passed after that change, covering all seven projects and all four applications. An artifact check confirmed HTML asset bases/files and that the public game/builder bundles contain neither `/api/admin` paths nor the admin session key. Whitespace checks pass. Workspace installation reported 0 known npm vulnerabilities; this is not a security assessment.

Reproduce the focused gate:

```sh
npx vitest run tests/client/deck-builder.test.tsx tests/client/decks.test.ts tests/client/action-feedback.test.ts tests/client/auth-state.test.ts tests/client/gameStore.test.ts tests/client/socket-feedback.test.ts tests/server/deck-validation.test.ts tests/server/deck-acceptance.test.ts tests/server/configuration.test.ts tests/server/auth-acceptance.test.ts tests/server/sqlite-store.test.ts tests/server/room-runtime.test.ts tests/server/reconnect.test.ts tests/engine/player-commands.test.ts tests/architecture/import-boundaries.test.ts --pool=threads --maxWorkers=2
npm run typecheck
npm run build
```

The initial match run exposed a pre-existing choice-preparation regression introduced before this milestone: commands without announcement choices were rejected as unsupported. A minimal pass-through correction restores their existing handler validation. The 42 command-boundary cases and complete normal turn pass with the correction; the prior readability refactor remains intact. No game rules or card content changed.

## Running and practical limits

Run `npm run dev:deck-builder` and open `http://localhost:5175/deck-builder/` with the backend and player dev servers running. Built serving is `/deck-builder/` on the backend's origin. Register/sign in, build/import a legal deck, save and choose “Play this deck”; sign in to the new game tab with the same account. Game sign-in rotates the previous builder credential under the existing single-session-per-scope policy. Returning to the builder revalidates on focus, removes old authorization and retains the draft. Concurrent authenticated builder editing and play need a future auth policy change.

Production defaults return to `/` on the public origin; a different game host uses public build-time `VITE_GAME_URL`. Production allowed origins/API proxy/TLS must be configured for the installed host. Import/export and draft recovery remain local; saved IDs never convey ownership. Saves use the existing last-write-wins API, with no optimistic conflict UI or exactly-once create guarantee. Delete remains API-only. Catalog loading/filtering is deliberately bounded for this small project. Rooms remain ephemeral.

The original full `npm run verify` remains a CI/full-regression command and was not run. Browser interaction/visual smoke, long socket scenarios, Linux native installation, nginx/TLS and real deployment are unverified by this delivery. Milestone 6 (game client state/UI/animation revamp) remains the next platform milestone.
