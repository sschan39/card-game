// src/shared/game-logger.ts
// Structured logger used by the server and the engine.
//
// The browser client does NOT use this module: apps/game-client/logger.ts is a
// small console shim with no LogEntry, no sinks and no level filtering.
//
// Every log is a structured `LogEntry` object (not a raw string) so it can be
// written to a database later without changing any call sites. The default sink
// is the console; callers can inject additional structured sinks. No persistent
// sink is configured anywhere in this repository.
//
// See docs/logging.md for the full format spec and conventions.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  /** ISO 8601 timestamp (UTC), e.g. "2026-08-28T12:34:56.789Z". */
  timestamp: string;
  level: LogLevel;
  /** Which subsystem emitted the log: 'server', 'client', 'engine', etc. */
  source: string;
  /** Kebab-case domain event, e.g. 'room:created', 'rps:resolved'. */
  event: string;
  /** Optional human-readable summary. */
  message?: string;
  /** Optional structured payload (DB-ready). */
  data?: Record<string, unknown>;
  /** Correlation fields inherited by contextual loggers. */
  context?: Record<string, unknown>;
}

export type LogSink = (entry: LogEntry) => void;

export interface LoggerOptions {
  /** Minimum level to emit. Defaults to 'debug' (everything). */
  minLevel?: LogLevel;
  /** Master switch. Defaults to true. */
  enabled?: boolean;
  /** Source tag stamped on every entry. */
  source?: string;
  context?: Record<string, unknown>;
  /** Defaults to the console sink. An empty list disables output. */
  sinks?: readonly LogSink[];
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Event-agnostic structured logger with inherited context and injectable sinks.
 */
export class GameLogger {
  private readonly minLevel: LogLevel;
  private readonly enabled: boolean;
  private readonly source: string;
  private readonly context: Record<string, unknown>;
  private readonly sinks: readonly LogSink[];

  constructor(options: LoggerOptions = {}) {
    this.minLevel = options.minLevel ?? 'debug';
    this.enabled = options.enabled ?? true;
    this.source = options.source ?? 'app';
    this.context = { ...options.context };
    this.sinks = options.sinks ?? [consoleLogSink];
  }

  /** Inherit configuration and sinks without changing the parent logger. */
  withContext(context: Record<string, unknown>): GameLogger {
    return new GameLogger({ minLevel: this.minLevel, enabled: this.enabled, source: this.source,
      sinks: this.sinks, context: { ...this.context, ...context } });
  }

  private shouldLog(level: LogLevel): boolean {
    return this.enabled && LEVEL_ORDER[level] >= LEVEL_ORDER[this.minLevel];
  }

  /** All event types share the same output seam. */
  private write(entry: LogEntry): void {
    for (const sink of this.sinks) sink(entry);
  }

  private log(level: LogLevel, event: string, message?: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;
    this.write({
      timestamp: new Date().toISOString(),
      level,
      source: this.source,
      event,
      message,
      data,
      context: { ...this.context },
    });
  }

  debug(event: string, message?: string, data?: Record<string, unknown>): void {
    this.log('debug', event, message, data);
  }

  info(event: string, message?: string, data?: Record<string, unknown>): void {
    this.log('info', event, message, data);
  }

  warn(event: string, message?: string, data?: Record<string, unknown>): void {
    this.log('warn', event, message, data);
  }

  error(event: string, message?: string, data?: Record<string, unknown>): void {
    this.log('error', event, message, data);
  }
}

/** Formatting is independent of event definitions; every event uses the same sink. */
export const consoleLogSink: LogSink = (entry) => {
  const time = entry.timestamp.slice(11, 23);
  const level = entry.level.toUpperCase().padEnd(5);
  const data = { ...entry.context, ...entry.data };
  const dataStr = Object.keys(data).length ? ` ${JSON.stringify(data)}` : '';
  const msg = entry.message ? ` ${entry.message}` : '';
  const line = `[${time}] ${level} ${entry.source} ${entry.event}${msg}${dataStr}`;
  if (entry.level === 'error') console.error(line);
  else if (entry.level === 'warn') console.warn(line);
  else console.log(line);
};

// ---------------------------------------------------------------------------
// Pre-configured singletons
// ---------------------------------------------------------------------------

/** Server-side logger — very detailed (debug level). */
export const serverLogger = new GameLogger({ source: 'server', minLevel: 'debug' });

/**
 * Unused by the client app, which has its own console shim in
 * apps/game-client/logger.ts. Retained for API compatibility only.
 */
export const clientLogger = new GameLogger({ source: 'client', minLevel: 'info' });

/** Engine logger — shared by engine internals (event-bus, state-machine). */
export const engineLogger = new GameLogger({ source: 'engine', minLevel: 'debug' });
