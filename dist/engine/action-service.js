"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActionService = void 0;
// src/engine/action-service.ts
const action_registry_1 = require("./action-registry");
const effect_resolver_1 = require("./effect-resolver");
const trigger_manager_1 = require("./trigger-manager");
/**
 * ActionService — single orchestrator for game actions.
 *
 * Responsibilities:
 * - Route client actions to the ActionRegistry (validate → propose)
 * - Manage stack resolution (structural zone change + effect resolution + triggers)
 * - Wire per-room TriggerManager for ETB/triggered abilities
 * - Emit events via EventBus
 *
 * This is THE orchestrator used by server.ts. GameEngine exists for
 * backward-compatible testing but delegates to the same patterns.
 */
class ActionService {
    constructor(eventBus) {
        this.eventBus = eventBus;
    }
    /**
     * Initialize per-room systems. Call once when a room is created.
     * Wires TriggerManager to the room's EventBus so ETB triggers fire.
     */
    initRoom(room) {
        new trigger_manager_1.TriggerManager(this.eventBus, room);
    }
    handleAction(room, playerId, actionType, actionData) {
        const handler = action_registry_1.ActionRegistry[actionType];
        if (!handler) {
            return { success: false, phase: 'validate', reason: `No handler registered for action: ${actionType}` };
        }
        const validateResult = handler.validate(room, playerId, actionData);
        if (!validateResult.success)
            return validateResult;
        const proposeResult = handler.propose(room, playerId, actionData);
        if (!proposeResult.success)
            return proposeResult;
        this.eventBus.emit({
            eventId: 'ACTION_PROPOSED',
            roomId: room.roomId,
            payload: { actionType, playerId, cardUuid: actionData.cardUuid },
        });
        return proposeResult;
    }
    proposeAndStack(room, playerId, actionType, actionData) {
        const result = this.handleAction(room, playerId, actionType, actionData);
        if (!result.success)
            return result;
        // The handler's propose() already pushed to room.stack.
        // Stack sync (addToStack) is now handled by the caller (GameEngine).
        return result;
    }
    resolveTopOfStack(room) {
        if (room.stack.length === 0) {
            return { success: false, phase: 'resolve', reason: 'Stack is empty' };
        }
        const stackObj = room.stack.pop();
        // Full resolution: zone change + effects + PERMANENT_ENTERED + STACK_RESOLVED
        (0, effect_resolver_1.resolveStackObject)(room, stackObj, this.eventBus);
        return { success: true };
    }
}
exports.ActionService = ActionService;
