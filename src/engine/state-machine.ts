// src/engine/state-machine.ts
import { EventBus } from './event-bus';
import { ManaPool } from './mana-pool';
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

export class StateMachine {
  readonly roomId: string;
  private room: GameRoom;
  private eventBus: EventBus;

  previousPhase: GameStateName | null = null;
  waitingForResponse = false;
  stackOpen = true;

  constructor(room: GameRoom, eventBus: EventBus) {
    this.roomId = room.roomId;
    this.room = room;
    this.eventBus = eventBus;
  }

  canTransition(to: GameStateName): boolean {
    if (to === 'gameOver') return true;
    if (!this.stackOpen && to === 'Stack') return false;
    return TRANSITIONS[this.room.currentPhase]?.includes(to) ?? false;
  }

  transition(to: GameStateName): void {
    if (!this.canTransition(to)) {
      console.error(`Invalid transition from ${this.room.currentPhase} to ${to}`);
      return;
    }

    if (to === 'Stack') {
      this.previousPhase = this.room.currentPhase;
    }

    // Untap step: when entering stateTurnStart, untap all of active player's permanents
    // and reset their mana pool
    if (to === 'stateTurnStart') {
      const playerId = this.room.activeTurnPlayerId;
      for (const card of this.room.battlefield) {
        if (card.state.controllerId === playerId) {
          card.state.isTapped = false;
          card.state.summoningSickness = false;
        }
      }
      const player = this.room.players[playerId];
      if (player) {
        ManaPool.drain(player.mana);
      }
    }

    this.room.currentPhase = to;
    this.eventBus.emit({
      eventId: 'PHASE_CHANGED',
      roomId: this.roomId,
      payload: { phase: this.room.currentPhase, currentPlayer: this.room.activeTurnPlayerId },
    });
  }

  switchTurn(): void {
    this.room.activeTurnPlayerId = this.room.activeTurnPlayerId === this.room.player1Id
      ? this.room.player2Id!
      : this.room.player1Id;
    this.eventBus.emit({
      eventId: 'TURN_SWITCHED',
      roomId: this.roomId,
      payload: { newPlayer: this.room.activeTurnPlayerId },
    });
  }

  isPlayerTurn(playerId: PlayerId): boolean {
    return this.room.activeTurnPlayerId === playerId;
  }

  givePriorityTo(playerId: PlayerId): void {
    this.room.priorityPlayerId = playerId;
    this.waitingForResponse = true;
    this.eventBus.emit({
      eventId: 'PRIORITY_GIVEN',
      roomId: this.roomId,
      payload: { playerId },
    });
  }

  passPriority(playerId: PlayerId): boolean {
    if (this.room.priorityPlayerId !== playerId) {
      return false;
    }

    const opponent = playerId === this.room.player1Id ? this.room.player2Id! : this.room.player1Id;

    if (this.room.lastPassedPlayerId === opponent) {
      this.resolveCurrentPhase();
    } else {
      this.room.lastPassedPlayerId = playerId;
      this.givePriorityTo(opponent);
    }

    return true;
  }

  resolveCurrentPhase(): void {
    if (this.room.currentPhase === 'Stack' && this.room.stack.length > 0) {
      this.waitingForResponse = false;
      this.room.priorityPlayerId = null;
      this.room.lastPassedPlayerId = null;
    } else {
      this.waitingForResponse = false;
      this.room.priorityPlayerId = null;
      this.room.lastPassedPlayerId = null;

      if (this.previousPhase) {
        this.transition(this.previousPhase);
        this.previousPhase = null;
      } else {
        console.warn('[StateMachine] resolveCurrentPhase: previousPhase is null — falling back to stateMainPhase');
        this.transition('stateMainPhase');
      }
    }
  }

  addToStack(stackObj: StackObject): void {
    // The handler's propose() already pushed to room.stack.
    // addToStack only handles phase transition, event emission, and priority.

    if (this.room.currentPhase !== 'Stack') {
      this.transition('Stack');
    }

    this.eventBus.emit({
      eventId: 'STACK_UPDATED',
      roomId: this.roomId,
      payload: { stack: this.room.stack, newAction: stackObj },
    });

    const opponent = stackObj.controllerId === this.room.player1Id
      ? this.room.player2Id!
      : this.room.player1Id;
    this.givePriorityTo(opponent);
  }
}