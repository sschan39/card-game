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
import { createRoom, joinRoom, setupRPS, resolveRPS, buildTestDeck, dealStartingHands } from './engine/room-factory';
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
import { serverLogger } from './shared/game-logger';

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
  serverLogger.info('player:connected', `player connected: ${socket.id}`, { playerId: socket.id });

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

    serverLogger.info('room:created', `room created: ${roomId}`, { roomId, playerId: socket.id });
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

    serverLogger.info('room:joined', `${socket.id} joined room: ${data.roomId}`, { roomId: data.roomId, playerId: socket.id });
    socket.emit('roomJoined', { roomId: data.roomId });
    io.to(data.roomId).emit('playerJoined', { playerId: socket.id });

    // Start RPS phase
    setupRPS(room);
    saveRoom(room);
    engine.transition('RPS');

    serverLogger.info('rps:started', `RPS phase started in room ${data.roomId}`, {
      roomId: data.roomId,
      p1Hand: room.players[room.player1Id].hand.map(c => c.blueprint.id),
      p2Hand: room.players[socket.id].hand.map(c => c.blueprint.id),
    });

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
        // Transition: endPhase → cleanupStep → turnStart, then switch turn,
        // then advance through draw phase (draw a card) → main phase.
        // Finally give priority to the new active player so they can act.
        allMutations.push(...engine.transition('stateEndPhase'));
        allMutations.push(...engine.transition('cleanupStep'));
        allMutations.push(...engine.transition('stateTurnStart'));
        allMutations.push(...engine.switchTurn());
        allMutations.push(...engine.transition('stateDrawPhase'));
        allMutations.push(...engine.transition('stateMainPhase'));
        allMutations.push(...engine.givePriorityTo(engine.activeTurnPlayerId));
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

        // After resolution, if the stack is empty, return to the previous phase
        // and give priority back to the active player.
        const postResolveRoom = engine.roomState;
        if (postResolveRoom.stack.length === 0 && postResolveRoom.currentPhase === 'Stack') {
          const prevPhase = postResolveRoom.previousPhase;
          if (prevPhase) {
            allMutations.push(...engine.transition(prevPhase));
          } else {
            allMutations.push(...engine.transition('stateMainPhase'));
          }
          allMutations.push(...engine.givePriorityTo(postResolveRoom.activeTurnPlayerId));
        }
        break;
      }

      case 'rpsPlay': {
        const result = engine.handleAction(playerId, 'rpsPlay', {
          cardUuid: data.cardUuid,
        });
        if (!result.success) {
          serverLogger.warn('rps:rejected', `rpsPlay rejected: ${result.reason}`, { playerId, reason: result.reason });
          socket.emit('error', { message: result.reason });
          return;
        }
        allMutations = engine.applyMutations(result.mutations!);

        // Check if both players have played
        const updatedRoom = engine.roomState;
        const p1Played = updatedRoom.rpsState.playedCards[updatedRoom.player1Id];
        const p2Played = updatedRoom.rpsState.playedCards[updatedRoom.player2Id!];
        const playedCard = updatedRoom.rpsState.playedCards[playerId];
        serverLogger.debug('rps:played', `${playerId} played ${playedCard}`, {
          playerId,
          card: playedCard,
          p1Played: p1Played ?? null,
          p2Played: p2Played ?? null,
        });

        if (p1Played && p2Played) {
          const rpsMutations = resolveRPS(updatedRoom);
          allMutations.push(...engine.applyMutations(rpsMutations));

          // Build test decks and deal starting hands for the post-RPS game.
          // These are direct room mutations (setup, not game actions).
          const postRpsRoom = engine.roomState;
          postRpsRoom.players[postRpsRoom.player1Id].deck = buildTestDeck(postRpsRoom.player1Id);
          postRpsRoom.players[postRpsRoom.player2Id!].deck = buildTestDeck(postRpsRoom.player2Id!);
          dealStartingHands(postRpsRoom);

          // Auto-advance through the winner's first turn phases:
          // stateTurnStart (untap) → stateDrawPhase (draw) → stateMainPhase (playable).
          // Then give priority to the active player so they can act.
          allMutations.push(...engine.transition('stateDrawPhase'));
          allMutations.push(...engine.transition('stateMainPhase'));
          allMutations.push(...engine.givePriorityTo(postRpsRoom.activeTurnPlayerId));

          const winner = updatedRoom.activeTurnPlayerId;
          serverLogger.info('rps:resolved', `${p1Played} vs ${p2Played} → winner ${winner}`, {
            p1Played,
            p2Played,
            winner,
            winnerIsPlayer1: winner === updatedRoom.player1Id,
          });
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

    // After RPS resolution, emit a full room snapshot so clients get the
    // newly built decks and dealt hands (direct room mutations, not deltas).
    // The phase is no longer stateTurnStart — it's stateMainPhase after
    // auto-advance through stateDrawPhase. Check that RPS just resolved.
    if (data.actionId === 'rpsPlay' && currentRoom.rpsState.status === 'resolved') {
      io.to(data.roomId).emit('roomSnapshot', { room: currentRoom });
    }
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
    serverLogger.info('player:disconnected', `player disconnected: ${socket.id}`, { playerId: socket.id });
    // Cleanup could be added here (e.g., mark room as abandoned)
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  serverLogger.info('server:listening', `listening on http://localhost:${PORT}`, { port: Number(PORT) });
});

export { app, server, io };