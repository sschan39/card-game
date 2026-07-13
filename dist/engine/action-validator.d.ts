import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';
import type { ActionCondition, ActionCost, ActionRequirements } from '../types/effect.types';
/**
 * Utility class handling pure verification rules for card activations and game actions.
 * Evaluates the intersection of game state constraints, resource economies, and priority mechanics.
 */
export declare class ActionValidator {
    /**
     * Pure function to evaluate if contextual, read-only board conditions are met.
     * * Verifies game states such as checking card counts within target card zones,
     * matching specific card definitions/types, and confirming turn milestones via global indicators.
     * * @param room - The snapshot of the active game room instance.
     * @param playerId - The ID of the player whose perspective/conditions are being queried.
     * @param condition - Optional criteria parameters defining required game-state configurations.
     * * @returns `true` if all specified conditions pass or if no condition parameters are provided; otherwise, `false`.
     */
    static canMeetCondition(room: GameRoom, playerId: PlayerId, condition?: ActionCondition): boolean;
    /**
     * Evaluates if mutable player or card resources can cover an action's economic cost.
     * * Assesses independent currency brackets including mana variables, vital point depletion,
     * physical orientation changes (tapping), or required card discards.
     * * @param room - The snapshot of the active game room instance.
     * @param playerId - The ID of the player attempting to pay the cost.
     * @param card - The specific instance originating the action (crucial for checking tap-state availability).
     * @param cost - Optional resource configurations listing operational costs.
     * * @returns `true` if the player's capital fully matches or exceeds all fields inside the cost profile; otherwise, `false`.
     */
    static canPayCost(room: GameRoom, playerId: PlayerId, card: CardInstance, cost?: ActionCost): boolean;
    /**
     * The master evaluation pipeline for validating ANY unified card deployment or capability activation.
     * * This orchestrates validation sequentially across five core game systems:
     * 1. **Zone Eligibility:** Confirming if the item is nested in an allowed zone context.
     * 2. **Timing Speed Constraints:** Blocking sorcery items when stacks are active or outside main turn cycles.
     * 3. **Environmental State Requirements:** Ensuring state conditions (targets/board conditions) are viable.
     * 4. **Economic Sufficiency:** Validating that life, cards, and energy types are completely payable.
     * 5. **System Engine Priority:** Guaranteeing the invoking player actually possesses active priority rights.
     * * @param room - The snapshot of the active game room instance.
     * @param playerId - The ID of the player triggering the interface sequence.
     * @param card - The target instance attempting an interface change or action execution.
     * @param req - The unified rules object capturing allowed parameters, speeds, conditions, and costs.
     * * @returns An object containing a boolean flag `valid`, accompanied by a human-readable `reason` string on rejection.
     */
    static canActivate(room: GameRoom, playerId: PlayerId, card: CardInstance, req: ActionRequirements): {
        valid: boolean;
        reason?: string;
    };
}
//# sourceMappingURL=action-validator.d.ts.map