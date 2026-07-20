"use strict";
// src/server.ts
// Express + Socket.IO server wiring all engine services together.
// The engine has zero socket knowledge — this file is the translation layer.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = exports.server = exports.app = void 0;
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const uuid_1 = require("uuid");
const path_1 = __importDefault(require("path"));
const game_engine_1 = require("./engine/game-engine");
const option_service_1 = require("./engine/option-service");
const sync_service_1 = require("./server/sync-service");
const state_store_1 = require("./server/state-store");
const room_factory_1 = require("./engine/room-factory");
// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
const app = (0, express_1.default)();
exports.app = app;
const server = http_1.default.createServer(app);
exports.server = server;
const io = new socket_io_1.Server(server, {
    cors: { origin: '*' },
});
exports.io = io;
app.use(express_1.default.static(path_1.default.join(__dirname, '..', 'public')));
// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------
const store = new state_store_1.InMemoryStore();
const syncService = new sync_service_1.SyncService(io, path_1.default.join(__dirname, '..', 'data', 'deltas.jsonl'));
// Per-room engine instances
const engines = new Map();
const optionService = new option_service_1.OptionService();
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getRoom(roomId) {
    return store.getRoom(roomId);
}
function saveRoom(room) {
    store.saveRoom(room);
}
function getOrCreateEngine(roomId) {
    if (!engines.has(roomId)) {
        const room = getRoom(roomId);
        if (!room)
            throw new Error(`Room ${roomId} not found`);
        const engine = new game_engine_1.GameEngine(room);
        engines.set(roomId, engine);
    }
    return engines.get(roomId);
}
// ---------------------------------------------------------------------------
// Socket.IO connection handling
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
    console.log(`[server] player connected: ${socket.id}`);
    // ---- Room lifecycle ----
    socket.on('createRoom', () => {
        const roomId = (0, uuid_1.v4)();
        socket.join(roomId);
        socket.roomId = roomId;
        const room = (0, room_factory_1.createRoom)(roomId, socket.id);
        saveRoom(room);
        const engine = new game_engine_1.GameEngine(room);
        engines.set(roomId, engine);
        engine.initRoom();
        console.log(`[server] room created: ${roomId} by ${socket.id}`);
        socket.emit('roomCreated', { roomId });
    });
    socket.on('joinRoom', (data) => {
        const room = getRoom(data.roomId);
        if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }
        if (room.player2Id !== null) {
            socket.emit('roomFull');
            return;
        }
        socket.join(data.roomId);
        socket.roomId = data.roomId;
        (0, room_factory_1.joinRoom)(room, socket.id);
        saveRoom(room);
        // Re-create engine with both players (room now has player2Id)
        const engine = new game_engine_1.GameEngine(room);
        engines.set(data.roomId, engine);
        console.log(`[server] ${socket.id} joined room: ${data.roomId}`);
        socket.emit('roomJoined', { roomId: data.roomId });
        io.to(data.roomId).emit('playerJoined', { playerId: socket.id });
        // Start RPS phase
        (0, room_factory_1.setupRPS)(room);
        saveRoom(room);
        engine.transition('RPS');
        io.to(data.roomId).emit('startGame', { roomId: data.roomId });
        io.to(data.roomId).emit('rpsPhase', { message: 'Choose Rock, Paper, or Scissors!' });
        // Send hands to each player
        io.to(room.player1Id).emit('updateHand', {
            roomId: data.roomId,
            hand: room.players[room.player1Id].hand,
        });
        io.to(room.player2Id).emit('updateHand', {
            roomId: data.roomId,
            hand: room.players[room.player2Id].hand,
        });
    });
    // ---- Phase / Turn ----
    socket.on('nextState', (data) => {
        const room = getRoom(data.roomId);
        const engine = engines.get(data.roomId);
        if (!room || !engine)
            return;
        const oldState = JSON.parse(JSON.stringify(room));
        engine.transition('stateTurnStart');
        saveRoom(room);
        syncService.sync(oldState, room, { action: 'nextState', playerId: socket.id });
    });
    socket.on('endTurn', (data) => {
        const room = getRoom(data.roomId);
        const engine = engines.get(data.roomId);
        if (!room || !engine)
            return;
        if (engine.phase === 'RPS') {
            socket.emit('error', { message: 'Cannot end turn during Rock Paper Scissors phase!' });
            return;
        }
        if (!engine.isPlayerTurn(socket.id)) {
            socket.emit('error', { message: 'Not your turn!' });
            return;
        }
        const oldState = JSON.parse(JSON.stringify(room));
        engine.transition('stateEndPhase');
        engine.transition('cleanupStep');
        engine.transition('stateTurnStart');
        engine.switchTurn();
        saveRoom(room);
        syncService.sync(oldState, room, { action: 'endTurn', playerId: socket.id });
    });
    // ---- Card actions ----
    socket.on('GetOptionsForCard', (data, callback) => {
        const roomId = data.roomId || socket.roomId;
        const room = getRoom(roomId);
        if (!room) {
            const empty = [];
            if (callback)
                callback(empty);
            socket.emit('OptionsForCard', { place: data.place, options: empty });
            return;
        }
        const cardUuid = data.uuid || data.card?.uuid;
        const zone = data.place;
        const options = optionService.getOptions(room, socket.id, cardUuid, zone);
        if (callback)
            callback(options);
        socket.emit('OptionsForCard', { place: zone, options });
    });
    socket.on('playCard', (data) => {
        const room = getRoom(data.roomId);
        const engine = engines.get(data.roomId);
        if (!room || !engine)
            return;
        const oldState = JSON.parse(JSON.stringify(room));
        const result = engine.proposeAndStack(socket.id, 'cast_spell', {
            cardUuid: data.cardUuid,
            targets: data.targets,
        });
        if (!result.success) {
            socket.emit('error', { message: result.reason });
            return;
        }
        saveRoom(room);
        syncService.sync(oldState, room, { action: 'playCard', playerId: socket.id });
    });
    socket.on('resolveStack', (data) => {
        const room = getRoom(data.roomId);
        const engine = engines.get(data.roomId);
        if (!room || !engine)
            return;
        const oldState = JSON.parse(JSON.stringify(room));
        const result = engine.resolveTopOfStack();
        if (!result.success) {
            socket.emit('error', { message: result.reason });
            return;
        }
        saveRoom(room);
        syncService.sync(oldState, room, { action: 'resolveStack', playerId: socket.id });
    });
    // ---- Priority ----
    socket.on('passPriority', (data) => {
        const room = getRoom(data.roomId);
        const engine = engines.get(data.roomId);
        if (!room || !engine)
            return;
        const oldState = JSON.parse(JSON.stringify(room));
        engine.passPriority(socket.id);
        saveRoom(room);
        syncService.sync(oldState, room, { action: 'passPriority', playerId: socket.id });
    });
    // ---- Disconnect ----
    socket.on('disconnect', () => {
        console.log(`[server] player disconnected: ${socket.id}`);
        // Cleanup could be added here (e.g., mark room as abandoned)
    });
});
// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
});
