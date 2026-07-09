// src/server.ts
// Express + Socket.IO server wiring all engine services together.
// The engine has zero socket knowledge — this file is the translation layer.

import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

import { EventBus } from './engine/event-bus';
import { StateMachine } from './engine/state-machine';
import { ActionService } from './engine/action-service';
import { OptionService } from './engine/option-service';
import { SyncService } from './server/sync-service';
import { InMemoryStore } from './server/state-store';
import { roomFactory } from './engine/room-factory';
import type { GameRoom, PlayerId } from './types/game.room.types';
import type { StateStore } from './server/state-store';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' },
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

const store: StateStore = new InMemoryStore();
const syncService = new SyncService(io, path.join(__dirname, '..', 'data', 'deltas.jsonl'));

// Per-room engine instances
const eventBuses = new Map<string, EventBus>();
const stateMachines = new Map<string, StateMachine>();
const actionServices = new Map<string, ActionService>();
const optionService = new OptionService();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRoom(roomId: string): GameRoom | undefined {
  return store.getRoom(roomId);
}

function saveRoom(room: GameRoom): void {
  store.saveRoom(room);
}

function getOrCreateEngine(roomId: string, player1Id: PlayerId, player2Id: PlayerId | null) {
  if (!eventBuses.has(roomId)) {
    const eb = new EventBus(roomId);
    const sm = new StateMachine(roomId, player1Id, player2Id ?? '', eb);
    const as = new ActionService(eb);
    eventBuses.set(roomId, eb);
    stateMachines.set(roomId, sm);
    actionServices.set(roomId, as);
  }
  return {
    eventBus: eventBuses.get(roomId)!,
    stateMachine: stateMachines.get(roomId)!,
    actionService: actionServices.get(roomId)!,
  };
}

// ---------------------------------------------------------------------------
// Socket.IO connection handling
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  console.log(`[server] player connected: ${socket.id}`);

  // ---- Room lifecycle ----

  socket.on('createRoom', () => {
    const roomId = uuidv4();
    socket.join(roomId);
    (socket as any).roomId = roomId;

    const room = roomFactory.createRoom(roomId, socket.id);
    saveRoom(room);
    getOrCreateEngine(roomId, socket.id, null);

    console.log(`[server] room created: ${roomId} by ${socket.id}`);
    socket.emit('roomCreated', { roomId });
  });

  socket.on('joinRoom', (data: { roomId: string }) => {
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
    (socket as any).roomId = data.roomId;

    roomFactory.joinRoom(room, socket.id);
    saveRoom(room);

    // Re-init engine with both players
    const { stateMachine } = getOrCreateEngine(data.roomId, room.player1Id, socket.id);

    console.log(`[server] ${socket.id} joined room: ${data.roomId}`);
    socket.emit('roomJoined', { roomId: data.roomId });
    io.to(data.roomId).emit('playerJoined', { playerId: socket.id });

    // Start RPS phase
    roomFactory.setupRPS(room);
    saveRoom(room);
    stateMachine.transition('RPS');

    io.to(data.roomId).emit('startGame', { roomId: data.roomId });
    io.to(data.roomId).emit('rpsPhase', { message: 'Choose Rock, Paper, or Scissors!' });

    // Send hands to each player
    io.to(room.player1Id).emit('updateHand', {
      roomId: data.roomId,
      hand: room.players[room.player1Id].hand,
    });
    io.to(room.player2Id!).emit('updateHand', {
      roomId: data.roomId,
      hand: room.players[room.player2Id!].hand,
    });
  });

  // ---- Phase / Turn ----

  socket.on('nextState', (data: { roomId: string }) => {
    const room = getRoom(data.roomId);
    const sm = stateMachines.get(data.roomId);
    if (!room || !sm) return;

    const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
    sm.transition('stateTurnStart'); // Default next phase
    room.currentPhase = sm.currentPhase;
    saveRoom(room);
    syncService.sync(oldState, room, { action: 'nextState', playerId: socket.id });
  });

  socket.on('endTurn', (data: { roomId: string }) => {
    const room = getRoom(data.roomId);
    const sm = stateMachines.get(data.roomId);
    if (!room || !sm) return;

    if (sm.currentPhase === 'RPS') {
      socket.emit('error', { message: 'Cannot end turn during Rock Paper Scissors phase!' });
      return;
    }

    if (!sm.isPlayerTurn(socket.id)) {
      socket.emit('error', { message: 'Not your turn!' });
      return;
    }

    const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
    sm.transition('stateEndPhase');
    sm.transition('cleanupStep');
    sm.transition('stateTurnStart');
    sm.switchTurn();
    room.currentPhase = sm.currentPhase;
    room.activeTurnPlayerId = sm.currentPlayer;
    saveRoom(room);
    syncService.sync(oldState, room, { action: 'endTurn', playerId: socket.id });
  });

  // ---- Card actions ----

  socket.on('GetOptionsForCard', (data: any, callback?: (result: any) => void) => {
    const roomId = data.roomId || (socket as any).roomId;
    const room = getRoom(roomId);
    if (!room) {
      const empty: any[] = [];
      if (callback) callback(empty);
      socket.emit('OptionsForCard', { place: data.place, options: empty });
      return;
    }

    const cardUuid = data.uuid || data.card?.uuid;
    const zone = data.place as 'hand' | 'battlefield';
    const options = optionService.getOptions(room, socket.id, cardUuid, zone);

    if (callback) callback(options);
    socket.emit('OptionsForCard', { place: zone, options });
  });

  socket.on('playCard', (data: { roomId: string; cardUuid: string; targets?: any[] }) => {
    const room = getRoom(data.roomId);
    const sm = stateMachines.get(data.roomId);
    const as = actionServices.get(data.roomId);
    if (!room || !sm || !as) return;

    const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
    const result = as.proposeAndStack(room, socket.id, 'cast_spell', {
      cardUuid: data.cardUuid,
      targets: data.targets,
    }, sm);

    if (!result.success) {
      socket.emit('error', { message: result.reason });
      return;
    }

    room.currentPhase = sm.currentPhase;
    saveRoom(room);
    syncService.sync(oldState, room, { action: 'playCard', playerId: socket.id });
  });

  socket.on('resolveStack', (data: { roomId: string }) => {
    const room = getRoom(data.roomId);
    const sm = stateMachines.get(data.roomId);
    const as = actionServices.get(data.roomId);
    if (!room || !sm || !as) return;

    const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
    const result = as.resolveTopOfStack(room, sm);

    if (!result.success) {
      socket.emit('error', { message: result.reason });
      return;
    }

    room.currentPhase = sm.currentPhase;
    saveRoom(room);
    syncService.sync(oldState, room, { action: 'resolveStack', playerId: socket.id });
  });

  // ---- Priority ----

  socket.on('passPriority', (data: { roomId: string }) => {
    const room = getRoom(data.roomId);
    const sm = stateMachines.get(data.roomId);
    if (!room || !sm) return;

    const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
    sm.passPriority(socket.id);
    room.currentPhase = sm.currentPhase;
    room.priorityPlayerId = sm.priorityPlayer;
    room.lastPassedPlayerId = sm.lastPlayerToPass;
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

export { app, server, io };