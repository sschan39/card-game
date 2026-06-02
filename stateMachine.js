const EffectHandler = require('./effectHandler');

class stateMachine {
    constructor(io, roomId, player1, player2) {
        this.io = io;
        this.roomId = roomId;
        this.player1 = player1;
        this.player2 = player2;
        this.currentPlayer = player1;
        this.priorityPlayer = null;
        this.previousPhase = null;
        this.waitingForResponse = false;
        this.stack = [];
        // this.passedPlayers = []; remove?
        this.state = "waiting";
        this.stackOpen = true;
        this.effectHandler = new EffectHandler(io, roomId);
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
            stateBattlePhase: [/*"declareAttackers"*/ "endCombat", "stateEndPhase", "Stack"],
            // declareAttackers: ["declareBlockers", "Stack"],
            // declareBlockers: ["combatResolve", "Stack"],
            // combatResolve: ["endCombat", "Stack"],
            endCombat: ["stateEndPhase", "Stack"],

            // End Phase
            stateEndPhase: ["cleanupStep", "Stack"],
            cleanupStep: ["stateTurnStart"],

            // Stack
            Stack: ["PreviousPhase"],
            waitingForResponse: ["Stack", "passPriority"],
            passPriority: ["PreviousPhase", "Stack"],

            gameOver: []
        };
    }
    canTransition(toState) {
        if (this.stackOpen == false && toState == "Stack") {
            console.log("Stack is closed, cannot transition to Stack.");
            return false;
        }
        if (toState === 'gameOver') {
            return true;
        }
        return this.transitions[this.state].includes(toState);
    }
    nextState() {
        const nextStates = this.transitions[this.state];
        if (nextStates && nextStates.length > 0) {
            const nextState = nextStates[0]; // Get the first available next state
            this.transition(nextState);
        } else {
            console.error(`No valid next state from ${this.state}`);
        }
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

    givePriorityTo(playerId, context = {}) {
        this.priorityPlayer = playerId;
        this.waitingForResponse = true;
        
        console.log(`Priority given to ${playerId} in context:`, context);
        
        // Notify the player with priority
        this.io.to(playerId).emit('priorityGiven', {
            state: this.state,
            context: context,
            canRespond: true
        });
            // Notify the other player they're waiting
        const opponent = playerId === this.player1 ? this.player2 : this.player1;
        this.io.to(opponent).emit('waitingForOpponent', {
            state: this.state,
            context: context
        });
    }

    passPriority(playerId) {
        if (this.priorityPlayer !== playerId) {
            console.log(`Player ${playerId} tried to pass priority but doesn't have it`);
            return false;
        }

        console.log(`Player ${playerId} passed priority`);
        
        // Switch priority to opponent
        const opponent = playerId === this.player1 ? this.player2 : this.player1;
        
        // If both players pass in sequence, resolve the current phase
        if (this.lastPlayerToPass === opponent) {
            this.resolveCurrentPhase();
        } else {
            this.lastPlayerToPass = playerId;
            this.givePriorityTo(opponent, { action: 'passed' });
        }
        
        return true;
    }

    resolveCurrentPhase() {
        console.log('Both players passed priority, resolving current phase');
        
        if (this.state === 'Stack' && this.stack.length > 0) {
            // Resolve the stack
            this.resolveStack();
        } else {
            // No stack to resolve, just continue with game flow
            this.waitingForResponse = false;
            this.priorityPlayer = null;
            this.lastPlayerToPass = null;
            
            // Return to previous phase or continue normal flow
            if (this.previousPhase) {
                this.transition(this.previousPhase);
            } else {
                // Default to main phase if no previous phase
                this.transition('stateMainPhase');
            }
        }
    }

    addToStack(action, playerId, speed = null) {
        console.log(`Adding action to stack:`, action, `by ${playerId}`, speed);

        // Validate action structure
        if (!action.type || !action.effects) {
            console.error('Invalid action structure - missing type or effects');
            return false;
        }

        

        // Create stack entry with unique ID
        const stackEntry = {
            id: `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: action.type,
            sourceCard: action.sourceCard || null,
            effects: action.effects,
            targets: action.targets || [],
            playerId: playerId,
            timestamp: Date.now()
        };

        this.stack.push(stackEntry);
        
        // Transition to Stack state if not already there
        if (this.state !== 'Stack') {
            this.transition('Stack');
        }
        
        // Notify all players about stack update
        this.io.to(this.roomId).emit('stackUpdated', {
            stack: this.stack,
            newAction: stackEntry
        });
        
        // Give opponent priority to respond
        const opponent = playerId === this.player1 ? this.player2 : this.player1;
        this.givePriorityTo(opponent, {
            action: 'respond_to_stack',
            stackSize: this.stack.length,
            topAction: stackEntry
        });
        
        return true;
    }

    resolveStack() {
        if (this.stack.length === 0) {
            console.log('Stack is empty, returning to previous phase');
            this.waitingForResponse = false;
            this.priorityPlayer = null;
            this.transition(this.previousPhase || 'stateMainPhase');
            return;
        }

        console.log(`Resolving stack with ${this.stack.length} actions`);
        
        // Resolve in LIFO order (last in, first out)
        while (this.stack.length > 0) {
            const action = this.stack.pop();
            console.log(`Resolving action:`, action);
            this.executeAction(action);
        }

        // Clear waiting state and return to previous phase
        this.waitingForResponse = false;
        this.priorityPlayer = null;
        this.transition(this.previousPhase || 'stateMainPhase');
    }

    executeAction(action) {
        // Delegate to the effect handler
        this.effectHandler.executeAction(action, this);
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