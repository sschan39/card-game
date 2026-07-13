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
    constructor(roomId, player1, player2, eventBus) {
        this.currentPhase = 'waiting';
        this.previousPhase = null;
        this.priorityPlayer = null;
        this.lastPlayerToPass = null;
        this.waitingForResponse = false;
        this.stackOpen = true;
        this.stack = [];
        this.roomId = roomId;
        this.player1 = player1;
        this.player2 = player2;
        this.eventBus = eventBus;
        this.currentPlayer = player1;
    }
    canTransition(to) {
        if (to === 'gameOver')
            return true;
        if (!this.stackOpen && to === 'Stack')
            return false;
        return TRANSITIONS[this.currentPhase]?.includes(to) ?? false;
    }
    transition(to) {
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
    switchTurn() {
        this.currentPlayer = this.currentPlayer === this.player1 ? this.player2 : this.player1;
        this.eventBus.emit({
            eventId: 'TURN_SWITCHED',
            roomId: this.roomId,
            payload: { newPlayer: this.currentPlayer },
        });
    }
    isPlayerTurn(playerId) {
        return this.currentPlayer === playerId;
    }
    givePriorityTo(playerId) {
        this.priorityPlayer = playerId;
        this.waitingForResponse = true;
        this.eventBus.emit({
            eventId: 'PRIORITY_GIVEN',
            roomId: this.roomId,
            payload: { playerId },
        });
    }
    passPriority(playerId) {
        if (this.priorityPlayer !== playerId) {
            return false;
        }
        const opponent = playerId === this.player1 ? this.player2 : this.player1;
        if (this.lastPlayerToPass === opponent) {
            this.resolveCurrentPhase();
        }
        else {
            this.lastPlayerToPass = playerId;
            this.givePriorityTo(opponent);
        }
        return true;
    }
    resolveCurrentPhase() {
        if (this.currentPhase === 'Stack' && this.stack.length > 0) {
            this.waitingForResponse = false;
            this.priorityPlayer = null;
            this.lastPlayerToPass = null;
        }
        else {
            this.waitingForResponse = false;
            this.priorityPlayer = null;
            this.lastPlayerToPass = null;
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
        this.stack.push(stackObj);
        if (this.currentPhase !== 'Stack') {
            this.transition('Stack');
        }
        this.eventBus.emit({
            eventId: 'STACK_UPDATED',
            roomId: this.roomId,
            payload: { stack: this.stack, newAction: stackObj },
        });
        const opponent = stackObj.controllerId === this.player1 ? this.player2 : this.player1;
        this.givePriorityTo(opponent);
    }
}
exports.StateMachine = StateMachine;
//# sourceMappingURL=state-machine.js.map