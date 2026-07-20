"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameEngine = void 0;
// src/engine/game-engine.ts
const event_bus_1 = require("./event-bus");
const state_machine_1 = require("./state-machine");
const action_service_1 = require("./action-service");
/**
 * GameEngine — single public API for all engine operations.
 *
 * Owns and coordinates EventBus, StateMachine, and ActionService internally.
 * server.ts talks only to GameEngine — no more juggling 3 separate engine objects.
 */
class GameEngine {
    constructor(room) {
        this.room = room;
        this.eventBus = new event_bus_1.EventBus(room.roomId);
        this.stateMachine = new state_machine_1.StateMachine(room, this.eventBus);
        this.actionService = new action_service_1.ActionService(this.eventBus);
    }
    /** Wire TriggerManager for ETB/triggered abilities. Call once after room creation. */
    initRoom() {
        this.actionService.initRoom(this.room);
    }
    // -- Action pipeline --
    handleAction(playerId, actionType, actionData) {
        return this.actionService.handleAction(this.room, playerId, actionType, actionData);
    }
    proposeAndStack(playerId, actionType, actionData) {
        const result = this.actionService.proposeAndStack(this.room, playerId, actionType, actionData);
        if (!result.success)
            return result;
        // Sync stack to StateMachine (phase transition + event + priority)
        if (result.stackObject) {
            this.stateMachine.addToStack(result.stackObject);
        }
        return result;
    }
    resolveTopOfStack() {
        return this.actionService.resolveTopOfStack(this.room);
    }
    // -- Phase / Turn delegation --
    transition(to) {
        this.stateMachine.transition(to);
    }
    switchTurn() {
        this.stateMachine.switchTurn();
    }
    isPlayerTurn(playerId) {
        return this.stateMachine.isPlayerTurn(playerId);
    }
    // -- Priority delegation --
    givePriorityTo(playerId) {
        this.stateMachine.givePriorityTo(playerId);
    }
    passPriority(playerId) {
        return this.stateMachine.passPriority(playerId);
    }
    // -- Accessors --
    get phase() {
        return this.room.currentPhase;
    }
    get activeTurnPlayerId() {
        return this.room.activeTurnPlayerId;
    }
    get priorityPlayerId() {
        return this.room.priorityPlayerId;
    }
}
exports.GameEngine = GameEngine;
