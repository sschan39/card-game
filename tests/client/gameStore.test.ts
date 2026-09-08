import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../../src/client/store/gameStore';
import { createTestRoom } from '../helpers/test-room-factory';

// Minimal sessionStorage mock (vitest runs in a node environment by default).
function createSessionStorageMock(): Storage {
  let data: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(data).length;
    },
    clear: () => {
      data = {};
    },
    getItem: (key: string) => (key in data ? data[key] : null),
    key: (index: number) => Object.keys(data)[index] ?? null,
    removeItem: (key: string) => {
      delete data[key];
    },
    setItem: (key: string, value: string) => {
      data[key] = String(value);
    },
  } as Storage;
}

describe('gameStore session persistence', () => {
  beforeEach(() => {
    (globalThis as any).sessionStorage = createSessionStorageMock();
    useGameStore.setState({
      room: null,
      roomId: null,
      myPlayerId: null,
      contextMenu: null,
      targeting: null,
      pendingCard: null,
      error: null,
      log: [],
    });
  });

  it('setRoomId persists the room id to sessionStorage', () => {
    useGameStore.getState().setRoomId('room-123');
    expect(useGameStore.getState().roomId).toBe('room-123');
    expect(sessionStorage.getItem('cardgame.roomId')).toBe('room-123');
  });

  it('setMyPlayerId sets the player id in the store', () => {
    useGameStore.getState().setMyPlayerId('player-abc');
    expect(useGameStore.getState().myPlayerId).toBe('player-abc');
  });

  it('clearSession clears the store and sessionStorage', () => {
    const room = createTestRoom();
    useGameStore.getState().setRoom(room);
    useGameStore.getState().setRoomId('room-123');
    useGameStore.getState().setMyPlayerId('player-abc');
    useGameStore.getState().setError('boom');

    useGameStore.getState().clearSession();

    const s = useGameStore.getState();
    expect(s.room).toBeNull();
    expect(s.roomId).toBeNull();
    expect(s.myPlayerId).toBeNull();
    expect(s.error).toBeNull();
    expect(sessionStorage.getItem('cardgame.roomId')).toBeNull();
  });
});