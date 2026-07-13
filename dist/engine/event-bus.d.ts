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
export declare class EventBus {
    private roomId;
    private listeners;
    constructor(roomId: string);
    emit(event: GameEvent): void;
    on(eventId: string, listener: EventListener): void;
}
export {};
//# sourceMappingURL=event-bus.d.ts.map