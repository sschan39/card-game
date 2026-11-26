# Ten-minute tour

A reading path for someone seeing this repository for the first time. It answers three questions in
order: **what is this**, **how is it built**, and **where do I look to judge the design**.

Everything here is a pointer. Nothing here restates the deep reference.

---

## 1. What it is (2 minutes)

A two-player, MTG-inspired card game. Three browser applications share one server and one rules
engine:

| Application | What a user does there |
|---|---|
| `apps/game-client` | Sign in, pick a saved deck, play a match on a landscape battlefield |
| `apps/deck-builder` | Browse the 159-card catalog and author/import/export decks |
| `apps/admin` | Inspect rooms, read bounded logs, disable accounts, run the Scenario Lab |

The rules engine is a separate package with no knowledge of sockets, HTTP, accounts or databases.
That separation is the central design decision, and most of the rest of the architecture follows
from it.

**Try it:** `npm ci && npm run build && npm start`, then open `http://localhost:3000/home`.

**See a match without a second person:** with the server running, `npm run demo` in another terminal
seeds two accounts, opens a room and seats a scripted opponent that plays a real game on its own. It
prints the room code and the username to sign in with at `/play` (password `demo-password-123456`).
The script must stay running, because the server destroys a room 30 seconds after its last seat
disconnects.

---

## 2. The one idea that explains the engine (3 minutes)

> **State changes are mutations. Events are derived from state changes. Triggers are discovered
> from events.** Nothing hand-emits an event.

That single rule produces the whole pipeline:

```
player command
  → GameEngine.executePlayerAction        the only public game API
  → action handler (validate → propose)   pure; returns GameMutation[]
  → gameReducer                           pure; returns a NEW GameRoom
  → deriveAppliedEvents                   events computed from the before/after diff
  → EventBus → TriggerManager             triggers push more mutations
  → runRulesCheckpoint                    settle until stable
  → projection → ViewDelta → client       audience-filtered, per viewer
```

Read it once in [`docs/MAP.md`](MAP.md#1-the-canonical-spine-memorize-this), which maps every stage
to a file. If you understand that line, you understand the engine.

**Why it matters:** because events are derived rather than emitted, the before/after diff is
guaranteed complete. That same diff is what powers client animation cues, the per-player delta
projection, and durable replay. One mechanism, three consumers.

---

## 3. Three decisions worth arguing about (3 minutes)

These are the places where the design made a real trade-off rather than following a template.

### 3.1 The engine cannot see the network

`packages/engine` has no import of Express, Socket.IO, SQLite or any account concept. The
dependency direction is **Types/Contracts → Library/Rules → Engine → Server → Apps**, and it is not
a convention — it is enforced by a TypeScript-AST test that fails the build on violation.

- Rule: [`docs/architecture-import-policy.md`](architecture-import-policy.md)
- Gate: `tests/architecture/import-boundaries.test.ts`
- Trade-off: the server must translate every transport message into an engine call, and the engine
  cannot log or persist on its own. That indirection is the price of testability — the engine suite
  runs with no server, no database and no sockets.

### 3.2 Clients never receive engine state

Every snapshot and delta passes through one audience policy. Opponent hands expose a count, not
card identities; libraries expose counts; private choices appear as "waiting". A sequence gap
freezes input and requests a fresh private snapshot instead of replaying a command.

- [`ARCHITECTURE.md` §6.2](../ARCHITECTURE.md) and Appendix B
- Trade-off: the projection layer is a second model to maintain. It buys a hard guarantee that a
  client cannot learn hidden information, and it makes reconnect a snapshot problem rather than a
  replay problem.

### 3.3 Accepted commands are durable before they are published

After the opening round, each accepted command records its authoritative UUID/random inputs plus
state and event checksums, and commits before the client update is broadcast. On restart the tail
replays through a fresh engine; a room whose checksums fail is quarantined alone.

- [`docs/match-recovery.md`](match-recovery.md)
- Trade-off: a write on the command path. It buys deterministic recovery and duplicate-command
  handling without weakening the engine's purity.

---

## 4. Where the design is written down (2 minutes)

| If you want to judge… | Read |
|---|---|
| Breadth of applied design knowledge | [`docs/design-principles.md`](design-principles.md) — 40 principles, each with mechanism, rationale and a `path:line` source |
| Whether the architecture is real or aspirational | [`ARCHITECTURE.md`](../ARCHITECTURE.md) — current-state reference with an explicit resolved/open gap table (§10) |
| How the code is verified | [`ARCHITECTURE.md` §11](../ARCHITECTURE.md) and [`COVERAGE.md`](../COVERAGE.md) |
| Honest self-assessment | [`docs/reports/`](reports/) — bug reports and QA audits, including the ones that were not fixed |

`docs/design-principles.md` is the fastest way to see the depth: every entry cites the exact line
that implements it, so nothing is claimed without a pointer.

---

## 5. Reading order if you have longer

1. [`docs/MAP.md`](MAP.md) — where every concept lives, and the end-to-end flows.
2. [`ARCHITECTURE.md`](../ARCHITECTURE.md) §1–§3 — overview, boundaries, engine layers.
3. [`docs/design-principles.md`](design-principles.md) — skim the index, then read three entries.
4. [`ARCHITECTURE.md`](../ARCHITECTURE.md) §6–§8 — server, multiplayer runtime, and a full
   play-a-card trace with diagrams.
5. [`docs/card-blockers-current.md`](card-blockers-current.md) — what the rules engine still cannot
   do, stated as a readiness definition rather than a wish list.

---

## 6. What is deliberately not finished

Stated plainly so the boundary is not mistaken for an oversight:

- **Coverage gate is red.** 96.8% measured against a 99% ratchet; see [`COVERAGE.md`](../COVERAGE.md).
- **CI is disabled.** `npm run verify` is the local gate.
- **No linter is configured.** [`docs/eslint-adoption-plan.md`](eslint-adoption-plan.md) is a plan.
- **Card content is in progress.** 159 definitions registered; six workbook rows deferred.
- **Deployment is a separate gate.** Linux/TLS installation, monitoring and security assessment are
  operations work, not claimed by the local build.
