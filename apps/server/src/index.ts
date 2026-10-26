// Express + Socket.IO transport adapter.
// Multiplayer lifecycle and engine coordination belong to RoomRuntime.

import express from 'express';
import http from 'http';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import type { PlayerId } from '@card-game/engine/types/game.room.types';
import { parseActionPacket } from './rooms/action-packet';
import { RoomRuntime } from './rooms/room-runtime';
import { SyncService } from './rooms/sync-service';
import { InMemoryStore } from './rooms/state-store';
import { serverLogger } from '@card-game/engine/shared/game-logger';
import type { GameRoom } from '@card-game/engine/types/game.room.types';
import { gameConfig } from '@card-game/engine/config';
import { PROTOCOL_VERSION, isProtocolMessage, type OptionsMessage } from '@card-game/protocol';
import { buildPlayerView } from './projection/view-builder';
import { decodeChoiceAnswer } from './projection/choice-view';
import { createDebugRouter } from './projection/debug-channel';
import { projectActionOptions } from './projection/action-options';
import { decodeAbilityId } from './projection/wire-identifiers';

// ---------------------------------------------------------------------------
// Bootstrap and application composition
// ---------------------------------------------------------------------------

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' },
});

app.use(express.static(path.join(__dirname, '..', '..', 'game-client', 'dist')));

const syncService = new SyncService(io, process.env.DELTA_LOG_PATH ?? path.join(__dirname, '..', '..', '..', 'data', 'deltas.jsonl'));
const store = new InMemoryStore();
const runtime = new RoomRuntime(store, {
  publishDelta: request => {
    const delta = syncService.buildDelta(request.oldState, request.mutations, {
      action: request.action,
      playerId: request.playerId,
      batches: request.batches,
    });
    syncService.broadcast(delta, request.room,
      playerId => request.recipients.get(playerId) ?? playerId);
  },
  roomDestroyed: ({ roomId, socketIds }) => {
    for (const socketId of socketIds) io.to(socketId).emit('roomDestroyed', { protocolVersion: PROTOCOL_VERSION, roomId });
  },
});

app.use('/api/debug', createDebugRouter({ findRoom: roomId => store.getRoom(roomId), enabled: () => gameConfig.debugMode !== 'off' }));
const snapshot = (room: GameRoom, playerId: string) => ({ protocolVersion: PROTOCOL_VERSION,
  seq: syncService.currentSeq(room.roomId), room: buildPlayerView(room, playerId) });
function publishSnapshot(room: GameRoom): void {
  for (const [playerId, socketId] of runtime.recipientsFor(room)) io.to(socketId).emit('roomSnapshot', snapshot(room, playerId));
}
io.use((socket, next) => {
  if (!isProtocolMessage(socket.handshake.auth)) { next(new Error('Unsupported protocol version; reload the client')); return; }
  const { playerId, roomId } = socket.handshake.auth;
  if ((playerId !== undefined && (typeof playerId !== 'string' || !playerId.trim())) ||
      (roomId !== undefined && roomId !== null && (typeof roomId !== 'string' || !roomId.trim()))) {
    next(new Error('Invalid connection identity')); return;
  }
  next();
});

// Socket.IO closes the HTTP server after disconnecting its clients. Their
// disconnect handlers may schedule grace timers; release all runtime resources
// on final close.
server.on('close', () => runtime.dispose());

// ---------------------------------------------------------------------------
// Socket.IO transport
// ---------------------------------------------------------------------------

