// src/engine/action-registry.ts
import type { ActionType, StackObject, TargetPointer } from '../types/effect.types';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { CardInstance } from '../types/card.types';

// ============================================================================
// 1. Action Data & Results
// ============================================================================

/**
 * Flexible payload for any client action.
 * cardUuid is the primary card being acted upon (optional — not all actions target a card).
 * targets are optional chosen targets.
 * Additional properties are passed through for handler-specific needs.
 */
export interface ActionData {
  cardUuid?: string;
  targets?: TargetPointer[];
  [key: string]: unknown;
}

export type ActionResult =
  | { success: true; stackObject?: StackObject; mutations?: GameMutation[]; attackingCard?: CardInstance }
  | { success: false; phase: 'validate' | 'propose' | 'resolve'; reason: string };

// ============================================================================
// 2. Action Handler Interface
// ============================================================================

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

// ============================================================================
// 3. Registry
// ============================================================================

export const ActionRegistry: Record<ActionType, ActionHandler> = {};

export function registerAction(type: ActionType, handler: ActionHandler): void {
  ActionRegistry[type] = handler;
}