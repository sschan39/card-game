import { type ActionData, type ActionResult } from './action-registry';
import type { GameRoom, PlayerId } from '../types/game.room.types';
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
export declare class GameEngine {
    private eventBus;
    constructor();
    /**
     * Handle a client action: validate → propose.
     * Resolve is called separately via resolveTopOfStack() when priority passes resolve.
     */
    handleAction(room: GameRoom, playerId: PlayerId, actionType: string, actionData: ActionData): ActionResult;
    /**
     * Resolve the top item of the stack.
     * Called by the priority system when both players pass.
     */
    resolveTopOfStack(room: GameRoom): ActionResult;
}
//# sourceMappingURL=game-engine.d.ts.map