io.on('connection', socket => {
  serverLogger.info('player:connected', `player connected: ${socket.id}`, { playerId: socket.id });

  const auth = (socket.handshake.auth ?? {}) as { playerId?: string; roomId?: string | null };
  const authPlayerId = auth.playerId as PlayerId | undefined;
  const authRoomId = auth.roomId ?? null;
  const rejoin = runtime.connect(socket.id, authPlayerId, authRoomId);

  if (rejoin.kind === 'rejoined') {
    socket.join(rejoin.roomId);
    socket.emit('rejoined', { protocolVersion: PROTOCOL_VERSION, roomId: rejoin.roomId, playerId: rejoin.playerId });
    socket.emit('roomSnapshot', snapshot(rejoin.room, rejoin.playerId));
  } else if (rejoin.kind === 'rejoin_failed') {
    socket.emit('rejoinFailed', { protocolVersion: PROTOCOL_VERSION, reason: rejoin.reason });
  }

  socket.on('createRoom', (input: unknown) => {
    if (!isProtocolMessage(input)) { socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: 'Invalid create room packet' }); return; }
    const created = runtime.createRoom(socket.id, authPlayerId);
    socket.join(created.roomId);
    socket.emit('roomCreated', { protocolVersion: PROTOCOL_VERSION, roomId: created.roomId });
    socket.emit('roomSnapshot', snapshot(created.room, created.playerId));
  });

  socket.on('joinRoom', (data: unknown) => {
    if (!isProtocolMessage(data) || typeof data.roomId !== 'string') {
      socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: 'Invalid join room packet' }); return;
    }
    const joined = runtime.joinRoom(socket.id, authPlayerId, data.roomId);
    if (joined.kind === 'not_found') {
      socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: 'Room not found' });
      return;
    }
    if (joined.kind === 'full') {
      socket.emit('roomFull', { protocolVersion: PROTOCOL_VERSION });
      return;
    }

    socket.join(joined.roomId);
    socket.emit('roomJoined', { protocolVersion: PROTOCOL_VERSION, roomId: joined.roomId });
    io.to(joined.roomId).emit('playerJoined', { protocolVersion: PROTOCOL_VERSION, playerId: joined.playerId });
    io.to(joined.roomId).emit('startGame', { protocolVersion: PROTOCOL_VERSION, roomId: joined.roomId });
    io.to(joined.roomId).emit('rpsPhase', { protocolVersion: PROTOCOL_VERSION, message: 'Choose Rock, Paper, or Scissors!' });
    publishSnapshot(joined.room);
  });

  socket.on('playerAction', (input: unknown) => {
    const packet = parseActionPacket(input);
    if (!packet) {
      socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: 'Invalid player action packet' });
      return;
    }

    const room = store.getRoom(packet.roomId);
    if ((packet.actionId === 'activate_ability' || packet.actionId === 'tapForMana') && room) {
      try { packet.data = decodeAbilityId(room, authPlayerId ?? socket.id, packet.data); }
      catch { socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: 'Invalid ability option', commandId: packet.commandId, action: packet.actionId }); return; }
    }
    if (packet.actionId === 'choose' && room) {
      try { packet.data = decodeChoiceAnswer(room, authPlayerId ?? socket.id, packet.data); }
      catch { socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: 'Invalid choice option', commandId: packet.commandId, action: packet.actionId }); return; }
    }
    const result = runtime.executePlayerAction(socket.id, packet);
    if (result.kind === 'error') {
      socket.emit('error', {
        protocolVersion: PROTOCOL_VERSION,
        message: result.message,
        commandId: result.commandId,
        action: result.action,
      });
      return;
    }
    if (result.snapshot) publishSnapshot(result.snapshot);
  });

  socket.on('getOptions', (input: unknown, callback?: unknown) => {
    const data = typeof input === 'object' && input !== null && !Array.isArray(input)
      ? input as Record<string, unknown> : {};
    const roomId = typeof data.roomId === 'string' ? data.roomId : undefined;
    const valid = isProtocolMessage(data) && typeof data.cardUuid === 'string'
      && (data.zone === 'hand' || data.zone === 'battlefield');
    const options = roomId && valid
      ? runtime.getOptions(socket.id, roomId, data.cardUuid as string,
        data.zone as 'hand' | 'battlefield')
      : [];
    const response: OptionsMessage = { protocolVersion: PROTOCOL_VERSION, roomId: roomId ?? null,
      cardUuid: typeof data.cardUuid === 'string' ? data.cardUuid : null,
      zone: data.zone === 'hand' || data.zone === 'battlefield' ? data.zone : null,
      options: projectActionOptions(options, roomId ?? '', authPlayerId ?? socket.id) };
    if (typeof callback === 'function') callback(response);
    socket.emit('optionsForCard', response);
  });

  socket.on('disconnect', () => runtime.disconnect(socket.id));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  serverLogger.info('server:listening', `listening on http://localhost:${PORT}`, { port: Number(PORT) });
});

export { app, server, io };
