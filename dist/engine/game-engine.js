"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameEngine = void 0;
// src/engine/game-engine.ts
const action_registry_1 = require("./action-registry");
const event_bus_1 = require("./event-bus");
/**
 * GameEngine — thin orchestrator for game actions.
 *
 * Responsibilities:
 * - Route client actions to the ActionRegistry
 * - Manage stack resolution (pop top, call handler.resolve)
 * - Emit events via EventBus
 *
 * Does NOT contain game rules — those live in ActionValidator, EffectRegistry, and handlers.
 */
class GameEngine {
    constructor() {
        this.eventBus = new event_bus_1.EventBus('engine');
    }
    /**
     * Handle a client action: validate → propose.
     * Resolve is called separately via resolveTopOfStack() when priority passes resolve.
     */
    handleAction(room, playerId, actionType, actionData) {
        const handler = action_registry_1.ActionRegistry[actionType];
        if (!handler) {
            return { success: false, phase: 'validate', reason: `No handler registered for action: ${actionType}` };
        }
        // Phase 1: Validate
        const validateResult = handler.validate(room, playerId, actionData);
        if (!validateResult.success)
            return validateResult;
        // Phase 2: Propose
        const proposeResult = handler.propose(room, playerId, actionData);
        if (!proposeResult.success)
            return proposeResult;
        // Emit event
        this.eventBus.emit({
            eventId: 'ACTION_PROPOSED',
            roomId: room.roomId,
            payload: { actionType, playerId, cardUuid: actionData.cardUuid },
        });
        return proposeResult;
    }
    /**
     * Resolve the top item of the stack.
     * Called by the priority system when both players pass.
     */
    resolveTopOfStack(room) {
        if (room.stack.length === 0) {
            return { success: false, phase: 'resolve', reason: 'Stack is empty' };
        }
        const stackObj = room.stack.pop();
        // Look up handler by the action type that created this stack object
        // For now, we resolve via the effect registry directly
        // Future: stack objects will carry their originating action type
        const handler = action_registry_1.ActionRegistry['cast_spell']; // Default for spell resolution
        if (!handler) {
            return { success: false, phase: 'resolve', reason: 'No handler for stack resolution' };
        }
        const result = handler.resolve(room, stackObj);
        this.eventBus.emit({
            eventId: 'STACK_RESOLVED',
            roomId: room.roomId,
            payload: { effectId: stackObj.payload.effectId },
        });
        return result;
    }
}
exports.GameEngine = GameEngine;
//# sourceMappingURL=game-engine.js.map