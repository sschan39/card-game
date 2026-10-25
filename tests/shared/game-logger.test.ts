import { describe, expect, it, vi } from 'vitest';
import { GameLogger, type LogEntry } from '@rules/game-logger';
import { GameEngine } from '@engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { gameConfig } from '@config';

describe('extensible structured logger', () => {
  it('silences normal engine rejections through the action switch', () => {
    const original = gameConfig.logging.actions; gameConfig.logging.actions = false;
    const warn = vi.spyOn(GameLogger.prototype, 'warn'); const engine = new GameEngine(createTestRoom());
    try {
      expect(engine.executePlayerAction('player1', 'missing-action').success).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    } finally { gameConfig.logging.actions = original; warn.mockRestore(); engine.dispose(); }
  });
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
