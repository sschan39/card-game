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
  private listeners: Map<string, EventListener[]> = new Map();

  constructor(roomId: string) {
    this.roomId = roomId;
  }

  emit(event: GameEvent): void {
    console.log(`[EventBus:${this.roomId}] ${event.eventId} —`, JSON.stringify(event.payload));
    const handlers = this.listeners.get(event.eventId);
    if (handlers) {
      for (const listener of handlers) {
        listener(event);
      }
    }
  }

  on(eventId: string, listener: EventListener): void {
    const existing = this.listeners.get(eventId);
    if (existing) {
      existing.push(listener);
    } else {
      this.listeners.set(eventId, [listener]);
    }
  }
}