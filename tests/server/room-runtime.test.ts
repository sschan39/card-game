import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gameConfig } from '@config';
import { GameEngine } from '@engine/game-engine';
import { serverLogger } from '@rules/game-logger';
import type { RuntimeContext } from '@rules/runtime-context';
import { InMemoryStore } from '@server/rooms/state-store';
import { ACTION_IDS } from '@shared/action.ids';
import { RoomRuntime, type RoomDeltaRequest, type RoomDestroyedNotice } from '@server/rooms/room-runtime';
import type { RoomSettings } from '@server/config/gameplay';

describe('RoomRuntime', () => {
  let store: InMemoryStore;
  let destroyed: RoomDestroyedNotice[];
  let published: RoomDeltaRequest[];
  let runtime: RoomRuntime;
  let actionLogging: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new InMemoryStore();
    destroyed = [];
    published = [];
    actionLogging = gameConfig.logging.actions;
    runtime = new RoomRuntime(store, {
      publishDelta: request => published.push(request),
      roomDestroyed: notice => destroyed.push(notice),
    });
  });

  afterEach(() => {
    runtime.dispose();
    gameConfig.logging.actions = actionLogging;
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

  function start(roomId: string) {
    expect(runtime.submitRps('socket-1', roomId, 'rock').kind).toBe('pending');
    const result = runtime.submitRps('socket-2', roomId, 'rock');
    if (result.kind !== 'started') throw new Error('Expected match to start');
    return result.room;
  }

  function useRuntime(dependencies: Partial<RuntimeContext>, settings?: () => RoomSettings): void {
    runtime.dispose();
    runtime = new RoomRuntime(store, {
      publishDelta: request => published.push(request),
      roomDestroyed: notice => destroyed.push(notice),
    }, 30_000, dependencies, settings);
  }

  function spyCommandTrace() {
    const info = vi.spyOn(serverLogger, 'info');
    const warn = vi.spyOn(serverLogger, 'warn');
    const withContext = vi.spyOn(serverLogger, 'withContext').mockReturnValue(serverLogger);
    return { info, warn, withContext };
  }

  it('creates, stores, and returns a room', () => {
    const created = runtime.createRoom('socket-1', 'player-1');

    expect(store.getRoom(created.roomId)).toBe(created.room);
    expect(created.room.player1Id).toBe('player-1');
    expect(created.room.status).toBe('waiting');
  });

  it('does not put the creator in the second seat', () => {
    const created = runtime.createRoom('socket-1', 'player-1');
    expect(runtime.joinRoom('socket-1', 'player-1', created.roomId)).toEqual({ kind: 'already_member' });
    expect(store.getRoom(created.roomId)?.player2Id).toBeNull();
  });

  it('uses injected UUIDs for room and fallback command identities', () => {
    const uuid = vi.fn()
      .mockReturnValueOnce('room-1')
      .mockReturnValueOnce('command-1');
    useRuntime({ uuid, random: () => 0 });

    const created = runtime.createRoom('socket-1', 'player-1');
    const missing = runtime.executePlayerAction('socket-1', {
      roomId: 'missing', actionId: ACTION_IDS.passPriority, data: {},
    });

    expect(created.roomId).toBe('room-1');
    expect(missing).toMatchObject({ kind: 'error', commandId: 'command-1' });
  });

  it('does not consume a UUID for a caller-supplied command identity', () => {
    const uuid = vi.fn(() => 'unused');
    useRuntime({ uuid, random: () => 0 });

    runtime.executePlayerAction('socket-1', {
      roomId: 'missing', actionId: ACTION_IDS.passPriority, commandId: 'client-command', data: {},
    });

    expect(uuid).not.toHaveBeenCalled();
  });

  it('shares injected UUID and random capabilities with RPS and deck setup', () => {
    let nextId = 0;
    const random = vi.fn(() => 0);
    useRuntime({ uuid: () => `runtime-${++nextId}`, random }, () => ({
      setup: { ...gameConfig.setup, shuffleDevelopmentDeck: true }, debugMode: gameConfig.debugMode,
    }));
    const { joined } = createAndJoin();

    expect(joined.room.players['player-1'].hand).toEqual([]);
    start(joined.roomId);

    expect(random).toHaveBeenCalledTimes(22);
    expect(Object.values(store.getRoom(joined.roomId)!.players)
      .flatMap(player => [...player.deck, ...player.hand])
      .every(card => card.uuid.startsWith('runtime-'))).toBe(true);
  });

  it('uses injected dependencies when recovering an engine from stored room state', () => {
    const { created } = createAndJoin();
    start(created.roomId);
    let calls = 0;
    useRuntime({ uuid: () => `recovered-${++calls}`, random: () => 0 });
    expect(runtime.connect('socket-1b', 'player-1', created.roomId).kind).toBe('rejoined');
    published = [];

    expect(runtime.executePlayerAction('socket-1b', {
      roomId: created.roomId,
      actionId: ACTION_IDS.passPriority,
      commandId: 'client-command',
      data: {},
    }).kind).toBe('success');

    expect(published.at(-1)?.batches.map(batch => batch.batchId))
      .toEqual(expect.arrayContaining([expect.stringMatching(/^recovered-/)]));
  });

  it('leaves both hands empty while the lobby is picking', () => {
    const { created, joined } = createAndJoin();

    expect(joined.room.status).toBe('waiting');
    expect(joined.room.players['player-1'].hand).toEqual([]);
    expect(joined.room.players['player-2'].hand).toEqual([]);
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
    const { created } = createAndJoin();
    const cardUuid = start(created.roomId).players['player-1'].hand.find(card => !card.blueprint.cardTypes.includes('Land'))!.uuid;

    expect(runtime.getOptions('socket-1', created.roomId, cardUuid, 'hand')).toEqual([
      expect.objectContaining({ actionId: 'cast_spell' }),
    ]);
    expect(runtime.getOptions('socket-1', 'missing', cardUuid, 'hand')).toEqual([]);
    expect(runtime.getOptions('socket-1', created.roomId, 'missing', 'hand')).toEqual([]);
  });

  it('publishes no engine delta for opening picks and logs the resolved starter', () => {
    const { created } = createAndJoin();
    const info = vi.spyOn(serverLogger, 'info');
    const room = start(created.roomId);
    expect(room.status).toBe('playing');
    expect(published).toEqual([]);
    expect(info).toHaveBeenCalledWith('match:started', 'Opening round resolved',
      { roomId: created.roomId, firstPlayerId: 'player-1', picks: ['rock', 'rock'] });
  });

  it('logs received commands with stable-player context and choice details', () => {
    const { created, joined } = createAndJoin();
    const { info, withContext } = spyCommandTrace();
    const data = {
      cardUuid: 'example-card',
      choiceId: 'choice-1',
      number: 2,
      choices: ['one', 'two'],
      attackers: ['attacker-1'],
      assignments: ['assignment-1'],
      allocations: { target: 3, ignored: 0 },
    };

    runtime.executePlayerAction('socket-1', {
      roomId: created.roomId, actionId: ACTION_IDS.passPriority, commandId: 'command-1', data,
    });

    expect(withContext).toHaveBeenCalledWith({
      roomId: created.roomId, commandId: 'command-1', action: ACTION_IDS.passPriority, playerId: 'player-1',
    });
    expect(info).toHaveBeenCalledWith('command:received', 'Player action received', {
      cardUuid: data.cardUuid,
      choiceId: data.choiceId,
      number: 2,
      selected: 2,
      attackers: ['attacker-1'],
      assignments: ['assignment-1'],
      allocationChoices: [{ id: 'target', amount: 3 }],
      allocationTotal: 3,
    });
  });

  it('logs missing-room rejections with command context', () => {
    const { warn, withContext } = spyCommandTrace();

    runtime.executePlayerAction('socket-1', {
      roomId: 'missing', actionId: ACTION_IDS.passPriority, commandId: 'command-1', data: {},
    });

    expect(withContext).toHaveBeenCalledWith({
      roomId: 'missing', commandId: 'command-1', action: ACTION_IDS.passPriority, playerId: 'socket-1',
    });
    expect(warn).toHaveBeenCalledWith('command:rejected', 'Room not found');
  });

  it('keeps RPS resolution diagnostics when action logging is disabled', () => {
    const { created, joined } = createAndJoin();
    gameConfig.logging.actions = false;
    const { info, warn } = spyCommandTrace();

    start(created.roomId);
    runtime.executePlayerAction('socket-1', {
      roomId: 'missing', actionId: ACTION_IDS.passPriority, commandId: 'missing-command', data: {},
    });

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      'match:started', 'Opening round resolved',
      expect.objectContaining({ roomId: created.roomId, firstPlayerId: 'player-1' }),
    );
    expect(info).not.toHaveBeenCalledWith('command:received', expect.anything(), expect.anything());
    expect(warn).not.toHaveBeenCalledWith('command:rejected', 'Room not found');
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns a room-not-found error without publishing', () => {
    const result = runtime.executePlayerAction('socket-1', {
      roomId: 'missing', actionId: ACTION_IDS.passPriority, commandId: 'client-command', data: {},
    });

    expect(result).toEqual({ kind: 'error', message: 'Room not found', commandId: 'client-command', action: ACTION_IDS.passPriority });
    expect(published).toEqual([]);
  });

  it('returns engine validation errors without publishing', () => {
    const { created } = createAndJoin();

    const result = runtime.executePlayerAction('socket-1', {
      roomId: created.roomId, actionId: ACTION_IDS.castSpell, data: { cardUuid: 'missing-card' },
    });

    expect(result).toMatchObject({ kind: 'error', action: ACTION_IDS.castSpell });
    expect(published).toEqual([]);
  });

  it('preserves caller-supplied command ids', () => {
    const { created } = createAndJoin();
    start(created.roomId);

    const result = runtime.executePlayerAction('socket-1', {
      roomId: created.roomId, actionId: ACTION_IDS.passPriority, commandId: 'client-command',
      data: {},
    });

    expect(result).toMatchObject({ kind: 'success', commandId: 'client-command' });
  });

  it('generates command ids when callers omit them', () => {
    const { created } = createAndJoin();
    start(created.roomId);

    const result = runtime.executePlayerAction('socket-1', {
      roomId: created.roomId, actionId: ACTION_IDS.passPriority, data: {},
    });

    expect(result).toMatchObject({ kind: 'success', commandId: expect.any(String) });
  });

  it('resolves delta recipients to current socket ids', () => {
    const { created } = createAndJoin();
    start(created.roomId);
    runtime.disconnect('socket-2');
    expect(runtime.connect('socket-2-new', 'player-2', created.roomId).kind).toBe('rejoined');

    runtime.executePlayerAction('socket-1', {
      roomId: created.roomId, actionId: ACTION_IDS.passPriority, data: {},
    });

    expect(published.at(-1)?.recipients).toEqual(new Map([
      ['player-1', 'socket-1'], ['player-2', 'socket-2-new'],
    ]));
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

  it('ignores a replaced socket disconnect after the player has rejoined', () => {
    const { created } = createAndJoin();

    expect(runtime.connect('socket-1b', 'player-1', created.roomId).kind).toBe('rejoined');
    runtime.disconnect('socket-1');
    vi.advanceTimersByTime(30_000);

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
    const { created } = createAndJoin();
    const cardUuid = start(created.roomId).players['player-2'].hand[0].uuid;
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
