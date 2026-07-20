"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModifierPipeline = void 0;
/**
 * ModifierPipeline — stub for value-transformation modifiers.
 *
 * Future: chains cost reducers, flash granters, target modifiers, etc.
 * Each modifier is a pure function: StackEffect → StackEffect.
 * Currently returns the effect unchanged (identity transform).
 */
class ModifierPipeline {
    static apply(effect, _room, _stackObj) {
        // _room and _stackObj are reserved for future modifier context
        // (cost reducers, flash granters, target modifiers, etc.)
        return effect;
    }
}
exports.ModifierPipeline = ModifierPipeline;
