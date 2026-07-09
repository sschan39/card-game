import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStore, type StateStore } from '../../src/server/state-store';
import type { GameRoom } from '../../src/types/game.room.types';
import { createTestRoom } from '../helpers/test-room-factory';

describe('InMemoryStore', () => {
  let store: StateStore;
  let room: GameRoom;

  beforeEach(() => {
    store = new InMemoryStore();
    room = createTestRoom();
  });

  it('should save and retrieve a room', () => {
    store.saveRoom(room);
    const retrieved = store.getRoom(room.roomId);
    expect(retrieved).toBeDefined();
    expect(retrieved!.roomId).toBe(room.roomId);
  });

  it('should return undefined for unknown room', () => {
    expect(store.getRoom('nonexistent')).toBeUndefined();
  });

  it('should delete a room', () => {
    store.saveRoom(room);
    store.deleteRoom(room.roomId);
    expect(store.getRoom(room.roomId)).toBeUndefined();
  });

  it('should list all room IDs', () => {
    const room2 = createTestRoom();
    store.saveRoom(room);
    store.saveRoom(room2);
    const ids = store.listRooms();
    expect(ids).toHaveLength(2);
    expect(ids).toContain(room.roomId);
    expect(ids).toContain(room2.roomId);
  });

  it('should overwrite room on save with same ID', () => {
    store.saveRoom(room);
    room.currentPhase = 'stateBattlePhase';
    store.saveRoom(room);
    const retrieved = store.getRoom(room.roomId);
    expect(retrieved!.currentPhase).toBe('stateBattlePhase');
  });

  it('should not throw when deleting nonexistent room', () => {
    expect(() => store.deleteRoom('nonexistent')).not.toThrow();
  });
});