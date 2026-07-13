"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModifierPipeline = void 0;
/**
 * ModifierPipeline — stub for value-transformation modifiers.
 *
 * Future: chains cost reducers, flash granters, target modifiers, etc.
 * Each modifier is a pure function: ActionData → ActionData.
 * Currently returns the action unchanged (identity transform).
 */
class ModifierPipeline {
    /**
     * Apply all active value modifiers to an action.
     * Stub — returns the action unchanged.
     *
     * Future: chains modifiers like:
     *   action → reduceCost → grantFlash → modifyTargets → validatedAction
     */
    static apply(action, room, playerId) {
        console.log(`[ModifierPipeline] apply: no modifiers active (stub)`);
        void room;
        void playerId;
        return action;
    }
}
exports.ModifierPipeline = ModifierPipeline;
//# sourceMappingURL=modifier-pipeline.js.map