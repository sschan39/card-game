import { describe, expect, it } from 'vitest';
import { GameLogger, type LogEntry } from '../../src/shared/game-logger';

describe('extensible structured logger', () => {
  it('sends arbitrary new event names and inherited context to an injected sink', () => {
    const entries: LogEntry[] = [];
    const logger = new GameLogger({ source: 'engine', sinks: [entry => entries.push(entry)] });
    const child = logger.withContext({ roomId: 'room', commandId: 'command' }).withContext({ batchId: 'batch' });
    child.info('new-addon:event', 'Custom event', { custom: 42 });
    logger.info('other:event');
    expect(entries[0]).toMatchObject({ source: 'engine', event: 'new-addon:event', context: { roomId: 'room', commandId: 'command', batchId: 'batch' }, data: { custom: 42 } });
    expect(entries[1].context).toEqual({});
  });

  it('retains level filtering with multiple sinks', () => {
    const entries: LogEntry[] = [];
    const copied: LogEntry[] = [];
    const logger = new GameLogger({ minLevel: 'warn', sinks: [entry => entries.push(entry), entry => copied.push(entry)] });
    logger.withContext({ roomId: 'room' }).info('ignored');
    logger.warn('visible');
    expect(entries.map(entry => entry.event)).toEqual(['visible']);
    expect(copied).toEqual(entries);
  });
});
