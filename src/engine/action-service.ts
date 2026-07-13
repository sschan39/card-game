// src/engine/action-service.ts
import { ActionRegistry, type ActionData, type ActionResult } from './action-registry';
import { EventBus } from './event-bus';
import { StateMachine } from './state-machine';
import { resolveEffects } from './effect-resolver';
import { TriggerManager } from './trigger-manager';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';

function isPermanent(card: CardInstance): boolean {
  return card.cardTypes.some(type =>
    ['Creature', 'Artifact', 'Enchantment', 'Land'].includes(type)
  );
}

/**
 * ActionService — single orchestrator for game actions.
 *
 * Responsibilities:
 * - Route client actions to the ActionRegistry (validate → propose)
 * - Manage stack resolution (structural zone change + effect resolution + triggers)
 * - Wire per-room TriggerManager for ETB/triggered abilities
 * - Emit events via EventBus
 *
 * This is THE orchestrator used by server.ts. GameEngine exists for
 * backward-compatible testing but delegates to the same patterns.
 */
export class ActionService {
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Initialize per-room systems. Call once when a room is created.
   * Wires TriggerManager to the room's EventBus so ETB triggers fire.
   */
  initRoom(room: GameRoom): void {
    new TriggerManager(this.eventBus, room);
  }

  handleAction(
    room: GameRoom,
    playerId: PlayerId,
    actionType: string,
    actionData: ActionData
  ): ActionResult {
    const handler = ActionRegistry[actionType];
    if (!handler) {
      return { success: false, phase: 'validate', reason: `No handler registered for action: ${actionType}` };
    }

    const validateResult = handler.validate(room, playerId, actionData);
    if (!validateResult.success) return validateResult;

    const proposeResult = handler.propose(room, playerId, actionData);
    if (!proposeResult.success) return proposeResult;

    this.eventBus.emit({
      eventId: 'ACTION_PROPOSED',
      roomId: room.roomId,
      payload: { actionType, playerId, cardUuid: actionData.cardUuid },
    });

    return proposeResult;
  }

  proposeAndStack(
    room: GameRoom,
    playerId: PlayerId,
    actionType: string,
    actionData: ActionData,
    stateMachine: StateMachine
  ): ActionResult {
    const result = this.handleAction(room, playerId, actionType, actionData);
    if (!result.success) return result;

    // The handler's propose() already pushed to room.stack.
    // Sync the StateMachine's stack and emit STACK_UPDATED.
    if (result.stackObject) {
      stateMachine.addToStack(result.stackObject);
    }

    return result;
  }

  resolveTopOfStack(room: GameRoom, stateMachine?: StateMachine): ActionResult {
    if (room.stack.length === 0) {
      return { success: false, phase: 'resolve', reason: 'Stack is empty' };
    }

    const stackObj = room.stack.pop()!;

    // Sync StateMachine stack if provided
    if (stateMachine && stateMachine.stack.length > 0) {
      stateMachine.stack.pop();
    }

    const card = stackObj.source as CardInstance;

    // ---- Structural zone change (game rule, not an effect) ----
    if (stackObj.countered) {
      card.state.zone = 'graveyard';
      const ownerId = card.state.controllerId || card.state.ownerId;
      room.players[ownerId]?.graveyard.push(card);
    } else if (isPermanent(card)) {
      card.state.zone = 'battlefield';
      card.state.isTapped = false;
      if (card.cardTypes.includes('Creature')) {
        card.state.summoningSickness = true;
      }
      room.battlefield.push(card);
    } else {
      card.state.zone = 'graveyard';
      const ownerId = card.state.controllerId || card.state.ownerId;
      room.players[ownerId]?.graveyard.push(card);
    }

    // ---- Resolve effects via shared resolver ----
    resolveEffects(room, stackObj, this.eventBus);

    // ---- Emit PERMANENT_ENTERED for permanents (triggers ETB via TriggerManager) ----
    if (!stackObj.countered && isPermanent(card)) {
      this.eventBus.emit({
        eventId: 'PERMANENT_ENTERED',
        roomId: room.roomId,
        payload: { card, controllerId: stackObj.controllerId },
      });
    }

    this.eventBus.emit({
      eventId: 'STACK_RESOLVED',
      roomId: room.roomId,
      payload: { effectId: stackObj.effects[0]?.action || 'structural' },
    });

    return { success: true };
  }
}