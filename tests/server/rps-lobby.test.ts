import { expect, it } from 'vitest';
import { RoomRuntime } from '@server/rooms/room-runtime';
import { InMemoryStore } from '@server/rooms/state-store';
import { gameConfig } from '@config';

it.each([
  ['rock', 'scissors', 'one'],
  ['rock', 'paper', 'two'],
  ['rock', 'rock', 'one'],
] as const)('keeps lobby picks out of game state and starts once: %s / %s', (first, second, winner) => {
  const store = new InMemoryStore();
  const runtime = new RoomRuntime(store, { publishDelta() {}, roomDestroyed() {} });
  try {
    const { roomId } = runtime.createRoom('a', 'one');
    const joined = runtime.joinRoom('b', 'two', roomId);
    expect(joined.kind).toBe('joined');
    expect(store.getRoom(roomId)?.status).toBe('waiting');
    expect(runtime.submitRps('a', roomId, first).kind).toBe('pending');
    expect(runtime.lobbyView(roomId, 'two')).toEqual({ myPick: null, opponentReady: true });
    expect(runtime.lobbyView(roomId, 'one')).toEqual({ myPick: first, opponentReady: false });
    expect(runtime.submitRps('a', roomId, second).kind).toBe('error');
    expect(runtime.submitRps('other', roomId, second).kind).toBe('error');
    runtime.disconnect('a', true);
    expect(runtime.connect('rejoined', 'one', roomId).kind).toBe('rejoined');
    expect(runtime.lobbyView(roomId, 'one')?.myPick).toBe(first);
    const started = runtime.submitRps('b', roomId, second);
    expect(started).toMatchObject({ kind: 'started', firstPlayerId: winner, picks: [first, second] });
    const room = store.getRoom(roomId)!;
    expect(room.status).toBe('playing');
    expect(room.activeTurnPlayerId).toBe(winner);
    expect(room.priorityPlayerId).toBe(winner);
    expect(room.turnNumber).toBe(1);
    expect(room).not.toHaveProperty('rpsState');
    for (const player of Object.values(room.players)) {
      expect(player.hand.length).toBe(gameConfig.setup.openingHandSize);
      expect(player.graveyard).toEqual([]);
    }
    expect(runtime.lobbyView(roomId, 'one')).toBeUndefined();
    expect(runtime.submitRps('b', roomId, second).kind).toBe('error');
    expect(store.getRoom(roomId)).toBe(room);
  } finally { runtime.dispose(); }
});


it('closes a lobby on explicit departure without a match or a concession', () => {
  const store = new InMemoryStore(), closed: string[] = [];
  const runtime = new RoomRuntime(store, { publishDelta() { throw new Error('Unexpected match delta'); }, roomDestroyed(notice) { closed.push(notice.roomId); } });
  try {
    const { roomId } = runtime.createRoom('a', 'one');
    runtime.joinRoom('b', 'two', roomId);
    runtime.submitRps('a', roomId, 'rock');
    expect(runtime.leaveRoom('b', roomId)).toEqual({ playerId: 'two' });
    expect(closed).toEqual([roomId]);
    expect(runtime.lobbyView(roomId, 'one')).toBeUndefined();
    expect(store.getRoom(roomId)).toBeUndefined();
    expect(runtime.submitRps('a', roomId, 'paper').kind).toBe('error');
  } finally { runtime.dispose(); }
});
