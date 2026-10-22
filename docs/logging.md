# Logging

Centralized structured logging for the card game. One logger (`src/shared/game-logger.ts`) is shared by the server, client, and engine, with different verbosity per subsystem.

## Why

- **Server** needs very detailed logs to debug game flow (every action, state change, RPS step).
- **Client** needs clear, presentable logs (no raw debug spam).
- **Future-proofing**: every log is a structured object, so it can be written to a database later without changing any call site.

## Log levels

| Level | Meaning | Used for |
|-------|---------|----------|
| `debug` | Fine-grained internals | Engine events, per-mutation detail, RPS card plays |
| `info`  | Normal game events | Room created/joined, RPS started/resolved, connections |
| `warn`  | Recoverable issues | Rejected actions, missing previous phase |
| `error` | Failures | Invalid transitions, server errors |

## Subsystems (the `source` field)

| Source | Logger | Min level | Notes |
|--------|--------|-----------|-------|
| `server` | `serverLogger` | `debug` | Very detailed — everything |
| `client` | `clientLogger` | `info` | Clear and presentable — no debug noise |
| `engine` | `engineLogger` | `debug` | Event bus + state machine internals |

## Log entry format

Every log is a `LogEntry` object:

```ts
interface LogEntry {
  timestamp: string;   // ISO 8601 UTC, e.g. "2026-08-28T12:34:56.789Z"
  level: LogLevel;     // 'debug' | 'info' | 'warn' | 'error'
  source: string;      // 'server' | 'client' | 'engine'
  event: string;       // kebab-case domain event, e.g. 'rps:resolved'
  message?: string;    // human-readable summary
  data?: Record<string, unknown>; // structured payload (DB-ready)
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

## Event naming convention

Use `domain:action` kebab-case:

| Domain | Examples |
|--------|----------|
| `room:*` | `room:created`, `room:joined` |
| `rps:*` | `rps:started`, `rps:played`, `rps:resolved`, `rps:rejected` |
| `player:*` | `player:connected`, `player:disconnected` |
| `game:*` | `game:started` |
| `transition:*` | `transition:invalid`, `transition:no-previous-phase` |
| `event:*` | `event:emitted` |
| `server:*` | `server:listening`, `server:error` |

## How to add a log

```ts
import { serverLogger } from './shared/game-logger';

serverLogger.info('rps:resolved', `${p1} vs ${p2} → winner ${winner}`, {
  p1Played: p1,
  p2Played: p2,
  winner,
});
```

Rules:
1. **`event`** is always a stable kebab-case identifier — never put dynamic values in it.
2. **`message`** is a short human summary (optional).
3. **`data`** carries structured fields — this is what a future DB sink will index.
4. Pick the right level: `debug` for internals, `info` for game events, `warn` for recoverable, `error` for failures.

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

For a new rules event, add its payload to `GameEventPayloads` in `src/types/game-event.types.ts`. State-change events may retain derivation in `src/engine/applied-events.ts`; semantic operations may own their event list in an explicit committed outcome. Choose one owner per instruction. A successful event need not change state (for example, an empty-library shuffle); `reduceGameOperation` retains success independently of equality. Omitted outcome events preserve existing derivation; a present list replaces that step's semantic derivation. The payload interface supports declaration merging for addons. Every committed instruction also produces `MUTATION_APPLIED`, so new mutation types remain visible without custom logging code. Rejected/redundant instructions produce no success event. The delta mapping is exhaustive: new state mutations require an explicit wire mapping.

## Applied batches and JSONL

The engine publishes game events after a mutation batch has been applied. `drainEventBatches()` consumes that operation's timeline. Runtime batches retain before/after room references, mutations, command context and cause information. Departure snapshots and trigger discovery use the shared batch before-state; other triggers use the committed after-state. Engine reducers retain immutable room references; host-side setup must avoid mutating those snapshots when retaining them for inspection.

Each event has an `eventUuid`, `batchId` and optional `commandId`. Trigger batches carry the originating event IDs, and state-based-action batches reference their parent batch. Resolution reports are published only when their stack object was actually removed. Rejected commands produce a contextual `command:rejected` diagnostic and no committed batch.

`SyncService` records batch metadata and event payloads alongside patches in `data/deltas.jsonl`. Full before/after rooms are omitted. Player deltas omit the internal event timeline and retain the command ID for correlation. `replay()` reads records; this remains a debug timeline, not complete game restoration: setup baselines and durable restart sequencing are separate work.

## Configuring verbosity

Each singleton is pre-configured, but you can create a custom logger:

```ts
const logger = new GameLogger({ source: 'server', minLevel: 'info', enabled: true });
```

Set `gameConfig.logging.actions` in `src/config.ts` for compact action tracing on frontend, server and engine. It defaults to true. It controls sends/receipts, accepted/rejected command diagnostics, delta publication/application, snapshot restoration and local targeting diagnostics. Turning it off leaves visible UI feedback and JSONL recording intact. Connection/runtime errors retain their own error diagnostics.

`gameConfig.logging.appliedEvents` enables detailed event output and `delta:details`, including batch IDs. It defaults to false; JSONL recording remains enabled independently. Normal `delta:published` carries room/command/action/player IDs, sequence and patch count. Each successful changed action can be followed by the same command ID in both browser consoles and the backend.

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

- `minLevel` — drop anything below this level.
- `enabled` — master kill switch (e.g. disable in production).

## Related: action ID mismatches

A common runtime error is `No handler registered for action: <id>`, which happens when the
action ID a client sends doesn't match a registered handler. Because action IDs are
free-form strings, this is not caught at compile time. The canonical registry linking every
action ID to its producer and consumer is in [`docs/action-ids.md`](action-ids.md) — keep it
in sync whenever you add, rename, or remove an action ID.
