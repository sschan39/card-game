# Admin Test Lab and Scenario Builder — Milestone 7

**Implemented:** 3 November 2026. Local application capability; Linux/network isolation remains a separate security-lab deployment gate. See [completion report](phase-7-status-2026-11-03.md).

## Start the local lab

From the repository root, install dependencies and build normally. Then set ADMIN_BOOTSTRAP_USERNAME and ADMIN_BOOTSTRAP_PASSWORD_FILE to a deliberately provisioned lab operator and an external protected password file, following [existing bootstrap policy](authentication-architecture.md#admin-api-and-operator-setup). Do not reuse live accounts/passwords or commit that file.

Run `npm run start:lab`. The built server selects [scenario-lab.example.json](../deploy/profiles/scenario-lab.example.json), binds loopback on port 3001 and requires lab identity, scenario capability and inspection. Open http://localhost:3001/admin/ and sign in with fresh admin scope. Public game/Home/Decks share this lab origin. Use localhost consistently; cookies are host-specific.

To play alone, open **Scenarios**. Choose **Play both seats** to use your draft, **Start with an empty board** to build a position from scratch, or **Start combat practice** to start with an attacker and blocker ready. The room opens in the same tab with two synthetic seats and one lab operator sign-in. Use the **Controlled seat** radios to switch sides, or turn on **Follow action** to switch to the seat that needs to respond. The room shows the active turn, selected seat and who needs to act. Both hands are available through an explicit opt-in.

For assigned-seat testing, select two distinct enabled lab accounts in the editor. Use separate browser profiles or independent game tabs for their public sign-ins. The lab operator may use a separate public game sign-in for one seat.

The default profile uses instance ID scenario-lab, its own SQLite database and JSONL paths under data/scenario-lab/. CONFIG_FILE can select a deliberately adapted lab override. Other allowlisted environment overrides still apply; check DATABASE_PATH/PORT/origin settings before starting. Existing persistent database identity binding rejects a mismatched instance. No tunnel is configured and no network-isolation claim follows from the label.

## Journey

Scenarios → New / Load preset / Load saved / Import → choose player and zone → edit counts/life/order/opening draw → Save revision → select assigned accounts → Launch → open each assigned game seat in its own tab → inspect/logs → revise snapshot or saved source → save/relaunch/export.

The editor shares CardSurface, CatalogTile, CardCountControls and BuilderTransfer with the public builder. Catalog filtering and card-count transformations live in engine-free protocol helpers. Apps retain their own authentication, HTTP and state adapters; no app imports another app.

Unsaved replacement/navigation prompts and per-tab draft recovery protect editing. Catalog and account reads are aborted/invalidated during mutations and on unmount; late results do not replace a newer operation. Storage failure is visible; export remains available. Recovered drafts do not retain saved-record authority and must be saved as a new record.

Test Rooms lists immutable launch snapshots. Resetting an assigned-seat run creates a new room ID from the launch snapshot, even after source edit/deletion. The old participants receive `roomDestroyed`. Stop releases a marked test room. Revise snapshot creates an editable draft from the launch state. Inspector and bounded log pages retain the selected run context. Log filtering applies to the current bounded page.

## Edit a running single-operator room

Open **Edit board** to pause both seats and auto-pass. Choose **Add from catalog**, search by name or card ID, and select a destination. The card can be completely absent from the match. Each added copy has its own identity. Use **Move existing card** to relocate a specific copy. Setup placement is silent. To test a cast or an entry trigger, place the card in hand, resume and play it through the normal match controls. An empty board starts with empty libraries. Add cards to the libraries before advancing into a draw step if the test should continue.

The editor can also set life, mana, land plays used, marked damage, counters, tapped state, summoning sickness and selected turn positions. It can add registered tokens, host cards under a permanent, attach Equipment to legal hosts and apply power and toughness modifiers. **Stage a spell** and **Stage an activated ability** prepare stack objects in an open priority window without paying costs. Use **Board edits as JSON** to supply announcement values, modes or targets. The editor lists all card and stack IDs for the current position. Normal casts and activations remain available for testing the cost and choice flows themselves.

**Undo last edit** restores the position before the edit. **Reset to starting scenario** resets the same single-operator room and clears its undo history. **Named checkpoints** preserve an exact position in this run, including live stack objects, combat declarations, pending choices and the random generator's position. **Board edits as JSON** also lets you copy and share batches of setup commands. A valid batch applies together and can be undone in one step. Scenario fixtures exported from the builder describe starting positions and can be shared across runs. Named checkpoints last for the current run. Recipes that contain instance IDs apply to the position that contains those IDs.

All single-operator controls use standard buttons, inputs and selects. Tab reaches the launch and edit actions, arrow keys switch seats within the radio group, and focus moves into the editor and returns to its trigger on close. Seat changes and edit results are presented in status messages. The live board is unavailable while the editor is open.

The server reuses the normal room runtime, per-seat projections and gameplay commands. A single-operator launch issues separate credentials for the editor and each seat. They are scoped to one room and the operator session. Playtest credentials are kept in the current tab and expire with the operator session. The lab edit route checks the current board revision before it rebuilds the engine and resyncs both seat views. Leave via **Back to Test rooms** and use **Resume both seats** in the current tab, or stop the run there to release it.

## ADR N7-01 — separate contracts and persistence

Normal decks still use standard legality/copy/size checks. Scenario v1 permits otherwise ineligible canonical test cards and smaller/empty libraries, with strict resource limits. Only IDs/counts and supported setup fields are accepted; no code, effects, arbitrary mutations, security flags or credentials.

Scenario records are global within the privileged lab, separate from account-owned decks. Migration 004 adds a revisioned JSON-content scenarios table. Optimistic expectedRevision prevents lost updates/launching a stale source. Source ID, revision and timestamps are server-created. Fixture provenance and original import provenance are descriptive metadata, never authorization.

Alternative: relaxing standard deck validation globally would make normal matches ambiguous. Separate schemas/storage cost an extra editor adapter but preserve the normal format.

## Scenario v1 setup

- Exactly two players, each with life 1–1000.
- Library, explicit hand, graveyard and initial battlefield lists of canonical IDs/counts.
- Each zone: at most 64 distinct IDs and 250 cards; hand including opening draw ≤50; battlefield ≤40.
- Initial battlefield supports canonical Creature/Land/Artifact/Relic/Enchantment cards; Aura setup is rejected. Starting permanents are already present: their entry effects are not replayed. Arbitrary attachments/tokens/stack/choices/mana state are not authored.
- Opening draw 0–30, bounded by each library. Explicit hand is added before the opening draw.
- Fixed libraryOrder must match its count multiset. First listed card is drawn first; absent order expands the count list in order.
- Fixed or seeded shuffle, unsigned 32-bit gameplay seed, chosen first player. Start at main phase with that player's priority.
- Only existing standard-v1 and scorch-v1 profiles; no new gameplay rules.

Engine setup lives in scenario-setup.ts and consumes plain setup data. It knows nothing about admin, storage or HTTP. Gameplay random generators are seeded for initial shuffle and runtime play; cryptographic session/room/player/card identifiers remain independently generated. Fixture assertions compare semantic card/state results, not randomly generated UUIDs.

## ADR N7-02 — server gates, assigned seats and immutable runs

Scenario APIs require a valid admin-scoped session, current enabled admin role, lab.enabled, navigation.purpose=lab and inspectionEnabled. lab.enabled defaults false in its owned JSON file. Live and ordinary development instances refuse the capability even if one flag is supplied.

Launch binds two enabled lab account IDs to server-generated room players. A normal game-tab bearer claims only its account's assigned seat. A sibling child cannot steal an occupied seat; the admin bearer and browser-family cookie cannot authenticate that socket. The game link carries only an opaque testRoom reference. Successful claim stores the tab's room context and removes the temporary query parameter. Snapshot metadata identifies scenario/source revision in the game.

CRUD/import/read/export/run operations are audited. Persistent changes and audit outbox participate in transactions; memory adapters have matching rollback behavior. New runtime rooms are cleaned up on aborted work, and destructive reset/stop cleanup is deferred until commit. Runs and room/seat bindings remain ephemeral; restart retains saved scenarios and audit records, not active games.

Alternative: a live-data/admin toggle is cheaper but crosses trust boundaries. This design requires separate operator provisioning and public sign-in for the lab.

## API inventory

All scenario bodies are strict and versioned; malformed/unknown fields fail. Setup JSON is limited to 24 KiB. Fixture text import accepts up to 64 KiB, allowing readable exported JSON; it is parsed and sent as compact JSON within the scenario API's 32 KiB HTTP body bound. Other API body bounds remain unchanged.

| Route under /api/admin/scenarios | Method | Behavior |
|---|---|---|
| / | GET / POST | Bounded list / create |
| /:id | GET / PUT / DELETE | Read / expected-revision update / expected-revision deletion |
| /import | POST | Validate versioned fixture and create new identity; retain import origin |
| /:id/export | GET | Export current saved revision plus provenance |
| /presets | GET | Five legacy preset exports for editor import |
| /:id/launch | POST | Require saved revision and two enabled participant accounts |
| /runs | GET | Bounded-by-capacity active marked test runs |
| /runs/:id/reset | POST | New room from the launch snapshot |
| /runs/:id | DELETE | Stop a marked test room |

POST /api/lab/rooms/:id/claim accepts a normal account game-tab bearer and a version-only body. It derives the assigned player server-side. Regular joinRoom cannot enter marked test rooms.

Defaults: 100 saved scenarios and 16 active test rooms; operator maximums are bounded. Reset can replace a room at capacity. Capability/limits/permissions remain external startup configuration, never editable through the panel.

## ADR N7-03 — fixture promotion and preset inventory

Exports are versioned card-game-scenario JSON. Import validates structure, bytes and canonical IDs before writing; malformed imports do not partially save. A new source gets a new ID; original import origin remains visible on subsequent exports.

Checked-in [scenario fixtures](../tests/fixtures/scenarios/README.md) reproduce all five old presets without login/database/browser. Review and commit an export deliberately; tests never select mutable database records.

| Preset | Classification after M7 | Compatibility evidence |
|---|---|---|
| development | Legacy automated fixture, editor import | Exact library/hand/life/default rules |
| trigger | Legacy automated fixture, editor import | Exact library/hand/life/default rules |
| st01a | Legacy automated fixture, editor import | Exact 60-card order, 7-card opening, Scorch |
| workbook | Legacy automated fixture, editor import | Exact 60-card order and 7-card opening |
| small-mechanics | Legacy automated fixture, editor import | Exact 60-card order and 7-card opening |

Ordinary development defaults now disable fixture fallback and debug shortcuts. Normal rooms use selected saved decks and canonical rule defaults, without validating an unrelated fallback deck. The test profile and explicit legacy fixture mode retain narrow engine presets for existing automated regressions. Those source-controlled fixtures are intentionally preserved; manual playtest editing belongs in saved decks or scenarios. Engine runtime imports no tests directory.

## Storage and operations

Before upgrade, stop writers and take/verify a backup with the pre-upgrade release; the current backup helper can migrate the source database it opens. Migration 004 adds a table and preserves old records. Rollback requires matching source/static builds and a pre-upgrade backup; do not downgrade in place. Keep live/lab databases and credentials independent.

Scenario audit events use the existing durable outbox and diagnostic/admin-audit rotation. Exported JSONL rotation does not prune SQLite audit rows; an operator retention/pruning policy remains deployment work. Bound storage and preserve needed incident evidence. Never expose raw database/log/fixture credentials through static routes.

All eight TypeScript projects, four builds, focused logic/render checks, architecture imports and short HTTP/socket acceptance are recorded in the report. Browser visual interaction, Linux/TLS installation and network isolation were not tested or claimed.
