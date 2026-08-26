// src/server.ts
// Express + Socket.IO server wiring all engine services together.
// The engine has zero socket knowledge — this file is the translation layer.

import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

import { GameEngine } from './engine/game-engine';
import { OptionService } from './engine/option-service';
import { SyncService } from './server/sync-service';
import { InMemoryStore } from './server/state-store';
import { createRoom, joinRoom, setupRPS, resolveRPS } from './engine/room-factory';
import { registerAction } from './engine/action-registry';
import { playCardHandler } from './engine/handlers/play-card-handler';
import { attackHandler } from './engine/handlers/attack-handler';
import { tapForManaHandler } from './engine/handlers/tap-for-mana-handler';
import { endTurnHandler } from './engine/handlers/end-turn-handler';
import { passPriorityHandler } from './engine/handlers/pass-priority-handler';
import { resolveStackHandler } from './engine/handlers/resolve-stack-handler';
import { rpsPlayHandler } from './engine/handlers/rps-play-handler';
import type { GameRoom, PlayerId } from './types/game.room.types';
import type { GameMutation } from './types/game-mutation.types';
import type { StateStore } from './server/state-store';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' },
});

app.use(express.static(path.join(__dirname, 'client')));

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

const store: StateStore = new InMemoryStore();
const syncService = new SyncService(io, path.join(__dirname, '..', 'data', 'deltas.jsonl'));

// Register action handlers
registerAction('cast_spell', playCardHandler);
registerAction('attack', attackHandler);
registerAction('tapForMana', tapForManaHandler);
registerAction('end_turn', endTurnHandler);
registerAction('pass_priority', passPriorityHandler);
registerAction('resolve_stack', resolveStackHandler);
registerAction('rpsPlay', rpsPlayHandler);

// Per-room engine instances
const engines = new Map<string, GameEngine>();
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

function getOrCreateEngine(roomId: string): GameEngine {
  if (!engines.has(roomId)) {
    const room = getRoom(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);
    const engine = new GameEngine(room);
    engines.set(roomId, engine);
  }
  return engines.get(roomId)!;
}

/**
 * Build a delta from the mutations applied by an engine operation and
 * broadcast per-player filtered deltas.
 */
function syncAfter(oldState: GameRoom, currentRoom: GameRoom, mutations: GameMutation[], action: string, playerId: PlayerId): void {
  if (mutations.length === 0) return;
  const delta = syncService.buildDelta(oldState, mutations, { action, playerId });
  syncService.broadcast(delta, currentRoom);
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

    const room = createRoom(roomId, socket.id);
    saveRoom(room);
    const engine = new GameEngine(room);
    engines.set(roomId, engine);
    engine.initRoom();

    console.log(`[server] room created: ${roomId} by ${socket.id}`);
    socket.emit('roomCreated', { roomId });

    // Send full room snapshot so the client can initialize its store
    socket.emit('roomSnapshot', { room });
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

    joinRoom(room, socket.id);
    saveRoom(room);

    // Re-create engine with both players (room now has player2Id)
    const engine = new GameEngine(room);
    engines.set(data.roomId, engine);

    console.log(`[server] ${socket.id} joined room: ${data.roomId}`);
    socket.emit('roomJoined', { roomId: data.roomId });
    io.to(data.roomId).emit('playerJoined', { playerId: socket.id });

    // Start RPS phase
    setupRPS(room);
    saveRoom(room);
    engine.transition('RPS');

    io.to(data.roomId).emit('startGame', { roomId: data.roomId });
    io.to(data.roomId).emit('rpsPhase', { message: 'Choose Rock, Paper, or Scissors!' });

    // Send full room snapshot to both players (RPS hands are now dealt)
    io.to(data.roomId).emit('roomSnapshot', { room });
  });

  // ---- Unified player action ----

  socket.on('playerAction', (data: { roomId: string; actionId: string; cardUuid?: string; targets?: any[] }) => {
    const room = getRoom(data.roomId);
    const engine = engines.get(data.roomId);
    if (!room || !engine) return;

    const playerId = socket.id as PlayerId;

    // Snapshot room before mutations
    const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;

    let allMutations: GameMutation[] = [];

    switch (data.actionId) {
      case 'end_turn': {
        // Validate
        const validateResult = endTurnHandler.validate(room, playerId, {});
        if (!validateResult.success) {
          socket.emit('error', { message: validateResult.reason });
          return;
        }
        // Transition: endPhase → cleanupStep → turnStart, then switch turn
        allMutations.push(...engine.transition('stateEndPhase'));
        allMutations.push(...engine.transition('cleanupStep'));
        allMutations.push(...engine.transition('stateTurnStart'));
        allMutations.push(...engine.switchTurn());
        break;
      }

      case 'pass_priority': {
        const result = engine.passPriority(playerId);
        if (!result.success) {
          socket.emit('error', { message: 'Not your priority!' });
          return;
        }
        allMutations = result.mutations;
        break;
      }

      case 'resolve_stack': {
        const result = engine.resolveTopOfStack();
        if (!result.success) {
          socket.emit('error', { message: result.reason });
          return;
        }
        allMutations = result.mutations ?? [];
        break;
      }

      case 'rpsPlay': {
        const result = engine.handleAction(playerId, 'rpsPlay', {
          cardUuid: data.cardUuid,
        });
        if (!result.success) {
          socket.emit('error', { message: result.reason });
          return;
        }
        allMutations = engine.applyMutations(result.mutations!);

        // Check if both players have played
        const updatedRoom = engine.roomState;
        const p1Played = updatedRoom.rpsState.playedCards[updatedRoom.player1Id];
        const p2Played = updatedRoom.rpsState.playedCards[updatedRoom.player2Id!];
        if (p1Played && p2Played) {
          const rpsMutations = resolveRPS(updatedRoom);
          allMutations.push(...engine.applyMutations(rpsMutations));
        }
        break;
      }

      default: {
        // Card-based actions: cast_spell, attack, tapForMana
        const result = engine.proposeAndStack(playerId, data.actionId, {
          cardUuid: data.cardUuid,
          targets: data.targets,
        });
        if (!result.success) {
          socket.emit('error', { message: result.reason });
          return;
        }
        allMutations = result.mutations ?? [];
        break;
      }
    }

    // The engine's room is a new object after reducer application — use it.
    const currentRoom = engine.roomState;
    saveRoom(currentRoom);
    syncAfter(oldState, currentRoom, allMutations, data.actionId, playerId);
  });

  // ---- Options ----

  socket.on('getOptions', (data: { roomId: string; cardUuid: string; zone: 'hand' | 'battlefield' }, callback?: (result: any) => void) => {
    const room = getRoom(data.roomId);
    if (!room) {
      const empty: any[] = [];
      if (callback) callback(empty);
      socket.emit('optionsForCard', { zone: data.zone, options: empty });
      return;
    }

    const options = optionService.getOptions(room, socket.id, data.cardUuid, data.zone);

    if (callback) callback(options);
    socket.emit('optionsForCard', { zone: data.zone, options });
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