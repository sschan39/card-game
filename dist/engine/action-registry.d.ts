import type { ActionType, StackObject, TargetPointer } from '../types/effect.types';
import type { GameRoom, PlayerId } from '../types/game.room.types';
/**
 * Flexible payload for any client action.
 * cardUuid is the primary card being acted upon.
 * targets are optional chosen targets.
 * Additional properties are passed through for handler-specific needs.
 */
export interface ActionData {
    cardUuid: string;
    targets?: TargetPointer[];
    [key: string]: unknown;
}
export type ActionResult = {
    success: true;
    stackObject?: StackObject;
} | {
    success: false;
    phase: 'validate' | 'propose' | 'resolve';
    reason: string;
};
/**
 * 3-phase lifecycle for any game action:
 * 1. validate — permission checks + value transforms + standard validation
 * 2. propose  — pay costs, create StackObject, push to stack
 * 3. resolve  — apply effects via EffectRegistry
 */
export interface ActionHandler {
    validate(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult;
    propose(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult;
    resolve(room: GameRoom, stackObj: StackObject): ActionResult;
}
export declare const ActionRegistry: Record<ActionType, ActionHandler>;
export declare function registerAction(type: ActionType, handler: ActionHandler): void;
//# sourceMappingURL=action-registry.d.ts.map