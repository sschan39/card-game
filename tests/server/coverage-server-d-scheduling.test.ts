import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoPassCoordinator } from '@server/rooms/auto-pass';
import { bindSocket, createIdentityMaps, resolvePlayerId, resolveSocketId, unbindRoom } from '@server/rooms/reconnect';
import { createTestRoom } from '../helpers/test-room-factory';
import type { GameRoom } from '@shared/game.room.types';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('reconnect identity maps for partially seated rooms', () => {
  it('skips members without a live socket while unbinding', () => {
    const maps = createIdentityMaps();
    bindSocket(maps, 'socket-1', 'player1');
    unbindRoom(maps, createTestRoom());
    expect(resolveSocketId(maps, 'player1')).toBe('player1'); expect(resolvePlayerId(maps, 'socket-1')).toBe('socket-1');
  });

  it('leaves unseated members and unknown sockets untouched while unbinding a room', () => {
    const maps = createIdentityMaps();
    bindSocket(maps, 'socket-1', 'player1'); bindSocket(maps, 'socket-2', 'player2');
    unbindRoom(maps, { ...createTestRoom(), player2Id: null });
    expect(resolveSocketId(maps, 'player2')).toBe('socket-2'); expect(resolvePlayerId(maps, 'socket-1')).toBe('socket-1');
    unbindRoom(maps, { ...createTestRoom(), player1Id: null as unknown as string, player2Id: null } as GameRoom);
    expect(resolveSocketId(maps, 'player2')).toBe('socket-2');
    expect(resolvePlayerId(maps, 'socket-2')).toBe('player2');
  });
});

describe('auto-pass timer ownership', () => {
  it('ignores a stale timer that no longer owns the room schedule', () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    const state = { position: { room: createTestRoom(), socketId: 's1' }, eligible: true };
    const pass = vi.fn(), changed = vi.fn();
    const auto = new AutoPassCoordinator({ position: () => state.position, eligible: () => state.eligible, pass, changed });
    try {
      auto.setEnabled('s1', 'room', true);
      // Simulate a timer whose cancellation raced: the callback stays queued but the schedule is replaced.
      const clear = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined);
      auto.cancel('room'); auto.refresh('room');
      clear.mockRestore();
      vi.advanceTimersByTime(5000);
      expect(pass).toHaveBeenCalledTimes(1);
      expect(changed.mock.calls.map(([, status]) => status.passAt)).toContain(null);
    } finally { auto.dispose(); }
  });
});
