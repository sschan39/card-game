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

## Adding a DB/file sink later

The single seam is `GameLogger.write(entry)`. To persist logs, replace the console call there (or add a second sink) — no call sites change:

```ts
private write(entry: LogEntry): void {
  // console rendering (current)
  // + db.insert('logs', entry)  // future
}
```

## Configuring verbosity

Each singleton is pre-configured, but you can create a custom logger:

```ts
const logger = new GameLogger({ source: 'server', minLevel: 'info', enabled: true });
```

- `minLevel` — drop anything below this level.
- `enabled` — master kill switch (e.g. disable in production).