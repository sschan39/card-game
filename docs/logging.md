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

For a new rules event, add its payload to `GameEventPayloads` in `src/types/game-event.types.ts` and derive it in `src/engine/applied-events.ts`. The payload interface supports declaration merging for addons. EventBus listeners infer known payload types; custom event names remain supported. Every applied mutation also produces `MUTATION_APPLIED`, so new mutation types are visible without custom logging code. The delta mapping is exhaustive: new mutations require a wire mapping at compile time.

## Applied batches and JSONL

The engine publishes game events after a mutation batch has been applied. `drainEventBatches()` consumes that operation's timeline. Runtime batches retain before/after room references, mutations, command context and cause information. Departure snapshots and trigger discovery use the shared batch before-state; other triggers use the committed after-state. Engine reducers retain immutable room references; host-side setup must avoid mutating those snapshots when retaining them for inspection.

Each event has an `eventUuid`, `batchId` and optional `commandId`. Trigger batches carry the originating event IDs, and state-based-action batches reference their parent batch. Resolution reports are published only when their stack object was actually removed. Rejected commands produce a contextual `command:rejected` diagnostic and no committed batch.

`SyncService` records batch metadata and event payloads alongside patches in `data/deltas.jsonl`. Full before/after rooms are omitted. Player deltas omit the internal event timeline and retain the command ID for correlation. `replay()` reads records; this remains a debug timeline, not complete game restoration: setup baselines and durable restart sequencing are separate work.

## Configuring verbosity

Each singleton is pre-configured, but you can create a custom logger:

```ts
const logger = new GameLogger({ source: 'server', minLevel: 'info', enabled: true });
```

Set `gameConfig.logging.appliedEvents` in `src/config.ts` to enable console event output and delta publication diagnostics. It defaults to false; JSONL batch recording remains enabled independently. Console records carry command/batch/event IDs; `delta:published` adds the delta sequence and batch IDs.

- `minLevel` — drop anything below this level.
- `enabled` — master kill switch (e.g. disable in production).

## Related: action ID mismatches

A common runtime error is `No handler registered for action: <id>`, which happens when the
action ID a client sends doesn't match a registered handler. Because action IDs are
free-form strings, this is not caught at compile time. The canonical registry linking every
action ID to its producer and consumer is in [`docs/action-ids.md`](action-ids.md) — keep it
in sync whenever you add, rename, or remove an action ID.
