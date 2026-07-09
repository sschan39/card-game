// src/engine/state-machine.ts
import { EventBus } from './event-bus';
import type { GameStateName, GameTransitionMap } from '../types/game.state.types';
import type { PlayerId } from '../types/game.room.types';
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

export class StateMachine {
  readonly roomId: string;
  private player1: PlayerId;
  private player2: PlayerId;
  private eventBus: EventBus;

  currentPhase: GameStateName = 'waiting';
  previousPhase: GameStateName | null = null;
  currentPlayer: PlayerId;
  priorityPlayer: PlayerId | null = null;
  lastPlayerToPass: PlayerId | null = null;
  waitingForResponse = false;
  stackOpen = true;
  stack: StackObject[] = [];

  constructor(roomId: string, player1: PlayerId, player2: PlayerId, eventBus: EventBus) {
    this.roomId = roomId;
    this.player1 = player1;
    this.player2 = player2;
    this.eventBus = eventBus;
    this.currentPlayer = player1;
  }

  canTransition(to: GameStateName): boolean {
    if (to === 'gameOver') return true;
    if (!this.stackOpen && to === 'Stack') return false;
    return TRANSITIONS[this.currentPhase]?.includes(to) ?? false;
  }

  transition(to: GameStateName): void {
    if (!this.canTransition(to)) {
      console.error(`Invalid transition from ${this.currentPhase} to ${to}`);
      return;
    }

    if (to === 'Stack') {
      this.previousPhase = this.currentPhase;
    }

    this.currentPhase = to;
    this.eventBus.emit({
      eventId: 'PHASE_CHANGED',
      roomId: this.roomId,
      payload: { phase: this.currentPhase, currentPlayer: this.currentPlayer },
    });
  }

  switchTurn(): void {
    this.currentPlayer = this.currentPlayer === this.player1 ? this.player2 : this.player1;
    this.eventBus.emit({
      eventId: 'TURN_SWITCHED',
      roomId: this.roomId,
      payload: { newPlayer: this.currentPlayer },
    });
  }

  isPlayerTurn(playerId: PlayerId): boolean {
    return this.currentPlayer === playerId;
  }
}