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
import {
  createIdentityMaps,
  resolvePlayerId as resolvePlayerIdFrom,
  resolveSocketId as resolveSocketIdFrom,
  bindSocket as bindSocketTo,
  unbindSocket as unbindSocketFrom,
  unbindRoom,
  decideRejoin,
} from './server/reconnect';
import { createRoom, joinRoom, setupRPS, resolveRPS, buildTestDeck, dealStartingHands } from './engine/room-factory';
import { registerAction } from './engine/action-registry';
import { playCardHandler } from './engine/handlers/play-card-handler';
import { attackHandler } from './engine/handlers/attack-handler';
import { tapForManaHandler } from './engine/handlers/tap-for-mana-handler';
import { endTurnHandler } from './engine/handlers/end-turn-handler';
import { passPriorityHandler } from './engine/handlers/pass-priority-handler';
import { resolveStackHandler } from './engine/handlers/resolve-stack-handler';
import { rpsPlayHandler } from './engine/handlers/rps-play-handler';
import { ACTION_IDS, type ActionId, type ActionIdOrAbility } from './types/action.ids';
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
// known action to have a handler and rejects typos. `end_turn`, `pass_priority`,
// and `resolve_stack` are ALSO special-cased in the playerAction switch below
// (they don't go through proposeAndStack), but registering them keeps the
// registry complete for the engine's lookup.
const ACTION_HANDLERS: Record<ActionId, ActionHandler> = {
  [ACTION_IDS.castSpell]: playCardHandler,
  [ACTION_IDS.attack]: attackHandler,
  [ACTION_IDS.tapForMana]: tapForManaHandler,
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
 * Destroy a room: dispose its engine (unregister listeners), remove it from
 * the engines map and the state store, clean up identity bindings, and notify
 * any still-connected sockets so they reset to the start screen.
 * Idempotent — safe to call twice.
 */
function destroyRoom(roomId: string): void {
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

/**
 * Build a delta from the mutations applied by an engine operation and
 * broadcast per-player filtered deltas.
 */
function syncAfter(oldState: GameRoom, currentRoom: GameRoom, mutations: GameMutation[], action: string, playerId: PlayerId): void {
  if (mutations.length === 0) return;
  const delta = syncService.buildDelta(oldState, mutations, { action, playerId });
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
    const engine = new GameEngine(room);
    engines.set(roomId, engine);
    engine.initRoom();

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

    // Re-create engine with both players (room now has player2Id)
    const engine = new GameEngine(room);
    engines.set(data.roomId, engine);

    serverLogger.info('room:joined', `${playerId} joined room: ${data.roomId}`, { roomId: data.roomId, playerId });
    socket.emit('roomJoined', { roomId: data.roomId });
    io.to(data.roomId).emit('playerJoined', { playerId });

    // Start RPS phase
    setupRPS(room);
    saveRoom(room);
    engine.transition('RPS');

    serverLogger.info('rps:started', `RPS phase started in room ${data.roomId}`, {
      roomId: data.roomId,
      p1Hand: room.players[room.player1Id].hand.map(c => c.blueprint.id),
      p2Hand: room.players[playerId].hand.map(c => c.blueprint.id),
    });

    io.to(data.roomId).emit('startGame', { roomId: data.roomId });
    io.to(data.roomId).emit('rpsPhase', { message: 'Choose Rock, Paper, or Scissors!' });

    // Send full room snapshot to both players (RPS hands are now dealt)
    io.to(data.roomId).emit('roomSnapshot', { room });
  });

  // ---- Unified player action ----

  socket.on('playerAction', (data: { roomId: string; actionId: ActionIdOrAbility; cardUuid?: string; targets?: any[] }) => {
    const room = getRoom(data.roomId);
    const engine = engines.get(data.roomId);
    if (!room || !engine) return;

    const playerId = resolvePlayerId(socket.id);

    // Snapshot room before mutations
    const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;

    let allMutations: GameMutation[] = [];

    switch (data.actionId) {
      case ACTION_IDS.endTurn: {
        // Validate
        const validateResult = endTurnHandler.validate(room, playerId, {});
        if (!validateResult.success) {
          socket.emit('error', { message: validateResult.reason });
          return;
        }

        if (room.currentPhase === 'stateMainPhase') {
          // Main Phase → combat: entering combat runs the full five-step
          // combat pipeline (auto-advance, no priority windows) and completes
          // the turn: endCombatStep → endPhase → cleanupStep → turnStart, then
          // switch turn, then advance through draw phase (draw a card) → main
          // phase. Finally give priority to the new active player so they can
          // act. The combat steps are no-op placeholders that emit stub events.
          allMutations.push(...engine.transition('beginCombatStep'));
          allMutations.push(...engine.transition('declareAttackersStep'));
          allMutations.push(...engine.transition('declareBlockersStep'));
          allMutations.push(...engine.transition('combatDamageStep'));
          allMutations.push(...engine.transition('endCombatStep'));
          allMutations.push(...engine.transition('stateEndPhase'));
          allMutations.push(...engine.transition('cleanupStep'));
          allMutations.push(...engine.transition('stateTurnStart'));
          allMutations.push(...engine.switchTurn());
          allMutations.push(...engine.transition('stateDrawPhase'));
          allMutations.push(...engine.transition('stateMainPhase'));
          allMutations.push(...engine.givePriorityTo(engine.activeTurnPlayerId));
        }
        break;
      }

      case ACTION_IDS.passPriority: {
        const result = engine.passPriority(playerId);
        if (!result.success) {
          socket.emit('error', { message: 'Not your priority!' });
          return;
        }
        allMutations = result.mutations;
        break;
      }

      case ACTION_IDS.resolveStack: {
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

      case ACTION_IDS.rpsPlay: {
        const result = engine.handleAction(playerId, ACTION_IDS.rpsPlay, {
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
    if (data.actionId === ACTION_IDS.rpsPlay && currentRoom.rpsState.status === 'resolved') {
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

    const options = optionService.getOptions(room, resolvePlayerId(socket.id), data.cardUuid, data.zone);

    if (callback) callback(options);
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
    const preGame = room.currentPhase === 'waiting' || room.currentPhase === 'RPS';

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