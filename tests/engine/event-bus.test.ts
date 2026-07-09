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

describe('listener registration and invocation', () => {
  it('should invoke registered listener when matching event is emitted', () => {
    const bus = new EventBus('room-1');
    let received: GameEvent | null = null;
    
    bus.on('PHASE_CHANGED', (event) => {
      received = event;
    });
    
    bus.emit({
      eventId: 'PHASE_CHANGED',
      roomId: 'room-1',
      payload: { phase: 'stateMainPhase', currentPlayer: 'player1' },
    });
    
    expect(received).not.toBeNull();
    expect(received!.eventId).toBe('PHASE_CHANGED');
    expect(received!.payload.phase).toBe('stateMainPhase');
  });

  it('should invoke multiple listeners for the same event', () => {
    const bus = new EventBus('room-1');
    const calls: string[] = [];
    
    bus.on('STACK_UPDATED', () => calls.push('a'));
    bus.on('STACK_UPDATED', () => calls.push('b'));
    
    bus.emit({ eventId: 'STACK_UPDATED', roomId: 'room-1', payload: {} });
    
    expect(calls).toEqual(['a', 'b']);
  });

  it('should not invoke listeners for different event IDs', () => {
    const bus = new EventBus('room-1');
    let called = false;
    
    bus.on('PHASE_CHANGED', () => { called = true; });
    bus.emit({ eventId: 'STACK_UPDATED', roomId: 'room-1', payload: {} });
    
    expect(called).toBe(false);
  });

  it('should not throw when emitting with no registered listeners', () => {
    const bus = new EventBus('room-1');
    expect(() => bus.emit({ eventId: 'UNKNOWN', roomId: 'room-1', payload: {} })).not.toThrow();
  });
});