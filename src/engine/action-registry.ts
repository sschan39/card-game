// src/engine/action-registry.ts
import type { ActionType, StackObject, TargetPointer } from '../types/effect.types';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { ResolutionReport } from '../types/game-event.types';
import type { PendingChoice } from '../types/choice.types';

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
  | { success: true; stackObject?: StackObject; mutations?: GameMutation[]; resolution?: ResolutionReport; pendingChoice?: PendingChoice }
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
  /**
   * Optional — the engine resolves stack objects via resolveStackObject() in
   * effect-resolver.ts, not through this method. Combat declarations have no
   * resolve(): they record participants; the turn-based damage procedure runs later.
   */
  resolve?(room: GameRoom, stackObj: StackObject): ActionResult;
}

// ============================================================================
// 3. Registry
// ============================================================================

export type ActionHandlerMap = Readonly<Record<ActionType, ActionHandler>>;

export class ActionRegistry {
  private readonly handlers: ReadonlyMap<ActionType, ActionHandler>;

  constructor(handlers: ActionHandlerMap = {}) {
    this.handlers = new Map(Object.entries(handlers));
  }

  get(type: ActionType): ActionHandler | undefined {
    return this.handlers.get(type);
  }

  has(type: ActionType): boolean {
    return this.handlers.has(type);
  }

  with(type: ActionType, handler: ActionHandler): ActionRegistry {
    return new ActionRegistry(Object.fromEntries([...this.handlers, [type, handler]]));
  }
}
