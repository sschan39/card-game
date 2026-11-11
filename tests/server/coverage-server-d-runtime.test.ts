import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameEngine } from '@card-game/engine/engine/game-engine';
import { RoomRuntime } from '@server/rooms/room-runtime';
import { InMemoryStore } from '@server/rooms/state-store';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import type { GameRoom } from '@shared/game.room.types';
import type { PlayerState } from '@shared/game.player.types';

const runtimes: RoomRuntime[] = [];
afterEach(() => { runtimes.splice(0).forEach(runtime => runtime.dispose()); vi.restoreAllMocks(); vi.useRealTimers(); });

function setup() {
  const store = new InMemoryStore(), published = vi.fn(), destroyed = vi.fn();
  const runtime = new RoomRuntime(store, { publishDelta: published, roomDestroyed: destroyed });
  runtimes.push(runtime);
  return { store, runtime, published, destroyed };
}

describe('lab test room lifecycle', () => {
  it('installs, exposes and removes lab rooms while rejecting duplicate or unknown ids', () => {
    const { store, runtime } = setup(), room = createTestRoom({ roomId: 'lab-room' });
    runtime.installTestRoom(room, () => 0.5);
    expect(runtime.isTestRoom('lab-room')).toBe(true); expect(runtime.testRoom('lab-room')).toBe(room);
    expect(runtime.isTestRoom('other-room')).toBe(false); expect(runtime.testRoom('other-room')).toBeUndefined();
    expect(() => runtime.installTestRoom(room, () => 0.5)).toThrow('Room already exists');
    expect(() => runtime.removeTestRoom('other-room')).toThrow('Not a test room');
    runtime.removeTestRoom('lab-room');
    expect(store.getRoom('lab-room')).toBeUndefined(); expect(runtime.isTestRoom('lab-room')).toBe(false);
  });

  it('rolls back a lab room whose engine cannot start', () => {
    const { store, runtime } = setup();
    const broken = { ...createTestRoom({ roomId: 'broken-lab' }), pendingTriggers: {} } as unknown as GameRoom;
    expect(() => runtime.installTestRoom(broken, () => 0.5)).toThrow();
    expect(store.getRoom('broken-lab')).toBeUndefined(); expect(runtime.isTestRoom('broken-lab')).toBe(false);
  });

  it('destroys a lab room whose state entry already vanished', () => {
    const { store, runtime } = setup();
    runtime.installTestRoom(createTestRoom({ roomId: 'vanish-lab' }), () => 0.5);
    store.deleteRoom('vanish-lab');
    runtime.removeTestRoom('vanish-lab');
    expect(runtime.isTestRoom('vanish-lab')).toBe(false);
  });
});

describe('socket identities, exits and disappearance', () => {
  it('derives player identity from the socket when no account seat is supplied', () => {
    const { store, runtime } = setup(), created = runtime.createRoom('socket-creator');
    expect(created.playerId).toBe('socket-creator');
    const joined = runtime.joinRoom('socket-guest', undefined, created.roomId);
    expect(joined).toMatchObject({ kind: 'joined', playerId: 'socket-guest' });
    expect(store.getRoom(created.roomId)?.player2Id).toBe('socket-guest');
  });

  it('ignores exits for rooms that no longer exist and keeps the seat when conceding fails', () => {
    const { store, runtime } = setup(), created = runtime.createRoom('s1', 'p1');
    store.deleteRoom(created.roomId);
    expect(runtime.leaveRoom('s1', created.roomId)).toBeUndefined();
    const match = runtime.createRoom('s3', 'p3'); runtime.joinRoom('s4', 'p4', match.roomId);
    vi.spyOn(runtime, 'executePlayerAction').mockReturnValue({ kind: 'error', message: 'rejected', action: 'concede', commandId: 'command' });
    expect(runtime.leaveRoom('s3', match.roomId)).toBeUndefined();
    expect(runtime.currentRoom('s3')).toBe(match.roomId);
  });

  it('schedules destruction when the last socket leaves a live match', () => {
    vi.useFakeTimers();
    const { store, runtime, destroyed } = setup(), created = runtime.createRoom('s1', 'p1');
    runtime.joinRoom('s2', 'p2', created.roomId);
    runtime.disconnect('s2');
    expect(runtime.leaveRoom('s1', created.roomId)).toEqual({ playerId: 'p1' });
    expect(store.getRoom(created.roomId)).toBeDefined();
    vi.advanceTimersByTime(30_000);
    expect(store.getRoom(created.roomId)).toBeUndefined();
    expect(destroyed).toHaveBeenCalledWith(expect.objectContaining({ roomId: created.roomId }));
  });

  it('forgets sockets bound to rooms that are already gone', () => {
    const { store, runtime } = setup(), created = runtime.createRoom('s1');
    store.deleteRoom(created.roomId);
    runtime.disconnect('s1');
    expect(runtime.currentRoom('s1')).toBeUndefined();
  });
});

describe('engine creation and command results', () => {
  it('reports no_rejoin without both stored identities', () => {
    const { runtime } = setup();
    expect(runtime.connect('s1')).toEqual({ kind: 'no_rejoin' });
    expect(runtime.connect('s1', 'player1')).toEqual({ kind: 'no_rejoin' });
  });

  it('refuses to recreate an engine for a room that an external writer removed', () => {
    class RacingStore extends InMemoryStore {
      private lookups = 0;
      override getRoom(roomId: string) {
        const room = super.getRoom(roomId);
        this.lookups += 1;
        return this.lookups === 2 ? undefined : room;
      }
    }
    const store = new RacingStore();
    const runtime = new RoomRuntime(store, { publishDelta: vi.fn(), roomDestroyed: vi.fn() });
    runtimes.push(runtime);
    store.saveRoom(createTestRoom({ roomId: 'racing-room' }));
    expect(() => runtime.connect('s1', 'player1', 'racing-room')).toThrow('Room racing-room not found');
  });

  it('skips delta publication when the engine reports success without mutations', () => {
    const { runtime, published } = setup(), created = runtime.createRoom('s1');
    vi.spyOn(GameEngine.prototype, 'executePlayerAction').mockReturnValueOnce({ success: true } as never)
      .mockReturnValueOnce({ success: true, mutations: [] });
    const packet = { roomId: created.roomId, actionId: 'pass_priority', data: {} };
    expect(runtime.executePlayerAction('s1', packet)).toMatchObject({ kind: 'success' });
    expect(runtime.executePlayerAction('s1', packet)).toMatchObject({ kind: 'success' });
    expect(published).not.toHaveBeenCalled();
  });
});

describe('auto-pass legality failures', () => {
  it('keeps auto-pass off when the legality query throws on a broken room', () => {
    vi.useFakeTimers();
    const { runtime, published } = setup(), room = createTestRoom({ roomId: 'auto-query-failure' });
    fillTestLibraries(room);
    runtime.installTestRoom(room, () => 0.5);
    runtime.connect('s1', 'player1', room.roomId); runtime.connect('s2', 'player2', room.roomId);
    room.players.player1 = undefined as unknown as PlayerState;
    expect(runtime.setAutoPass('s1', room.roomId, true)).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(published).not.toHaveBeenCalled();
  });
});
