import { describe, it, expect, vi } from 'vitest';
import { EventBus, type GameEvent } from '../../src/engine/event-bus';

describe('EventBus', () => {
  it('should create an EventBus instance', () => {
    const bus = new EventBus('test-room');
    expect(bus).toBeDefined();
  });

  it('should accept on() registration without error (stub)', () => {
    const bus = new EventBus('test-room');
    const listener = (_e: GameEvent) => {};
    expect(() => bus.on('SPELL_CAST', listener)).not.toThrow();
  });

  it('should emit events without error (stub)', () => {
    const bus = new EventBus('test-room');
    const event: GameEvent = {
      eventId: 'SPELL_CAST',
      roomId: 'test-room',
      payload: { cardId: 'empire-servant' },
    };
    expect(() => bus.emit(event)).not.toThrow();
  });

  it('should log emitted events to console', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const bus = new EventBus('test-room');
    const event: GameEvent = {
      eventId: 'CREATURE_ENTERS_BATTLEFIELD',
      roomId: 'test-room',
      payload: { cardId: 'empire-servant' },
    };
    bus.emit(event);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('CREATURE_ENTERS_BATTLEFIELD'),
      expect.stringContaining('empire-servant')
    );
    spy.mockRestore();
  });
});