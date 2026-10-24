// src/server/reconnect.ts
// Pure, testable logic for the reconnect-resilience feature.
//
// The server uses a STABLE player id (client-generated, sent via the `auth`
// handshake) as PlayerId, NOT socket.id — socket.id changes on every reconnect.
// This module owns the identity-remap tables and the rejoin decision so they
// can be unit-tested without spinning up a Socket.IO server.

import type { GameRoom, PlayerId } from '../types/game.room.types';

/** socket.id → stable PlayerId. Used for action routing. */
export type IdentityMaps = {
  playerIdBySocket: Map<string, PlayerId>;
  socketIdByPlayer: Map<PlayerId, string>;
};

export function createIdentityMaps(): IdentityMaps {
  return {
    playerIdBySocket: new Map<string, PlayerId>(),
    socketIdByPlayer: new Map<PlayerId, string>(),
  };
}

/** Resolve the stable player id for a socket (falls back to socket.id). */
export function resolvePlayerId(maps: IdentityMaps, socketId: string): PlayerId {
  return maps.playerIdBySocket.get(socketId) ?? (socketId as PlayerId);
}

/** Resolve the current socket id for a stable player id (falls back to the id itself). */
export function resolveSocketId(maps: IdentityMaps, playerId: PlayerId): string {
  return maps.socketIdByPlayer.get(playerId) ?? playerId;
}

/** Register a socket→player binding. */
export function bindSocket(maps: IdentityMaps, socketId: string, playerId: PlayerId): void {
  // If this player was previously bound to a different socket, remove that
  // stale link (e.g. a reconnect with a new socket.id).
  const oldSocketId = maps.socketIdByPlayer.get(playerId);
  if (oldSocketId && oldSocketId !== socketId) {
    maps.playerIdBySocket.delete(oldSocketId);
  }
  maps.playerIdBySocket.set(socketId, playerId);
  maps.socketIdByPlayer.set(playerId, socketId);
}

/** Remove a socket→player binding (on disconnect). */
export function unbindSocket(maps: IdentityMaps, socketId: string): void {
  const playerId = maps.playerIdBySocket.get(socketId);
  maps.playerIdBySocket.delete(socketId);
  if (playerId && maps.socketIdByPlayer.get(playerId) === socketId) {
    maps.socketIdByPlayer.delete(playerId);
  }
}

/** Remove all bindings for a room's members (on room destroy). */
export function unbindRoom(maps: IdentityMaps, room: GameRoom): void {
  for (const playerId of [room.player1Id, room.player2Id]) {
    if (!playerId) continue;
    const socketId = maps.socketIdByPlayer.get(playerId);
    if (socketId) {
      maps.playerIdBySocket.delete(socketId);
      maps.socketIdByPlayer.delete(playerId);
    }
  }
}

export type RejoinDecision =
  | { kind: 'rejoin'; room: GameRoom }
  | { kind: 'rejoin_failed'; reason: 'room_destroyed' | 'not_a_member' };

/**
 * Decide what to do when a socket connects with a stable playerId + roomId.
 * - Room exists and player is a member → rejoin.
 * - Room exists but player is not a member → rejoin_failed 'not_a_member'.
 * - Room does not exist → rejoin_failed 'room_destroyed'.
 */
export function decideRejoin(
  getRoom: (roomId: string) => GameRoom | undefined,
  playerId: PlayerId,
  roomId: string,
): RejoinDecision {
  const room = getRoom(roomId);
  if (!room) return { kind: 'rejoin_failed', reason: 'room_destroyed' };
  const isMember = room.player1Id === playerId || room.player2Id === playerId;
  if (!isMember) return { kind: 'rejoin_failed', reason: 'not_a_member' };
  return { kind: 'rejoin', room };
}