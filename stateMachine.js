class stateMachine {
    constructor(io, roomId, player1, player2) {
        this.io = io;
        this.roomId = roomId;
        this.player1 = player1;
        this.player2 = player2;
        this.currentPlayer = player1;
        this.previousPhase = null;
        this.stack = [];
        this.passedPlayers = [];
        this.state = "waiting";
        this.open = true;
        this.transitions = {
            waiting: ["RPS"],
            RPS: ["stateTurnStart", "RPS"],

            // Beginning Phase
            stateTurnStart: ["stateTurnPrepare", "Stack"],
            stateTurnPrepare: ["stateDrawPhase", "Stack"],
            stateDrawPhase: ["stateMainPhase", "Stack"],

            // Main Phase 1
            stateMainPhase: ["stateBattlePhase", "stateEndPhase", "Stack"],

            // Main Phase 2
            // stateMainPhase2: ["stateBattlePhase", "Stack"],

            // Battle Phase
            stateBattlePhase: ["declareAttackers", "stateEndPhase", "Stack"],
            declareAttackers: ["declareBlockers", "Stack"],
            declareBlockers: ["combatResolve", "Stack"],
            combatResolve: ["endCombat", "Stack"],
            endCombat: ["stateEndPhase", "Stack"],

            // End Phase
            stateEndPhase: ["cleanupStep", "Stack"],
            cleanupStep: ["stateTurnStart"],

            // Stack
            Stack: ["PreviousPhase"],

            gameOver: []
        };
    }
    canTransition(toState) {
        if (this.open == false && toState == "Stack") {
            console.log("Stack is closed, cannot transition to Stack.");
            return false;
        }
        if (toState === 'gameOver') {
            return true;
        }
        return this.transitions[this.state].includes(toState);
    }
    transition(toState) {
        if (this.canTransition(toState)) {
            if (toState === 'Stack') {
                this.previousPhase = this.state;
            }
            this.state = toState;
            console.log(`Transitioning from ${this.state} to ${toState}`);
            this.io.to(this.roomId).emit('stateChanged', {
                state: this.state,
                currentPlayer: this.currentPlayer,
            });
        } else {
            console.error(`Invalid transition from ${this.state} to ${toState}`);
        }
    }


    isPlayerTurn(playerId) {
        return this.currentPlayer === playerId;
    }
    switchTurn() {
        this.currentPlayer = this.currentPlayer === this.player1 ? this.player2 : this.player1;
        console.log(`It's now ${this.currentPlayer}'s turn.`);
        this.io.to(this.currentPlayer).emit('yourTurn');
        const opponent = this.currentPlayer === this.player1 ? this.player2 : this.player1;
        this.io.to(opponent).emit('opponentTurn');
    }
}

module.exports = stateMachine;

// class GameStateMachine {
//     constructor(roomId) {
//         this.roomId = roomId;
//         this.state = 'waitingForPlayers'; // Initial state
//         this.currentPlayer = null; // Tracks the current player's turn
//         this.stack = [];
//         this.transitions = {
//             waitingForPlayers: ['RPS'],
//             RPS: ['stateTurnStart', 'RPS'],
//             stateTurnStart: ['stateTurnPrepare'],
//             stateTurnPrepare: ['stateDrawPhase'],
//             stateDrawPhase: ['stateMainPhase'],
//             stateMainPhase: ['stateBattlePhase', 'speedReponse'],
//             stateBattlePhase: ['stateEndPhase', 'speedReponse'],
//             speedReponse: ['stateBattlePhase', 'statemainPhase'],
//             stateEndPhase: ['stateTurnStart'],
//             gameOver: []
//         };
//     }

//     resolveStack() {
//         if (this.stack.length === 0) {
//             console.log('Stack is empty, nothing to resolve.');
//             return;
//         }
//         if (!this.state === 'speedReponse') {
//             console.log('Not in speed response state, cannot resolve stack.');
//             return;
//         }
//         while (this.stack.length > 0) {
//             const action = this.stack.pop();
//             // Process the action here
//             console.log(`Resolving action: ${action}`);
//         }
//     }

//     canTransition(toState) {
//         if (toState === 'gameOver') {
//             return true;
//         }
//         return this.transitions[this.state].includes(toState);
//     }

//     transition(toState) {
//         if (this.canTransition(toState)) {
//             // Handle player turn logic during transitions
//             if (this.state === 'stateEndPhase' && toState === 'stateTurnStart') {
//                 this.switchTurn();
//             }   
//             console.log(`Transitioning from ${this.state} to ${toState}`);
//             this.state = toState;
//             getElementById('game-state').textContent = `Current State: ${this.state}`;
//         } else {
//             console.error(`Invalid transition from ${this.state} to ${toState}`);
//         }
//     }

//     switchTurn() {
//         const room = rooms[this.roomId];
//         if (!room) {
//             console.error(`Room not found: ${this.roomId}`);
//             return;
//         }

//         // Toggle the current player
//         if (this.currentPlayer === room.player1) {
//             this.currentPlayer = room.player2;
//         } else {
//             this.currentPlayer = room.player1;
//         }

//         console.log(`It's now ${this.currentPlayer}'s turn.`);
//         io.to(this.currentPlayer).emit('yourTurn');
//         const opponent = this.currentPlayer === room.player1 ? room.player2 : room.player1;
//         io.to(opponent).emit('opponentTurn');
//     }

//     isPlayerTurn(playerId) {
//         return this.currentPlayer === playerId;
//     }
// }