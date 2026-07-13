import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { ActionData } from './action-registry';
/**
 * ModifierPipeline — stub for value-transformation modifiers.
 *
 * Future: chains cost reducers, flash granters, target modifiers, etc.
 * Each modifier is a pure function: ActionData → ActionData.
 * Currently returns the action unchanged (identity transform).
 */
export declare class ModifierPipeline {
    /**
     * Apply all active value modifiers to an action.
     * Stub — returns the action unchanged.
     *
     * Future: chains modifiers like:
     *   action → reduceCost → grantFlash → modifyTargets → validatedAction
     */
    static apply(action: ActionData, room: GameRoom, playerId: PlayerId): ActionData;
}
//# sourceMappingURL=modifier-pipeline.d.ts.map