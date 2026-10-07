// src/server.ts
// Express + Socket.IO server wiring all engine services together.
// The engine has zero socket knowledge — this file is the translation layer.

import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

import { GameEngine } from './engine/game-engine';
import type { AppliedEventBatch } from './types/game-event.types';
import { OptionService } from './engine/option-service';
import { parseActionPacket } from './server/action-packet';
import { SyncService } from './server/sync-service';
import { InMemoryStore } from './server/state-store';
import {
  createIdentityMaps,
  resolvePlayerId as resolvePlayerIdFrom,
  resolveSocketId as resolveSocketIdFrom,
  bindSocket as bindSocketTo,
  unbindSocket as unbindSocketFrom,
  unbindRoom,
  decideRejoin,
} from './server/reconnect';
import { createRoom, joinRoom, setupRPS, resolveRPS, buildStartingCardMutations } from './engine/room-factory';
import { registerAction } from './engine/action-registry';
import { playCardHandler } from './engine/handlers/play-card-handler';
import { activateAbilityHandler } from './engine/handlers/activate-ability-handler';
import { declareAttackersHandler } from './engine/handlers/declare-attackers-handler';
import { declareBlockersHandler } from './engine/handlers/declare-blockers-handler';
import { tapForManaHandler } from './engine/handlers/tap-for-mana-handler';
import { enterBattleHandler } from './engine/handlers/enter-battle-handler';
import { endTurnHandler } from './engine/handlers/end-turn-handler';
import { passPriorityHandler } from './engine/handlers/pass-priority-handler';
import { resolveStackHandler } from './engine/handlers/resolve-stack-handler';
import { rpsPlayHandler } from './engine/handlers/rps-play-handler';
import { ACTION_IDS, type ActionId } from './types/action.ids';
import type { ActionHandler } from './engine/action-registry';
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

// Register action handlers.
// The map is keyed by the closed `ActionId` union, so the compiler forces every
// known action to have a handler and rejects typos. Orchestration commands
// execute through the engine's descriptor table; retaining their handlers
// preserves the lower-level action API used by rules tests.
const ACTION_HANDLERS: Record<Exclude<ActionId, typeof ACTION_IDS.choose>, ActionHandler> = {
  [ACTION_IDS.castSpell]: playCardHandler,
  [ACTION_IDS.activateAbility]: activateAbilityHandler,
  [ACTION_IDS.declareAttackers]: declareAttackersHandler,
  [ACTION_IDS.declareBlockers]: declareBlockersHandler,
  [ACTION_IDS.tapForMana]: tapForManaHandler,
  [ACTION_IDS.enterBattle]: enterBattleHandler,
  [ACTION_IDS.endTurn]: endTurnHandler,
  [ACTION_IDS.passPriority]: passPriorityHandler,
  [ACTION_IDS.resolveStack]: resolveStackHandler,
  [ACTION_IDS.rpsPlay]: rpsPlayHandler,
};
for (const [actionId, handler] of Object.entries(ACTION_HANDLERS)) {
  registerAction(actionId, handler);
}

// Per-room engine instances
const engines = new Map<string, GameEngine>();
const optionService = new OptionService();

// ---------------------------------------------------------------------------
// Identity remap tables
//
// The server uses a STABLE player id (client-generated, from the `auth`
// handshake) as PlayerId, NOT socket.id — socket.id changes on every reconnect.
// These two maps bridge socket.id ↔ stable player id so a reconnecting socket
// is recognized as the same player and deltas reach the right socket.
// ---------------------------------------------------------------------------

const identity = createIdentityMaps();
const resolvePlayerId = (socketId: string): PlayerId => resolvePlayerIdFrom(identity, socketId);
const resolveSocketId = (playerId: PlayerId): string => resolveSocketIdFrom(identity, playerId);
const bindSocket = (socketId: string, playerId: PlayerId): void => bindSocketTo(identity, socketId, playerId);
const unbindSocket = (socketId: string): void => unbindSocketFrom(identity, socketId);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRoom(roomId: string): GameRoom | undefined {
  return store.getRoom(roomId);
}

