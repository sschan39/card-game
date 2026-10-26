// src/server/state-store.ts
import type { GameRoom } from '@card-game/engine/types/game.room.types';
import { InMemoryAccountStore, type AccountRepository } from '../auth/account-store';

export interface StateStore {
  getRoom(roomId: string): GameRoom | undefined;
  saveRoom(room: GameRoom): void;
  deleteRoom(roomId: string): void;
  listRooms(): string[];
}

export interface ServerStateStore extends StateStore { readonly auth: AccountRepository }

export class InMemoryStore implements ServerStateStore {
  constructor(readonly auth: AccountRepository = new InMemoryAccountStore()) {}
  private rooms: Map<string, GameRoom> = new Map();

  getRoom(roomId: string): GameRoom | undefined {
    return this.rooms.get(roomId);
  }

  saveRoom(room: GameRoom): void {
    this.rooms.set(room.roomId, room);
  }

  deleteRoom(roomId: string): void {
    this.rooms.delete(roomId);
    this.auth.deleteRoomSeats(roomId);
  }

  listRooms(): string[] {
    return Array.from(this.rooms.keys());
  }
}
