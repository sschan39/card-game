// src/engine/game-engine.ts
import { EventBus } from './event-bus';
import { StateMachine } from './state-machine';
import { ActionService } from './action-service';
import { ActionRegistry, type ActionData, type ActionResult } from './action-registry';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { GameStateName } from '../types/game.state.types';

/**
 * GameEngine — single public API for all engine operations.
 *
 * Owns and coordinates EventBus, StateMachine, and ActionService internally.
 * server.ts talks only to GameEngine — no more juggling 3 separate engine objects.
 */
export class GameEngine {
  private eventBus: EventBus;
  private stateMachine: StateMachine;
  private actionService: ActionService;
  private room: GameRoom;

  constructor(room: GameRoom) {
    this.room = room;
    this.eventBus = new EventBus(room.roomId);
    this.stateMachine = new StateMachine(room, this.eventBus);
    this.actionService = new ActionService(this.eventBus);
  }

  /** Wire TriggerManager for ETB/triggered abilities. Call once after room creation. */
  initRoom(): void {
    this.actionService.initRoom(this.room);
  }

  // -- Action pipeline --

  handleAction(playerId: PlayerId, actionType: string, actionData: ActionData): ActionResult {
    return this.actionService.handleAction(this.room, playerId, actionType, actionData);
  }

  proposeAndStack(playerId: PlayerId, actionType: string, actionData: ActionData): ActionResult {
    const result = this.actionService.proposeAndStack(this.room, playerId, actionType, actionData);
    if (!result.success) return result;

    // Sync stack to StateMachine (phase transition + event + priority)
    if (result.stackObject) {
      this.stateMachine.addToStack(result.stackObject);
    }

    return result;
  }

  resolveTopOfStack(): ActionResult {
    return this.actionService.resolveTopOfStack(this.room);
  }

  // -- Phase / Turn delegation --

  transition(to: GameStateName): void {
    this.stateMachine.transition(to);
  }

  switchTurn(): void {
    this.stateMachine.switchTurn();
  }

  isPlayerTurn(playerId: PlayerId): boolean {
    return this.stateMachine.isPlayerTurn(playerId);
  }

  // -- Priority delegation --

  givePriorityTo(playerId: PlayerId): void {
    this.stateMachine.givePriorityTo(playerId);
  }

  passPriority(playerId: PlayerId): boolean {
    return this.stateMachine.passPriority(playerId);
  }

  // -- Accessors --

  get phase(): GameStateName {
    return this.room.currentPhase;
  }

  get activeTurnPlayerId(): PlayerId {
    return this.room.activeTurnPlayerId;
  }

  get priorityPlayerId(): PlayerId | null {
    return this.room.priorityPlayerId;
  }
}