function saveRoom(room: GameRoom): void {
  store.saveRoom(room);
}

/** Replace from authoritative state, releasing the previous engine's listeners. */
function replaceRoomEngine(room: GameRoom): GameEngine {
  engines.get(room.roomId)?.dispose();
  const engine = new GameEngine(room);
  engine.initRoom();
  engines.set(room.roomId, engine);
  return engine;
}

/** Recovery follows the same initialization path as creation and joining. */
function getOrCreateEngine(roomId: string): GameEngine {
  const engine = engines.get(roomId);
  if (engine) return engine;
  const room = getRoom(roomId);
  if (!room) throw new Error(`Room ${roomId} not found`);
  return replaceRoomEngine(room);
}

/**
 * Destroy a room: dispose its engine (unregister listeners), remove it from
 * the engines map and the state store, clean up identity bindings, and notify
 * any still-connected sockets so they reset to the start screen.
 * Idempotent — safe to call twice.
 */
function destroyRoom(roomId: string): void {
  cancelScheduledDestroy(roomId);
  const room = getRoom(roomId);
  const engine = engines.get(roomId);
  if (engine) {
    engine.dispose();
    engines.delete(roomId);
  }
  store.deleteRoom(roomId);

  // Notify any still-connected sockets in this room so they reset.
  if (room) {
    const memberIds = [room.player1Id, room.player2Id].filter(
      (id): id is PlayerId => id !== null && id !== undefined,
    );
    for (const playerId of memberIds) {
      const socketId = resolveSocketId(playerId);
      if (socketId) {
        io.to(socketId).emit('roomDestroyed', { roomId });
      }
    }
    // Clean up identity bindings for this room's members.
    unbindRoom(identity, room);
  }

  serverLogger.info('room:destroyed', `room destroyed: ${roomId}`, { roomId });
}

/**
 * Grace-period timers keyed by roomId. When a player disconnects, we schedule
 * destruction after GRACE_PERIOD_MS. A rejoin within the window cancels it.
 */
const destroyTimers = new Map<string, ReturnType<typeof setTimeout>>();
const GRACE_PERIOD_MS = 30_000;

/** Schedule (or reschedule) room destruction after the grace period. */
function scheduleDestroy(roomId: string): void {
  cancelScheduledDestroy(roomId);
  const timer = setTimeout(() => {
    destroyTimers.delete(roomId);
    destroyRoom(roomId);
  }, GRACE_PERIOD_MS);
  destroyTimers.set(roomId, timer);
  serverLogger.info('room:destroy:scheduled', `room ${roomId} scheduled for destruction in ${GRACE_PERIOD_MS}ms`, { roomId });
}

/** Cancel a pending destruction timer for a room (on rejoin). */
function cancelScheduledDestroy(roomId: string): void {
  const timer = destroyTimers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    destroyTimers.delete(roomId);
    serverLogger.info('room:destroy:cancelled', `room ${roomId} destruction cancelled`, { roomId });
  }
}

// Socket.IO closes the HTTP server after disconnecting its clients. Their
// disconnect handlers may schedule grace timers; release those on final close.
server.on('close', () => {
  for (const roomId of destroyTimers.keys()) cancelScheduledDestroy(roomId);
  for (const engine of engines.values()) engine.dispose();
  engines.clear();
});

/**
 * Build a delta from the mutations applied by an engine operation and
 * broadcast per-player filtered deltas.
 */
function syncAfter(oldState: GameRoom, currentRoom: GameRoom, mutations: GameMutation[], action: string, playerId: PlayerId, batches: AppliedEventBatch[]): void {
  if (mutations.length === 0) return;
  const delta = syncService.buildDelta(oldState, mutations, { action, playerId, batches });
  syncService.broadcast(delta, currentRoom, resolveSocketId);
}

