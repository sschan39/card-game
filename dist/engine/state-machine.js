"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateMachine = void 0;
const TRANSITIONS = {
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
class StateMachine {
    constructor(room, eventBus) {
        this.previousPhase = null;
        this.waitingForResponse = false;
        this.stackOpen = true;
        this.roomId = room.roomId;
        this.room = room;
        this.eventBus = eventBus;
    }
    canTransition(to) {
        if (to === 'gameOver')
            return true;
        if (!this.stackOpen && to === 'Stack')
            return false;
        return TRANSITIONS[this.room.currentPhase]?.includes(to) ?? false;
    }
    transition(to) {
        if (!this.canTransition(to)) {
            console.error(`Invalid transition from ${this.room.currentPhase} to ${to}`);
            return;
        }
        if (to === 'Stack') {
            this.previousPhase = this.room.currentPhase;
        }
        this.room.currentPhase = to;
        this.eventBus.emit({
            eventId: 'PHASE_CHANGED',
            roomId: this.roomId,
            payload: { phase: this.room.currentPhase, currentPlayer: this.room.activeTurnPlayerId },
        });
    }
    switchTurn() {
        this.room.activeTurnPlayerId = this.room.activeTurnPlayerId === this.room.player1Id
            ? this.room.player2Id
            : this.room.player1Id;
        this.eventBus.emit({
            eventId: 'TURN_SWITCHED',
            roomId: this.roomId,
            payload: { newPlayer: this.room.activeTurnPlayerId },
        });
    }
    isPlayerTurn(playerId) {
        return this.room.activeTurnPlayerId === playerId;
    }
    givePriorityTo(playerId) {
        this.room.priorityPlayerId = playerId;
        this.waitingForResponse = true;
        this.eventBus.emit({
            eventId: 'PRIORITY_GIVEN',
            roomId: this.roomId,
            payload: { playerId },
        });
    }
    passPriority(playerId) {
        if (this.room.priorityPlayerId !== playerId) {
            return false;
        }
        const opponent = playerId === this.room.player1Id ? this.room.player2Id : this.room.player1Id;
        if (this.room.lastPassedPlayerId === opponent) {
            this.resolveCurrentPhase();
        }
        else {
            this.room.lastPassedPlayerId = playerId;
            this.givePriorityTo(opponent);
        }
        return true;
    }
    resolveCurrentPhase() {
        if (this.room.currentPhase === 'Stack' && this.room.stack.length > 0) {
            this.waitingForResponse = false;
            this.room.priorityPlayerId = null;
            this.room.lastPassedPlayerId = null;
        }
        else {
            this.waitingForResponse = false;
            this.room.priorityPlayerId = null;
            this.room.lastPassedPlayerId = null;
            if (this.previousPhase) {
                this.transition(this.previousPhase);
                this.previousPhase = null;
            }
            else {
                this.transition('stateMainPhase');
            }
        }
    }
    addToStack(stackObj) {
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
            ? this.room.player2Id
            : this.room.player1Id;
        this.givePriorityTo(opponent);
    }
}
exports.StateMachine = StateMachine;
