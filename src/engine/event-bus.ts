// src/engine/event-bus.ts

export interface GameEvent {
  eventId: string;
  roomId: string;
  payload: Record<string, unknown>;
}

type EventListener = (event: GameEvent) => void;

/**
 * EventBus — stub implementation for future trigger/replacement effect system.
 * Currently logs all events. on() is a no-op registration placeholder.
 *
 * Future: listeners will be stored and invoked when matching events are emitted,
 * enabling TriggeredAbility evaluation and ReplacementEffect interception.
 */
export class EventBus {
  private roomId: string;

  constructor(roomId: string) {
    this.roomId = roomId;
  }

  /**
   * Emit a game event. Currently logs to console.
   * Future: invokes all registered listeners for this eventId.
   */
  emit(event: GameEvent): void {
    console.log(`[EventBus:${this.roomId}] ${event.eventId} —`, JSON.stringify(event.payload));
  }

  /**
   * Register a listener for an event. Stub — no-op for now.
   * Future: stores listener, invokes on matching emit().
   */
  on(eventId: string, listener: EventListener): void {
    // Stub: listener registration will be implemented with the trigger system
    void eventId;
    void listener;
  }
}