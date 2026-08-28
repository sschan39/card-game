// src/shared/game-logger.ts
// Centralized structured logger shared by server, client, and engine.
//
// Every log is a structured `LogEntry` object (not a raw string) so it can be
// written to a database later without changing any call sites. For now the
// only sink is the console.
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
}

export interface LoggerOptions {
  /** Minimum level to emit. Defaults to 'debug' (everything). */
  minLevel?: LogLevel;
  /** Master switch. Defaults to true. */
  enabled?: boolean;
  /** Source tag stamped on every entry. */
  source?: string;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Structured logger. Console-only for now; the `write` method is the single
 * seam where a DB/file sink can be added later.
 */
export class GameLogger {
  private readonly minLevel: LogLevel;
  private readonly enabled: boolean;
  private readonly source: string;

  constructor(options: LoggerOptions = {}) {
    this.minLevel = options.minLevel ?? 'debug';
    this.enabled = options.enabled ?? true;
    this.source = options.source ?? 'app';
  }

  private shouldLog(level: LogLevel): boolean {
    return this.enabled && LEVEL_ORDER[level] >= LEVEL_ORDER[this.minLevel];
  }

  /** Single output seam — swap console for a DB writer here later. */
  private write(entry: LogEntry): void {
    const time = entry.timestamp.slice(11, 23); // "HH:MM:SS.mmm"
    const level = entry.level.toUpperCase().padEnd(5);
    const dataStr =
      entry.data && Object.keys(entry.data).length > 0
        ? ` ${JSON.stringify(entry.data)}`
        : '';
    const msg = entry.message ? ` ${entry.message}` : '';
    const line = `[${time}] ${level} ${entry.source} ${entry.event}${msg}${dataStr}`;

    if (entry.level === 'error') console.error(line);
    else if (entry.level === 'warn') console.warn(line);
    else console.log(line);
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

// ---------------------------------------------------------------------------
// Pre-configured singletons
// ---------------------------------------------------------------------------

/** Server-side logger — very detailed (debug level). */
export const serverLogger = new GameLogger({ source: 'server', minLevel: 'debug' });

/** Client-side logger — clear and presentable (info level, no debug noise). */
export const clientLogger = new GameLogger({ source: 'client', minLevel: 'info' });

/** Engine logger — shared by engine internals (event-bus, state-machine). */
export const engineLogger = new GameLogger({ source: 'engine', minLevel: 'debug' });