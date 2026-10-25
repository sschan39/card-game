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

// ---------------------------------------------------------------------------
// Bootstrap and application composition
// ---------------------------------------------------------------------------

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' },
});

app.use(express.static(path.join(__dirname, '..', '..', 'game-client', 'dist')));

const syncService = new SyncService(io, path.join(__dirname, '..', '..', '..', 'data', 'deltas.jsonl'));
const runtime = new RoomRuntime(new InMemoryStore(), {
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
    for (const socketId of socketIds) io.to(socketId).emit('roomDestroyed', { roomId });
  },
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
    socket.emit('rejoined', { roomId: rejoin.roomId, playerId: rejoin.playerId });
    socket.emit('roomSnapshot', { room: rejoin.room });
  } else if (rejoin.kind === 'rejoin_failed') {
    socket.emit('rejoinFailed', { reason: rejoin.reason });
  }

  socket.on('createRoom', () => {
    const created = runtime.createRoom(socket.id, authPlayerId);
    socket.join(created.roomId);
    socket.emit('roomCreated', { roomId: created.roomId });
    socket.emit('roomSnapshot', { room: created.room });
  });

  socket.on('joinRoom', (data: { roomId: string }) => {
    const joined = runtime.joinRoom(socket.id, authPlayerId, data.roomId);
    if (joined.kind === 'not_found') {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    if (joined.kind === 'full') {
      socket.emit('roomFull');
      return;
    }

    socket.join(joined.roomId);
    socket.emit('roomJoined', { roomId: joined.roomId });
    io.to(joined.roomId).emit('playerJoined', { playerId: joined.playerId });
    io.to(joined.roomId).emit('startGame', { roomId: joined.roomId });
    io.to(joined.roomId).emit('rpsPhase', { message: 'Choose Rock, Paper, or Scissors!' });
    io.to(joined.roomId).emit('roomSnapshot', { room: joined.room });
  });

  socket.on('playerAction', (input: unknown) => {
    const packet = parseActionPacket(input);
    if (!packet) {
      socket.emit('error', { message: 'Invalid player action packet' });
      return;
    }

    const result = runtime.executePlayerAction(socket.id, packet);
    if (result.kind === 'error') {
      socket.emit('error', {
        message: result.message,
        commandId: result.commandId,
        action: result.action,
      });
      return;
    }
    if (result.snapshot) io.to(packet.roomId).emit('roomSnapshot', { room: result.snapshot });
  });

  socket.on('getOptions', (input: unknown, callback?: unknown) => {
    const data = typeof input === 'object' && input !== null && !Array.isArray(input)
      ? input as Record<string, unknown> : {};
    const roomId = typeof data.roomId === 'string' ? data.roomId : undefined;
    const valid = typeof data.cardUuid === 'string'
      && (data.zone === 'hand' || data.zone === 'battlefield');
    const options = roomId && valid
      ? runtime.getOptions(socket.id, roomId, data.cardUuid as string,
        data.zone as 'hand' | 'battlefield')
      : [];
    if (typeof callback === 'function') callback(options);
    socket.emit('optionsForCard', { zone: data.zone, options });
  });

  socket.on('disconnect', () => runtime.disconnect(socket.id));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  serverLogger.info('server:listening', `listening on http://localhost:${PORT}`, { port: Number(PORT) });
});

export { app, server, io };
