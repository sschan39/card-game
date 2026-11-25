// src/engine/event-bus.ts

import { engineLogger } from '../shared/game-logger';
import { engineDiagnostics } from '../shared/diagnostic-settings';
import type { GameRoom } from '../types/game.room.types';
import type { GameEvent } from '../types/game-event.types';
import type { CommandContext } from '../types/game-event.types';

export type { GameEvent } from '../types/game-event.types';

export interface EventContext { before: GameRoom; after: GameRoom; command?: CommandContext }
type EventListener<K extends string = string> = (event: GameEvent<K>, context?: EventContext) => void;

/**
 * Synchronous event dispatch. The engine publishes committed events with batch context.
 */
export class EventBus {
  private roomId: string;
  private listeners: Map<string, EventListener[]> = new Map();
  private verbose: boolean;

  constructor(roomId: string, verbose = false) {
    this.roomId = roomId;
    this.verbose = verbose;
  }

  /** Publish an event to every listener registered for its id. */
  emit(event: GameEvent, context?: EventContext): void {
    // Optional tracing: log the event with the batch/command context attached.
    if (this.verbose || engineDiagnostics.logging.appliedEvents) {
      engineLogger
        .withContext({
          roomId: this.roomId,
          ...context?.command,
          commandId: event.commandId,
          batchId: event.batchId,
          eventUuid: event.eventUuid,
        })
        .debug('event:emitted', event.eventId, { eventId: event.eventId, payload: event.payload });
    }

    const handlers = this.listeners.get(event.eventId);

    // Dispatch to every listener registered for this event id, if any.
    if (handlers) {
      for (const listener of handlers) {
        listener(event, context);
      }
    }
  }

  /** Subscribe to an event id. */
  on<K extends string>(eventId: K, listener: EventListener<K>): void {
    const existing = this.listeners.get(eventId);

    // First listener for this id creates the bucket; later ones append.
    if (existing) {
      existing.push(listener as EventListener);
    } else {
      this.listeners.set(eventId, [listener as EventListener]);
    }
  }

  /** Unsubscribe a previously registered listener. */
  off<K extends string>(eventId: K, listener: EventListener<K>): void {
    const handlers = this.listeners.get(eventId);

    // Guard: nothing registered for this id.
    if (!handlers) return;

    const idx = handlers.indexOf(listener as EventListener);
    if (idx !== -1) handlers.splice(idx, 1);
  }
}
