"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActionService = void 0;
// src/engine/action-service.ts
const action_registry_1 = require("./action-registry");
class ActionService {
    constructor(eventBus) {
        this.eventBus = eventBus;
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
    proposeAndStack(room, playerId, actionType, actionData, stateMachine) {
        const result = this.handleAction(room, playerId, actionType, actionData);
        if (!result.success)
            return result;
        // The handler's propose() already pushed to room.stack.
        // Sync the StateMachine's stack and emit STACK_UPDATED.
        if (result.stackObject) {
            stateMachine.addToStack(result.stackObject);
        }
        return result;
    }
    resolveTopOfStack(room, stateMachine) {
        if (room.stack.length === 0) {
            return { success: false, phase: 'resolve', reason: 'Stack is empty' };
        }
        const stackObj = room.stack.pop();
        // Sync StateMachine stack if provided
        if (stateMachine && stateMachine.stack.length > 0) {
            stateMachine.stack.pop();
        }
        const handler = action_registry_1.ActionRegistry['cast_spell'];
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
exports.ActionService = ActionService;
//# sourceMappingURL=action-service.js.map