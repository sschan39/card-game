// src/engine/state-machine.ts
import { EventBus } from './event-bus';
import { engineLogger } from '../shared/game-logger';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameStateName, GameTransitionMap } from '../types/game.state.types';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { StackObject } from '../types/effect.types';

const TRANSITIONS: GameTransitionMap = {
  waiting: ['RPS'],
  RPS: ['stateTurnStart', 'RPS', 'Stack'],
  stateTurnStart: ['stateDrawPhase', 'Stack'],
  stateDrawPhase: ['stateMainPhase', 'Stack'],
  stateMainPhase: ['stateBattlePhase', 'stateEndPhase', 'Stack'],
  stateBattlePhase: ['endCombat', 'stateEndPhase', 'Stack'],
  endCombat: ['stateEndPhase', 'Stack'],
  stateEndPhase: ['cleanupStep', 'Stack'],
  cleanupStep: ['stateTurnStart'],
  Stack: [],
  gameOver: [],
};

/**
 * StateMachine — phase/turn/priority transitions.
 *
 * Pure with respect to GameRoom: every method receives the current room
 * snapshot and returns GameMutation[] to apply. The engine (GameEngine)
 * sequences those mutations through the pure reducer.
 *
 * Engine-local control flags (waitingForResponse, stackOpen) stay on the
 * instance — they are never serialized or sent to the client.
 */
export class StateMachine {
  readonly roomId: string;
  private eventBus: EventBus;

  waitingForResponse = false;
  stackOpen = true;

  constructor(room: GameRoom, eventBus: EventBus) {
    this.roomId = room.roomId;
    this.eventBus = eventBus;
  }

  canTransition(room: GameRoom, to: GameStateName): boolean {
    if (to === 'gameOver') return true;
    if (!this.stackOpen && to === 'Stack') return false;
    return TRANSITIONS[room.currentPhase]?.includes(to) ?? false;
  }

  /**
   * Transition to a new phase. Returns mutations to apply.
   * previousPhase is stored in GameRoom (observable), not on StateMachine.
   */
  transition(room: GameRoom, to: GameStateName): GameMutation[] {
    if (!this.canTransition(room, to)) {
      engineLogger.error('transition:invalid', `Invalid transition from ${room.currentPhase} to ${to}`, { from: room.currentPhase, to });
      return [];
    }

    const mutations: GameMutation[] = [];

    if (to === 'Stack') {
      mutations.push({ type: 'SET_PREVIOUS_PHASE', phase: room.currentPhase });
    }

    // Untap step: when entering stateTurnStart, untap all of active player's permanents
    // and reset their mana pool
    if (to === 'stateTurnStart') {
      const playerId = room.activeTurnPlayerId;
      for (const card of room.battlefield) {
        if (card.state.controllerId === playerId) {
          mutations.push({ type: 'UNTAP_CARD', cardUuid: card.uuid });
          mutations.push({ type: 'SET_SUMMONING_SICKNESS', cardUuid: card.uuid, value: false });
        }
      }
      const player = room.players[playerId];
      if (player) {
        // Drain mana: set all colors to 0
        for (const color of Object.keys(player.mana) as Array<keyof typeof player.mana>) {
          mutations.push({ type: 'SET_MANA', playerId, color, amount: 0 });
        }
      }

      this.eventBus.emit({
        eventId: 'TURN_STARTED',
        roomId: this.roomId,
        payload: { currentPlayer: room.activeTurnPlayerId },
      });
    }

    // Cleanup step: strip END_OF_TURN entries from the continuous effect pool
    if (to === 'cleanupStep') {
      mutations.push({ type: 'CLEAR_END_OF_TURN_EFFECTS' });
    }

    mutations.push({ type: 'SET_PHASE', phase: to });

    this.eventBus.emit({
      eventId: 'PHASE_CHANGED',
      roomId: this.roomId,
      payload: { phase: to, currentPlayer: room.activeTurnPlayerId },
    });

    return mutations;
  }

  switchTurn(room: GameRoom): GameMutation[] {
    const newPlayer = room.activeTurnPlayerId === room.player1Id
      ? room.player2Id!
      : room.player1Id;

    this.eventBus.emit({
      eventId: 'TURN_SWITCHED',
      roomId: this.roomId,
      payload: { newPlayer },
    });

    return [{ type: 'SET_TURN', playerId: newPlayer }];
  }

  isPlayerTurn(room: GameRoom, playerId: PlayerId): boolean {
    return room.activeTurnPlayerId === playerId;
  }

  givePriorityTo(playerId: PlayerId): GameMutation[] {
    this.waitingForResponse = true;
    this.eventBus.emit({
      eventId: 'PRIORITY_GIVEN',
      roomId: this.roomId,
      payload: { playerId },
    });
    return [{ type: 'SET_PRIORITY', playerId }];
  }

  passPriority(room: GameRoom, playerId: PlayerId): { success: boolean; mutations: GameMutation[] } {
    if (room.priorityPlayerId !== playerId) {
      return { success: false, mutations: [] };
    }

    const opponent = playerId === room.player1Id ? room.player2Id! : room.player1Id;

    if (room.lastPassedPlayerId === opponent) {
      return { success: true, mutations: this.resolveCurrentPhase(room) };
    } else {
      return {
        success: true,
        mutations: [
          { type: 'SET_LAST_PASSED', playerId },
          ...this.givePriorityTo(opponent),
        ],
      };
    }
  }

  resolveCurrentPhase(room: GameRoom): GameMutation[] {
    if (room.currentPhase === 'Stack' && room.stack.length > 0) {
      this.waitingForResponse = false;
      return [
        { type: 'SET_PRIORITY', playerId: null },
        { type: 'SET_LAST_PASSED', playerId: null },
      ];
    }

    this.waitingForResponse = false;
    const mutations: GameMutation[] = [
      { type: 'SET_PRIORITY', playerId: null },
      { type: 'SET_LAST_PASSED', playerId: null },
    ];

    const prevPhase = room.previousPhase;
    if (prevPhase) {
      mutations.push(...this.transition(room, prevPhase));
      mutations.push({ type: 'SET_PREVIOUS_PHASE', phase: null });
    } else {
      engineLogger.warn('transition:no-previous-phase', 'resolveCurrentPhase: previousPhase is null — falling back to stateMainPhase');
      mutations.push(...this.transition(room, 'stateMainPhase'));
    }

    return mutations;
  }

  /**
   * Handle stack addition: phase transition, event emission, and priority.
   * Returns mutations for the phase change + priority assignment.
   * The handler's propose() already pushed to room.stack via PUSH_STACK mutation.
   */
  addToStack(room: GameRoom, stackObj: StackObject): GameMutation[] {
    const mutations: GameMutation[] = [];

    if (room.currentPhase !== 'Stack') {
      mutations.push(...this.transition(room, 'Stack'));
    }

    this.eventBus.emit({
      eventId: 'STACK_UPDATED',
      roomId: this.roomId,
      payload: { stack: room.stack, newAction: stackObj },
    });

    const opponent = stackObj.controllerId === room.player1Id
      ? room.player2Id!
      : room.player1Id;
    mutations.push(...this.givePriorityTo(opponent));

    return mutations;
  }
}