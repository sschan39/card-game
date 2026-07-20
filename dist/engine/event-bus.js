"use strict";
// src/engine/event-bus.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventBus = void 0;
/**
 * EventBus — stub implementation for future trigger/replacement effect system.
 * Currently logs all events. on() is a no-op registration placeholder.
 *
 * Future: listeners will be stored and invoked when matching events are emitted,
 * enabling TriggeredAbility evaluation and ReplacementEffect interception.
 */
class EventBus {
    constructor(roomId, verbose = false) {
        this.listeners = new Map();
        this.roomId = roomId;
        this.verbose = verbose;
    }
    emit(event) {
        if (this.verbose) {
            console.log(`[EventBus:${this.roomId}] ${event.eventId} —`, JSON.stringify(event.payload));
        }
        const handlers = this.listeners.get(event.eventId);
        if (handlers) {
            for (const listener of handlers) {
                listener(event);
            }
        }
    }
    on(eventId, listener) {
        const existing = this.listeners.get(eventId);
        if (existing) {
            existing.push(listener);
        }
        else {
            this.listeners.set(eventId, [listener]);
        }
    }
    off(eventId, listener) {
        const handlers = this.listeners.get(eventId);
        if (!handlers)
            return;
        const idx = handlers.indexOf(listener);
        if (idx !== -1)
            handlers.splice(idx, 1);
    }
}
exports.EventBus = EventBus;