// ---------------------------------------------------------------------------
// Socket.IO connection handling
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  serverLogger.info('player:connected', `player connected: ${socket.id}`, { playerId: socket.id });

  // ---- Rejoin / identity handshake ----
  //
  // The client sends its STABLE player id (and the room it was in) via the
  // `auth` handshake on every connection attempt. If the room still exists and
  // this player is a member, remap the socket to that player and rejoin.
  const auth = (socket.handshake.auth ?? {}) as { playerId?: string; roomId?: string | null };
  const authPlayerId = auth.playerId as PlayerId | undefined;
  const authRoomId = auth.roomId ?? null;

  if (authPlayerId && authRoomId) {
    const decision = decideRejoin(getRoom, authPlayerId, authRoomId);

    if (decision.kind === 'rejoin') {
      // Rejoin: remap identity, join the room, cancel any pending destruction.
      bindSocket(socket.id, authPlayerId);
      socket.join(authRoomId);
      (socket as any).roomId = authRoomId;
      cancelScheduledDestroy(authRoomId);
      getOrCreateEngine(authRoomId);

      serverLogger.info('player:rejoined', `player ${authPlayerId} rejoined room ${authRoomId}`, {
        roomId: authRoomId,
        playerId: authPlayerId,
        socketId: socket.id,
      });

      socket.emit('rejoined', { roomId: authRoomId, playerId: authPlayerId });
      socket.emit('roomSnapshot', { room: decision.room });
    } else {
      // Room is gone (destroyed) or this player is not a member.
      const reason = decision.reason;
      serverLogger.warn('player:rejoin:failed', `rejoin failed for ${authPlayerId}: ${reason}`, {
        roomId: authRoomId,
        playerId: authPlayerId,
        reason,
      });
      socket.emit('rejoinFailed', { reason });
    }
  }

  // ---- Room lifecycle ----

  socket.on('createRoom', () => {
    const roomId = uuidv4();
    const playerId = authPlayerId ?? (socket.id as PlayerId);
    bindSocket(socket.id, playerId);
    socket.join(roomId);
    (socket as any).roomId = roomId;

    const room = createRoom(roomId, playerId);
    saveRoom(room);
    replaceRoomEngine(room);

    serverLogger.info('room:created', `room created: ${roomId}`, { roomId, playerId });
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

    const playerId = authPlayerId ?? (socket.id as PlayerId);
    bindSocket(socket.id, playerId);
    socket.join(data.roomId);
    (socket as any).roomId = data.roomId;

    joinRoom(room, playerId);
    saveRoom(room);

    // Rebuild from the authoritative joined room, retaining its current data.
    // The centralized replacement releases the old manager and initializes one.
    const engine = replaceRoomEngine(room);

    serverLogger.info('room:joined', `${playerId} joined room: ${data.roomId}`, { roomId: data.roomId, playerId });
    socket.emit('roomJoined', { roomId: data.roomId });
    io.to(data.roomId).emit('playerJoined', { playerId });

    // Start RPS phase
    setupRPS(room);
    // RPS is a status, not a phase transition.
    // NOTE: applyMutations reassigns engine.room to a NEW object, so the local
    // `room` reference goes stale. Always read back via engine.roomState.
    engine.applyMutations([{ type: 'SET_STATUS', status: 'RPS' }]);
    engine.drainEventBatches(); // Setup is delivered as a full room snapshot below.
    const rpsRoom = engine.roomState;
    saveRoom(rpsRoom);

    serverLogger.info('rps:started', `RPS phase started in room ${data.roomId}`, {
      roomId: data.roomId,
      p1Hand: rpsRoom.players[rpsRoom.player1Id].hand.map(c => c.blueprint.id),
      p2Hand: rpsRoom.players[playerId].hand.map(c => c.blueprint.id),
    });

    io.to(data.roomId).emit('startGame', { roomId: data.roomId });
    io.to(data.roomId).emit('rpsPhase', { message: 'Choose Rock, Paper, or Scissors!' });

    // Send full room snapshot to both players (RPS hands are now dealt)
    io.to(data.roomId).emit('roomSnapshot', { room: rpsRoom });
  });

  // ---- Unified player action ----

  socket.on('playerAction', (input: unknown) => {
    const packet = parseActionPacket(input);
    if (!packet) {
      socket.emit('error', { message: 'Invalid player action packet' });
      return;
    }
    const { roomId, actionId, data } = packet;
    const room = getRoom(roomId);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    const engine = getOrCreateEngine(roomId);
    const playerId = resolvePlayerId(socket.id);
    const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
    engine.withCommandContext(actionId, playerId, () => {
      const result = engine.executePlayerAction(playerId, actionId, data);
      if (!result.success) {
        socket.emit('error', { message: result.reason });
        return;
      }
      const allMutations = [...(result.mutations ?? [])];

      // Deck construction is setup, not command routing. Keep this explicit until
      // setup itself needs a separate owner; all player commands delegate above.
      let rpsResolved = false;
      const chosen = engine.roomState;
      if (actionId === ACTION_IDS.rpsPlay && chosen.status === 'RPS' && chosen.player2Id &&
          chosen.rpsState.playedCards[chosen.player1Id] && chosen.rpsState.playedCards[chosen.player2Id]) {
        allMutations.push(...engine.applyMutations(resolveRPS(chosen)));
        allMutations.push(...engine.applyMutations(buildStartingCardMutations(engine.roomState)));
        allMutations.push(...engine.advancePhase('complete'));
        rpsResolved = true;
        serverLogger.info('rps:resolved', `RPS resolved; first player ${engine.activeTurnPlayerId}`, {
          roomId, winner: engine.activeTurnPlayerId,
        });
      }

      const currentRoom = engine.roomState;
      saveRoom(currentRoom);
      syncAfter(oldState, currentRoom, allMutations, actionId, playerId, engine.drainEventBatches());
      if (rpsResolved) io.to(roomId).emit('roomSnapshot', { room: currentRoom });
    });
  });

  // ---- Options ----

  socket.on('getOptions', (input: unknown, callback?: unknown) => {
    const data = typeof input === 'object' && input !== null && !Array.isArray(input)
      ? input as Record<string, unknown> : {};
    const room = typeof data.roomId === 'string' ? getRoom(data.roomId) : undefined;
    const valid = typeof data.cardUuid === 'string' && (data.zone === 'hand' || data.zone === 'battlefield');
    const options = room && valid
      ? optionService.getOptions(room, resolvePlayerId(socket.id), data.cardUuid as string, data.zone as 'hand' | 'battlefield')
      : [];
    if (typeof callback === 'function') callback(options);
    socket.emit('optionsForCard', { zone: data.zone, options });
  });

  // ---- Disconnect ----

  socket.on('disconnect', () => {
    const playerId = resolvePlayerId(socket.id);
    serverLogger.info('player:disconnected', `player disconnected: ${socket.id}`, { playerId });

    // Remove the socket→player binding. The player may reconnect with a NEW
    // socket.id, so we must not destroy their identity — only the socket link.
    unbindSocket(socket.id);

    const roomId = (socket as any).roomId as string | undefined;
    if (!roomId) return;

    const room = getRoom(roomId);
    if (!room) return;

    // Determine if this was the last player in the room. If the other player
    // slot is empty (never joined or already gone), the room has no one left.
    const isPlayer1 = room.player1Id === playerId;
    const isPlayer2 = room.player2Id === playerId;
    const otherPlayerId = isPlayer1 ? room.player2Id : room.player1Id;
    const otherGone = otherPlayerId === null || otherPlayerId === undefined;

    // Pre-game rooms (waiting / RPS) are cheap to recreate, so destroy them
    // immediately if the other player is gone. In-game rooms get a grace period
    // so a transient disconnect (refresh, network blip) can rejoin.
    const preGame = room.status === 'waiting' || room.status === 'RPS';

    if (otherGone) {
      // No one else is in the room — nothing to preserve. Destroy now.
      destroyRoom(roomId);
    } else if (preGame) {
      // Both players were present but the game hasn't started; a refresh of one
      // player shouldn't strand the other forever. Give a short grace period.
      scheduleDestroy(roomId);
    } else {
      // In-game: give the disconnecting player a grace period to reconnect.
      scheduleDestroy(roomId);
    }
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
