import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { InMemoryStore } from '../../src/server/state-store';
import { RoomRuntime, type RoomDestroyedNotice } from '../../src/server/room-runtime';

describe('RoomRuntime', () => {
  let store: InMemoryStore;
  let destroyed: RoomDestroyedNotice[];
  let runtime: RoomRuntime;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new InMemoryStore();
    destroyed = [];
    runtime = new RoomRuntime(store, {
      publishDelta: vi.fn(),
      roomDestroyed: notice => destroyed.push(notice),
    });
  });

  afterEach(() => {
    runtime.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function createAndJoin() {
    const created = runtime.createRoom('socket-1', 'player-1');
    const joined = runtime.joinRoom('socket-2', 'player-2', created.roomId);
    expect(joined.kind).toBe('joined');
    if (joined.kind !== 'joined') throw new Error('Expected joined room');
    return { created, joined };
  }

  it('creates, stores, and returns a room', () => {
    const created = runtime.createRoom('socket-1', 'player-1');

    expect(store.getRoom(created.roomId)).toBe(created.room);
    expect(created.room.player1Id).toBe('player-1');
    expect(created.room.status).toBe('waiting');
  });

  it('joins with exactly rock, paper, and scissors for both players in RPS status', () => {
    const { created, joined } = createAndJoin();

    expect(joined.room.status).toBe('RPS');
    expect(joined.room.players['player-1'].hand.map(card => card.blueprint.id)).toEqual(['rock', 'paper', 'scissors']);
    expect(joined.room.players['player-2'].hand.map(card => card.blueprint.id)).toEqual(['rock', 'paper', 'scissors']);
    expect(store.getRoom(created.roomId)).toBe(joined.room);
  });

  it('reports not found and full room join outcomes', () => {
    expect(runtime.joinRoom('socket-2', 'player-2', 'missing')).toEqual({ kind: 'not_found' });
    const created = runtime.createRoom('socket-1', 'player-1');
    runtime.joinRoom('socket-2', 'player-2', created.roomId);

    expect(runtime.joinRoom('socket-3', 'player-3', created.roomId)).toEqual({ kind: 'full' });
  });

  it('rejoins valid members and distinguishes destroyed and non-member rooms', () => {
    const { created } = createAndJoin();

    runtime.disconnect('socket-1');
    expect(runtime.connect('socket-1b', 'player-1', created.roomId)).toMatchObject({
      kind: 'rejoined', roomId: created.roomId, playerId: 'player-1',
    });
    expect(runtime.connect('socket-stranger', 'stranger', created.roomId)).toEqual({ kind: 'rejoin_failed', reason: 'not_a_member' });

    runtime.disconnect('socket-1b');
    runtime.disconnect('socket-2');
    vi.advanceTimersByTime(30_000);
    expect(runtime.connect('socket-late', 'player-1', created.roomId)).toEqual({ kind: 'rejoin_failed', reason: 'room_destroyed' });
  });

  it('returns real options for a valid card query and none for invalid queries', () => {
    const { joined, created } = createAndJoin();
    const cardUuid = joined.room.players['player-1'].hand[0].uuid;

    expect(runtime.getOptions('socket-1', created.roomId, cardUuid, 'hand')).toEqual([
      expect.objectContaining({ actionId: 'cast_spell' }),
    ]);
    expect(runtime.getOptions('socket-1', 'missing', cardUuid, 'hand')).toEqual([]);
    expect(runtime.getOptions('socket-1', created.roomId, 'missing', 'hand')).toEqual([]);
  });

  it('immediately destroys an unjoined room when its creator disconnects', () => {
    const created = runtime.createRoom('socket-1', 'player-1');

    runtime.disconnect('socket-1');

    expect(store.getRoom(created.roomId)).toBeUndefined();
    expect(destroyed).toEqual([{ roomId: created.roomId, socketIds: [] }]);
  });

  it('destroys after 30 seconds when another player remains', () => {
    const { created } = createAndJoin();

    runtime.disconnect('socket-1');
    vi.advanceTimersByTime(29_999);
    expect(store.getRoom(created.roomId)).toBeDefined();
    vi.advanceTimersByTime(1);

    expect(store.getRoom(created.roomId)).toBeUndefined();
    expect(destroyed).toEqual([{ roomId: created.roomId, socketIds: ['socket-2'] }]);
  });

  it('cancels delayed destruction when a member rejoins', () => {
    const { created } = createAndJoin();

    runtime.disconnect('socket-1');
    vi.advanceTimersByTime(29_999);
    expect(runtime.connect('socket-1b', 'player-1', created.roomId).kind).toBe('rejoined');
    vi.advanceTimersByTime(1);

    expect(store.getRoom(created.roomId)).toBeDefined();
    expect(destroyed).toEqual([]);
  });

  it('disposes the creation engine when joining replaces it', () => {
    const dispose = vi.spyOn(GameEngine.prototype, 'dispose');
    const created = runtime.createRoom('socket-1', 'player-1');

    runtime.joinRoom('socket-2', 'player-2', created.roomId);

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('clears timers and disposes retained engines exactly once when disposed repeatedly', () => {
    const dispose = vi.spyOn(GameEngine.prototype, 'dispose');
    const clearTimeout = vi.spyOn(globalThis, 'clearTimeout');
    const { created, joined } = createAndJoin();
    const cardUuid = joined.room.players['player-2'].hand[0].uuid;
    runtime.disconnect('socket-1');
    expect(runtime.getOptions('socket-2', created.roomId, cardUuid, 'hand')).not.toEqual([]);

    runtime.dispose();
    runtime.dispose();

    expect(clearTimeout).toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(store.getRoom(created.roomId)).toBeDefined();
    expect(runtime.getOptions('socket-2', created.roomId, cardUuid, 'hand')).toEqual([]);
  });
});
