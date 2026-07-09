// src/server/state-store.ts
import type { GameRoom } from '../types/game.room.types';

export interface StateStore {
  getRoom(roomId: string): GameRoom | undefined;
  saveRoom(room: GameRoom): void;
  deleteRoom(roomId: string): void;
  listRooms(): string[];
}

export class InMemoryStore implements StateStore {
  private rooms: Map<string, GameRoom> = new Map();

  getRoom(roomId: string): GameRoom | undefined {
    return this.rooms.get(roomId);
  }

  saveRoom(room: GameRoom): void {
    this.rooms.set(room.roomId, room);
  }

  deleteRoom(roomId: string): void {
    this.rooms.delete(roomId);
  }

  listRooms(): string[] {
    return Array.from(this.rooms.keys());
  }
}