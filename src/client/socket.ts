import { io, type Socket } from 'socket.io-client';
import { useGameStore } from './store/gameStore';
import type { StateDelta } from '@shared/delta.types';
import type { ActionOption } from '@engine/option-service';
import type { GameRoom } from '@shared/game.room.types';
import { clientLogger } from '../shared/game-logger';
import { getOrCreatePlayerId, getStoredRoomId } from './session';

/**
 * Socket.IO client singleton.
 * Binds all server→client events to the Zustand store.
 *
 * The `auth` handshake carries the stable player id and the persisted room id
 * on EVERY connection attempt (including automatic reconnects), so the server
 * can remap a reconnecting socket back to its existing room/player.
 */
const socket: Socket = io({
  autoConnect: true,
  auth: (cb) => {
    cb({
      playerId: getOrCreatePlayerId(),
      roomId: getStoredRoomId(),
    });
  },
});

socket.on('connect', () => {
  clientLogger.info('connected', 'Connected to server', { socketId: socket.id });
});

socket.on('stateDelta', (delta: StateDelta) => {
  useGameStore.getState().applyDelta(delta);
});

socket.on('roomCreated', (data: { roomId: string }) => {
  useGameStore.getState().setRoomId(data.roomId);
});

socket.on('roomSnapshot', (data: { room: GameRoom }) => {
  useGameStore.getState().setRoom(data.room);
});

socket.on('roomJoined', (data: { roomId: string }) => {
  useGameStore.getState().setRoomId(data.roomId);
});

socket.on('rejoined', (data: { roomId: string; playerId: string }) => {
  clientLogger.info('rejoined', 'Rejoined room', { roomId: data.roomId, playerId: data.playerId });
  useGameStore.getState().setRoomId(data.roomId);
  useGameStore.getState().setMyPlayerId(data.playerId);
});

socket.on('rejoinFailed', (data: { reason: string }) => {
  clientLogger.warn('rejoin:failed', `Rejoin failed: ${data.reason}`, { reason: data.reason });
  useGameStore.getState().clearSession();
});

socket.on('roomDestroyed', (data: { roomId: string }) => {
  clientLogger.info('room:destroyed', 'Room was destroyed', { roomId: data.roomId });
  useGameStore.getState().clearSession();
});

socket.on('playerJoined', (data: { playerId: string }) => {
  clientLogger.info('opponent:joined', 'Opponent joined', { opponentId: data.playerId });
});

socket.on('rpsPhase', (data: { message: string }) => {
  clientLogger.info('rps:phase', data.message);
});

socket.on('startGame', (data: { roomId: string }) => {
  clientLogger.info('game:started', 'Game started', { roomId: data.roomId });
});

socket.on('optionsForCard', (data: { zone: string; options: ActionOption[] }) => {
  useGameStore.getState().showContextMenu(data.options);
});

socket.on('error', (data: { message: string }) => {
  clientLogger.error('server:error', data.message);
  useGameStore.getState().setError(data.message);
});

socket.on('disconnect', () => {
  clientLogger.info('disconnected', 'Disconnected from server');
});

export default socket;
