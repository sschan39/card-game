# Logging

Structured diagnostics for the card game. `packages/engine/src/shared/game-logger.ts` provides one `GameLogger` implementation used by the **server** and the **engine**. The **client** does not use it: `apps/game-client/logger.ts` is a small console shim (see [Subsystems](#subsystems-the-source-field)).

There are five diagnostic channels plus a separate player-visible game log, and they are managed very differently. Read [Where logs go](#where-logs-go) before assuming anything is persisted.

## Why

- **Server** needs detailed logs to debug game flow (every action, state change, RPS step).
- **Client** needs clear, presentable diagnostics without raw debug spam.
- **Structured entries**: server and engine logs are objects, so a future sink could persist them without changing call sites. No such sink is configured today.

## Log levels

| Level | Meaning | Used for |
|-------|---------|----------|
| `debug` | Fine-grained internals | `event:emitted`, `trigger:received`, `trigger:queued`, `delta:details` — all gated by `appliedEvents` |
| `info`  | Normal game events | Room created/joined, RPS started/resolved, connections, `command:accepted`, `delta:published` |
| `warn`  | Recoverable issues | `command:rejected`, `action:rejected`, `action:unknown`, rejoin failures |
| `error` | Failures | `transition:invalid`, `connection:failed`, `server:startup:failed` |

The client shim has no `debug` level; it only exposes `info`, `warn` and `error`.

## Subsystems (the `source` field)

| Source | Logger | Implementation | Min level | Notes |
|--------|--------|----------------|-----------|-------|
| `server` | `serverLogger` | `GameLogger` | `debug` | Socket/room/action/delta diagnostics |
| `engine` | `engineLogger` | `GameLogger` | `debug` | Event bus, state machine, trigger manager, action service |
| `client` | `clientLogger` | console shim | n/a | `apps/game-client/logger.ts` — no `LogEntry`, no sinks, no level filtering |

The `clientLogger` exported from `packages/engine/src/shared/game-logger.ts` is **not used by the client app**. The client imports its own shim:

```ts
// apps/game-client/logger.ts
function log(level: 'info' | 'warn' | 'error', event: string, message: string, details?: unknown) {
  console[level]('[client:' + event + '] ' + message, details ?? '');
}
```

It emits a flat `[client:event] message` string plus an optional details object. It has no `debug` level, no `source` field, no timestamp, and no sink. The engine's `clientLogger` singleton is dead code kept only for API compatibility.

## Log entry format

Applies to `serverLogger` and `engineLogger`. The client shim emits a plain string instead.

Every log is a `LogEntry` object:

```ts
interface LogEntry {
  timestamp: string;   // ISO 8601 UTC, e.g. "2026-08-28T12:34:56.789Z"
  level: LogLevel;     // 'debug' | 'info' | 'warn' | 'error'
  source: string;      // 'server' | 'engine'
  event: string;       // kebab-case domain event, e.g. 'rps:resolved'
  message?: string;    // human-readable summary
  data?: Record<string, unknown>; // structured payload
  context?: Record<string, unknown>; // room/command/batch/event IDs and other correlation fields
}
```

### Console rendering

```
[12:34:56.789] INFO  server rps:resolved rock vs scissors → winner abc123 {"p1Played":"rock","p2Played":"scissors","winner":"abc123","winnerIsPlayer1":true}
```

- `[HH:MM:SS.mmm]` — time (UTC)
- `LEVEL` — padded to 5 chars
- `source` — subsystem
- `event` — domain event
- `message` — optional summary
- `{...}` — JSON payload (omitted when empty)

## Where logs go

Five diagnostic channels exist. Only two are durable, and only one is properly managed.

| Channel | Written by | Destination | Durable | Managed |
|---------|-----------|-------------|---------|---------|
| `serverLogger` | `apps/server/src/**` | stdout via `consoleLogSink` | ❌ | ❌ no sink, no log capture |
| `engineLogger` | `packages/engine/src/**` | stdout via `consoleLogSink` | ❌ | ❌ no sink |
| `clientLogger` | `apps/game-client/**` | browser devtools console | ❌ | ❌ nothing in `localStorage`/`IndexedDB` |
| `data/deltas.jsonl` | `SyncService.appendToLog` | file, one JSON line per delta | ✅ | ⚠️ see below |
| `data/admin-audit.jsonl` + `admin_audit` table | `AuditService` | SQLite outbox, then JSONL export | ✅ | ✅ at-least-once, keyed by UUID |

### Server and engine: stdout only

`GameLogger` defaults to `sinks: [consoleLogSink]` (`game-logger.ts:64`). No file, database, or HTTP sink is configured anywhere in `apps/server`. Nothing in the repository captures stdout: `deploy/systemd/` contains only a README stating the units are planned, so a production deployment would lose these logs on restart or terminal close.

### Client: browser console only

`apps/game-client/logger.ts` calls `console.info`/`warn`/`error` directly. Nothing is buffered, persisted, or sent to the server. Closing the tab discards it.

### Delta log: durable but unmanaged

`SyncService.appendToLog` (`sync-service.ts:481`) does `fs.appendFileSync` with no size cap and no rotation. `deploy/logrotate/deltas` covers both `deltas.jsonl` and `admin-audit.jsonl` (daily, `maxsize 10M`, `rotate 7`, `compress`), but it targets `/opt/cardgame/data/` and is not installed by anything in this repository. `redactCredentials` is applied by `DiagnosticLogReader` **on read**, not on write, so the file on disk holds the delta exactly as published.

### Admin audit: the only managed channel

`AuditService` writes to a SQLite outbox first, then exports to JSONL at-least-once keyed by record UUID, flushed on a timer (`auditFlushMs`, default 5000) and explicitly after each admin request. The JSONL file is created on first flush, so it may not exist until an admin action occurs. This is the reference implementation for what the other channels lack.

## Player-visible game log

Separate from all of the above. `apps/game-client/components/GameLog.tsx` renders the `log` array in `gameStore.ts`, which is built from applied deltas:

- One entry per delta: `seq`, `action` (rendered through `ACTION_ID_LABELS`), `playerId`, `commandId`, `summary`, `changes` count.
- `summary` is composed client-side from the delta diff (phase, turn, priority, stack, life, mana, battlefield entries/departures, combat declarations).
- Capped at the last 100 entries via `.slice(-100)` (`gameStore.ts:165`).
- Reset to `[]` on `clearSession` (`gameStore.ts:194`).
- Not durable and not authoritative: after a reload it is rebuilt only from deltas received from that point on. A `roomSnapshot` restores the board but does not repopulate the log.

This is a UI affordance, not a log. Do not use it for debugging or auditing.

## Event naming convention

Use `domain:action` kebab-case. The complete set currently emitted:

| Domain | Events |
|--------|--------|
| `room:*` | `room:create`, `room:created`, `room:join`, `room:joined`, `room:rejected`, `room:destroy:cancelled`, `room:destroy:scheduled`, `room:destroyed` |
| `rps:*` | `rps:started`, `rps:phase`, `rps:resolved` |
| `player:*` | `player:connected`, `player:disconnected`, `player:rejoined`, `player:rejoin:failed` |
| `command:*` | `command:received`, `command:accepted`, `command:rejected` |
| `action:*` | `action:sent`, `action:rejected`, `action:unknown` |
| `delta:*` | `delta:published`, `delta:details`, `delta:applied` |
| `targeting:*` | `targeting:started`, `targeting:cancelled` |
| `trigger:*` | `trigger:received`, `trigger:queued` (debug only) |
| `game:*` | `game:started` |
| `transition:*` | `transition:invalid` |
| `event:*` | `event:emitted` |
| `server:*` | `server:listening`, `server:startup:failed` |
| other | `snapshot:applied`, `options:requested`, `connected`, `disconnected`, `connection:failed`, `rejoin:failed`, `opponent:joined`, `auth:notification:failed` |

The client shim uses the same names but renders them as `[client:<event>]`.

## How to add a log

```ts
// inside packages/engine
import { engineLogger } from '../shared/game-logger';
// inside apps/server
import { serverLogger } from '@card-game/engine/shared/game-logger';

serverLogger.info('rps:resolved', `${p1} vs ${p2} → winner ${winner}`, {
  p1Played: p1,
  p2Played: p2,
  winner,
});
```

Rules:
1. **`event`** is always a stable kebab-case identifier — never put dynamic values in it.
2. **`message`** is a short human summary (optional).
3. **`data`** carries structured fields — this is what a future DB sink would index.
4. Pick the right level: `debug` for internals, `info` for game events, `warn` for recoverable, `error` for failures.
5. Gate high-frequency diagnostics behind `gameConfig.logging.actions` or `appliedEvents` so they can be turned off without a code change.

## Extending events and sinks

The logger accepts any stable event name and structured payload. It has no event-specific formatter or switch to update when adding events. Supply sinks through the constructor; console output is the default:

```ts
const entries: LogEntry[] = [];
const logger = new GameLogger({
  source: 'engine',
  sinks: [consoleLogSink, entry => entries.push(entry)],
});
const contextual = logger.withContext({ roomId, commandId, batchId });
contextual.debug('addon:resolved', 'Custom event', { value: 42 });
```

`withContext()` inherits level filtering and sinks, merges context, and leaves its parent unchanged. Sinks receive the structured entry, including inherited context. Sink callbacks run synchronously and should not throw.

For a new rules event, add its payload to `GameEventPayloads` in `packages/engine/src/types/game-event.types.ts`. State-change events may retain derivation in `packages/engine/src/engine/applied-events.ts`; semantic operations may own their event list in an explicit committed outcome. Choose one owner per instruction. A successful event need not change state (for example, an empty-library shuffle); `reduceGameOperation` retains success independently of equality. Omitted outcome events preserve existing derivation; a present list replaces that step's semantic derivation. The payload interface supports declaration merging for addons. Every committed instruction also produces `MUTATION_APPLIED`, so new mutation types remain visible without custom logging code. Rejected/redundant instructions produce no success event. The delta mapping is exhaustive: new state mutations require an explicit wire mapping.

## Applied batches and JSONL

The engine publishes game events after a mutation batch has been applied. `drainEventBatches()` consumes that operation's timeline. Runtime batches retain before/after room references, mutations, command context and cause information. Departure snapshots and trigger discovery use the shared batch before-state; other triggers use the committed after-state. Engine reducers retain immutable room references; host-side setup must avoid mutating those snapshots when retaining them for inspection.

Each event has an `eventUuid`, `batchId` and optional `commandId`. Trigger batches carry the originating event IDs, and state-based-action batches reference their parent batch. Resolution reports are published only when their stack object was actually removed. Rejected commands produce a contextual `command:rejected` diagnostic and no committed batch.

`SyncService` records batch metadata and event payloads alongside patches in `data/deltas.jsonl`. Full before/after rooms are omitted. Player deltas omit the internal event timeline and retain the command ID for correlation. `replay()` reads records; this remains a debug timeline, not complete game restoration: setup baselines and durable restart sequencing are separate work.

### Known limits of the delta log

- **No size cap or rotation in process.** `appendToLog` appends unconditionally. The `deploy/logrotate/deltas` policy is Linux-only and uninstalled, so on a dev machine the file grows without bound.
- **Whole-array changes amplify.** `SET_TURN_HISTORY`, `RECORD_ABILITY_USE` and `RECORD_LAND_PLAY` each emit a single `turnHistory` change carrying the entire array (`sync-service.ts:340`), so every such delta re-serializes all prior history. This is the dominant growth term.
- **Batches embed full card blueprints**, including `rulesText`, rather than card IDs.
- **Redaction happens on read, not on write.** `redactCredentials` runs in `DiagnosticLogReader`; `appendToLog` writes the delta verbatim.
- **`replay()` loads the whole file** with `fs.readFileSync` and filters in memory. It has no production call sites; only tests use it.
- **The admin viewer cannot read most of the bytes.** `DiagnosticLogReader` caps lines at `maxLineBytes` (65536, `apps/server/src/config/logging.json`). Oversized lines are counted as `skipped` and silently omitted from the page.

Set `logging.deltaPath` to an empty string to disable the file entirely; `appendToLog` and `replay` both return early when it is unset.

## Configuring verbosity

Each singleton is pre-configured, but you can create a custom logger:

```ts
const logger = new GameLogger({ source: 'server', minLevel: 'info', enabled: true });
```

Set `gameConfig.logging.actions` in `packages/engine/src/config/diagnostics.json` (re-exported through `packages/engine/src/config.ts`) for compact action tracing on frontend, server and engine. It defaults to true. It controls sends/receipts, accepted/rejected command diagnostics, delta publication/application, snapshot restoration and local targeting diagnostics. Turning it off leaves visible UI feedback and JSONL recording intact. Connection/runtime errors retain their own error diagnostics.

`gameConfig.logging.appliedEvents` enables detailed event output and `delta:details`, including batch IDs. It defaults to false; JSONL recording remains enabled independently. Normal `delta:published` carries room/command/action/player IDs, sequence and patch count. Each successful changed action can be followed by the same command ID in both browser consoles and the backend.

Both flags gate **console diagnostics only**. Neither affects what `SyncService` writes to `data/deltas.jsonl`, and neither affects the admin audit trail.

## Frontend-to-backend action tracing

`useGameActions.playerAction` creates one tracing `commandId` and includes it in the existing flat packet. `parseActionPacket` extracts it from rule data; `withCommandContext(action, playerId, operation, commandId?)` preserves it through nested engine/host work. Existing callers without an ID retain server-generated IDs. IDs identify diagnostics only: they do not identify game objects, authorize actions, order packets or provide retries/deduplication.

```text
client action:sent → server command:received → engine command:accepted/rejected
  → server delta:published → client delta:applied (both players)
```

Opening a choice is accepted with `outcome=choice` and choiceId/kind; a committed action uses `outcome=committed`; an accepted action with no mutation uses `outcome=no_change`. A rejected action uses the existing error channel with message/action/commandId and produces no fabricated success delta. A subsequent choice answer has its own command ID and carries the existing choiceId. Rule continuations do not retain packet tracing fields.

Local target selection logs `targeting:started` and `targeting:cancelled`; cancellation sends no player command. Cancelling a server prompt uses the existing `choose` action and normal command/delta trace. Start/join/options intents include the available room/player/source context without new success/ack events.

Choice sends and backend receipts use shared `choiceAnswerDetails`: chosen number (including zero), selected-item count, allocation total and nonzero allocation option IDs/amounts. Combat declarations also include selected attacker pointers or attacker/blocker assignments, allowing the same participants to be followed from frontend send to backend receipt. Zero allocations are omitted; the trace carries compact choice IDs/amounts rather than room or definition dumps. Engine/client choice diagnostics include the numeric range or required allocation total; applied client diagnostics include the declaration owner. A new choice answer keeps its own command ID and the saved choice ID; nothing in this diagnostic metadata changes payment or rule continuations.

App renders a dismissible rejection banner on the start and game screens. The recent GameLog retains command IDs as entry tooltips and summaries of choices, stack changes, phase, priority, turn handoff, battlefield entry/departure, changed mana or life. Accepted attacker/blocker declarations and completed combat damage have readable summaries, with matching display labels for identical battlefield creatures. Direct land plays report entry without a fabricated stack/cast event; mana production/payment reports the resulting pool. Phase labels reuse the PhaseBar's shared display names. This view remains bounded to the existing 100 recent entries and is rebuilt from subsequent deltas after reload; it is not a durable replay or authoritative semantic-event source.

## Logger options

- `minLevel` — drop anything below this level.
- `enabled` — master kill switch (e.g. disable in production).
- `sinks` — where entries go. Defaults to `[consoleLogSink]`; nothing else is configured in this repository.

## Related: action ID mismatches

A common runtime error is `No handler registered for action: <id>`, which happens when the
action ID a client sends doesn't match a registered handler. Because action IDs are
free-form strings, this is not caught at compile time. The canonical registry linking every
action ID to its producer and consumer is in [`docs/action-ids.md`](action-ids.md) — keep it
in sync whenever you add, rename, or remove an action ID.
