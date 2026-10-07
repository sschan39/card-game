// src/engine/action-service.ts
import { ActionRegistry, type ActionData, type ActionResult } from './action-registry';
import { EventBus } from './event-bus';
import { planStackResolution } from './effect-resolver';
import { TriggerManager } from './trigger-manager';
import { engineLogger } from '../shared/game-logger';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { ResolutionEffectResult } from '../types/game-event.types';

/**
 * ActionService — single orchestrator for game actions.
 *
 * Responsibilities:
 * - Route client actions to the ActionRegistry (validate → propose)
 * - Manage stack resolution (structural zone change + effect resolution + triggers)
 * - Wire per-room TriggerManager for ETB/triggered abilities
 * - Return resolution metadata for the engine's applied event publication
 *
 * Pure with respect to GameRoom: handlers produce GameMutation[] and the
 * service returns them to the caller (GameEngine), which sequences them
 * through the pure reducer. TriggerManager pushes into the shared mutation
 * collector during event dispatch.
 *
 * GameEngine owns this service and delegates card behavior to it. Socket
 * commands enter through GameEngine.executePlayerAction.
 */
export class ActionService {
  private eventBus: EventBus;
  private mutationCollector: GameMutation[];
  private generateUuid: () => string;
  private triggerManager: TriggerManager | null = null;
  private destroyed = false;

  constructor(eventBus: EventBus, mutationCollector: GameMutation[], generateUuid: () => string) {
    this.eventBus = eventBus;
    this.mutationCollector = mutationCollector;
    this.generateUuid = generateUuid;
  }

  /**
   * Initialize per-room systems once. Repeated calls are safe; disposal is final.
   * Wires TriggerManager to the room's EventBus so ETB triggers fire.
   * Passes a getter function so TriggerManager always reads the current
   * room state (the engine reassigns `room` after each mutation).
   */
  initRoom(getRoom: () => GameRoom): void {
    if (this.triggerManager || this.destroyed) return;
    this.triggerManager = new TriggerManager(this.eventBus, this.mutationCollector, this.generateUuid, getRoom);
  }

  /**
   * Tear down per-room systems. Unregisters TriggerManager listeners from the
   * EventBus so they don't leak when the room is destroyed.
   */
  destroyRoom(): void {
    this.destroyed = true;
    if (this.triggerManager) {
      this.triggerManager.dispose(this.eventBus);
      this.triggerManager = null;
    }
    this.mutationCollector.length = 0;
  }

  handleAction(
    room: GameRoom,
    playerId: PlayerId,
    actionType: string,
    actionData: ActionData
  ): ActionResult {
    const handler = ActionRegistry[actionType];
    if (!handler) {
      // Defense-in-depth: the type system catches unknown IDs at compile time,
      // but a stale client or malformed packet can still send one at play time.
      // Log it (like a judge ruling an illegal action) instead of failing silently.
      engineLogger.warn('action:unknown', `No handler registered for action: ${actionType}`, {
        actionType,
        playerId,
      });
      return { success: false, phase: 'validate', reason: `No handler registered for action: ${actionType}` };
    }

    const validateResult = handler.validate(room, playerId, actionData);
    if (!validateResult.success) return validateResult;

    const proposeResult = handler.propose(room, playerId, actionData);
    if (!proposeResult.success) return proposeResult;

    return proposeResult;
  }

  proposeAndStack(
    room: GameRoom,
    playerId: PlayerId,
    actionType: string,
    actionData: ActionData
  ): ActionResult {
    const result = this.handleAction(room, playerId, actionType, actionData);
    if (!result.success) return result;

    // Card handlers return an atomic MOVE_CARD into the spell stack; ability
    // handlers use PUSH_STACK. Notifications/priority are handled by GameEngine.
    return result;
  }

  resolveTopOfStack(room: GameRoom): ActionResult {
    if (room.stack.length === 0) {
      return { success: false, phase: 'resolve', reason: 'Stack is empty' };
    }

    const stackObj = room.stack[room.stack.length - 1];

    // Full resolution: zone change + effects + PERMANENT_ENTERED + STACK_RESOLVED.
    // The MOVE_CARD (from 'stack') mutation removes the StackObject from the stack.
    return { success: true, ...planStackResolution(room, stackObj) };
  }
}
