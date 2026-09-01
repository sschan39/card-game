import { io, type Socket } from 'socket.io-client';
import { useGameStore } from './store/gameStore';
import { classifyRpsOutcome, rpsOutcomeText } from './rpsOutcome';
import type { StateDelta } from '@shared/delta.types';
import type { ActionOption } from '@engine/option-service';
import type { GameRoom } from '@shared/game.room.types';

/**
 * Socket.IO client singleton.
 * Binds all server→client events to the Zustand store.
 */
const socket: Socket = io({
  autoConnect: true,
});

socket.on('connect', () => {
  console.log('[client] connected:', socket.id);
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

socket.on('playerJoined', (data: { playerId: string }) => {
  console.log('[client] opponent joined:', data.playerId);
});

socket.on('rpsPhase', (data: { message: string }) => {
  console.log('[client] RPS phase:', data.message);
  useGameStore.getState().setError('');
  useGameStore.getState().setRpsPrompt(data.message);
});

socket.on('rpsResult', (data: { winner?: string; tie?: boolean }) => {
  const s = useGameStore.getState();
  // Correctly attribute the winner from this client's perspective. The old
  // handler tested boolean truthiness of `winner`, so a PlayerId string always
  // made it truthy and the correct player never saw "you win".
  const perspective = classifyRpsOutcome(data, s.myPlayerId);
  s.setRpsPrompt(rpsOutcomeText(perspective));
  console.log('[client] RPS result:', perspective, data);
});

socket.on('gameStarted', (data: { winner: string; firstTurnPlayerId: string }) => {
  useGameStore.getState().setRpsPrompt('');
  console.log('[client] game started:', data);
});

socket.on('startGame', (data: { roomId: string }) => {
  console.log('[client] game started:', data.roomId);
});

socket.on('optionsForCard', (data: { zone: string; options: ActionOption[] }) => {
  useGameStore.getState().showContextMenu(data.options);
});

socket.on('error', (data: { message: string }) => {
  console.error('[client] server error:', data.message);
  useGameStore.getState().setError(data.message);
});

socket.on('disconnect', () => {
  console.log('[client] disconnected');
});

export default socket;
