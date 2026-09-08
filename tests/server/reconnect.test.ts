import { describe, it, expect } from 'vitest';
import {
  createIdentityMaps,
  resolvePlayerId,
  resolveSocketId,
  bindSocket,
  unbindSocket,
  unbindRoom,
  decideRejoin,
} from '../../src/server/reconnect';
import { createTestRoom } from '../helpers/test-room-factory';
import type { GameRoom } from '../../src/types/game.room.types';

describe('reconnect identity maps', () => {
  it('resolves a bound socket to its stable player id', () => {
    const maps = createIdentityMaps();
    bindSocket(maps, 'socket-1', 'player-abc');
    expect(resolvePlayerId(maps, 'socket-1')).toBe('player-abc');
  });

  it('falls back to socket.id when no binding exists', () => {
    const maps = createIdentityMaps();
    expect(resolvePlayerId(maps, 'socket-1')).toBe('socket-1');
  });

  it('resolves a player id to its current socket id', () => {
    const maps = createIdentityMaps();
    bindSocket(maps, 'socket-1', 'player-abc');
    expect(resolveSocketId(maps, 'player-abc')).toBe('socket-1');
  });

  it('falls back to the player id when no socket is bound', () => {
    const maps = createIdentityMaps();
    expect(resolveSocketId(maps, 'player-abc')).toBe('player-abc');
  });

  it('rebinding a player to a new socket updates the socket id', () => {
    const maps = createIdentityMaps();
    bindSocket(maps, 'socket-1', 'player-abc');
    bindSocket(maps, 'socket-2', 'player-abc');
    expect(resolveSocketId(maps, 'player-abc')).toBe('socket-2');
    // Old socket no longer maps to the player.
    expect(resolvePlayerId(maps, 'socket-1')).toBe('socket-1');
  });

  it('unbindSocket removes the socket→player link', () => {
    const maps = createIdentityMaps();
    bindSocket(maps, 'socket-1', 'player-abc');
    unbindSocket(maps, 'socket-1');
    expect(resolvePlayerId(maps, 'socket-1')).toBe('socket-1');
    expect(resolveSocketId(maps, 'player-abc')).toBe('player-abc');
  });

  it('unbindRoom removes all bindings for a room members', () => {
    const maps = createIdentityMaps();
    bindSocket(maps, 'socket-1', 'player1');
    bindSocket(maps, 'socket-2', 'player2');
    const room = createTestRoom();
    unbindRoom(maps, room);
    expect(resolveSocketId(maps, 'player1')).toBe('player1');
    expect(resolveSocketId(maps, 'player2')).toBe('player2');
    expect(resolvePlayerId(maps, 'socket-1')).toBe('socket-1');
    expect(resolvePlayerId(maps, 'socket-2')).toBe('socket-2');
  });
});

describe('decideRejoin', () => {
  const room: GameRoom = createTestRoom(); // player1Id = 'player1', player2Id = 'player2'

  it('rejoins when the room exists and the player is a member', () => {
    const decision = decideRejoin(() => room, 'player1', room.roomId);
    expect(decision.kind).toBe('rejoin');
    if (decision.kind === 'rejoin') {
      expect(decision.room).toBe(room);
    }
  });

  it('rejoins player2 as a member', () => {
    const decision = decideRejoin(() => room, 'player2', room.roomId);
    expect(decision.kind).toBe('rejoin');
  });

  it('fails with room_destroyed when the room does not exist', () => {
    const decision = decideRejoin(() => undefined, 'player1', 'missing-room');
    expect(decision).toEqual({ kind: 'rejoin_failed', reason: 'room_destroyed' });
  });

  it('fails with not_a_member when the player is not in the room', () => {
    const decision = decideRejoin(() => room, 'stranger', room.roomId);
    expect(decision).toEqual({ kind: 'rejoin_failed', reason: 'not_a_member' });
  });
});