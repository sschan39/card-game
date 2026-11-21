import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoPassCoordinator } from '@server/rooms/auto-pass';
import { RoomRuntime } from '@server/rooms/room-runtime';
import { InMemoryStore } from '@server/rooms/state-store';
import { AutoPassRequestSchema } from '@card-game/protocol';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { parseCardDefinition } from '@library/card-parser';
import { creature } from '../helpers/combat-fixture';

const disposables: { dispose(): void }[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100000); });
afterEach(() => { disposables.splice(0).forEach(value => value.dispose()); vi.restoreAllMocks(); vi.useRealTimers(); });
function coordinator() {
  const state = { position: { room: createTestRoom(), socketId: 's1' } as any, eligible: true };
  const pass = vi.fn(), changed = vi.fn();
  const auto = new AutoPassCoordinator({ position: () => state.position, eligible: () => state.eligible, pass, changed }, 5000);
  disposables.push(auto); return { auto, state, pass, changed };
}
function runtime(delayMs = 5000) {
  const store = new InMemoryStore(), published = vi.fn(), changed = vi.fn();
  const engine = new RoomRuntime(store, { publishDelta: published, roomDestroyed: vi.fn(), autoPassChanged: changed }, undefined, {}, undefined, delayMs);
  disposables.push(engine);
  const room = createTestRoom({ roomId: 'test-auto', phase: 'stateMainPhase' }); fillTestLibraries(room);
  room.players.player1.hand = []; room.players.player2.hand = []; room.battlefield = [];
  engine.installTestRoom(room, () => 0.2);
  engine.connect('s1', 'player1', room.roomId); engine.connect('s2', 'player2', room.roomId);
  return { engine, store, roomId: room.roomId, published, changed };
}
describe('delayed auto-pass scheduling', () => {
  it('is off by default and waits five seconds before every pass', () => {
    const { auto, pass } = coordinator(); auto.refresh('room'); vi.advanceTimersByTime(10000); expect(pass).not.toHaveBeenCalled();
    auto.setEnabled('s1', 'room', true);
    vi.advanceTimersByTime(4999); expect(pass).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(pass).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4999); expect(pass).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1); expect(pass).toHaveBeenCalledTimes(2);
  });
  it('acknowledges the deadline without resetting on repeated packets or another player’s toggle', () => {
    const { auto, pass, changed } = coordinator(); auto.setEnabled('s1', 'room', true);
    expect(changed).toHaveBeenLastCalledWith('s1', expect.objectContaining({ enabled: true, passAt: 105000, serverTime: 100000 }));
    vi.advanceTimersByTime(4000); auto.setEnabled('s1', 'room', true); auto.setEnabled('s2', 'room', true);
    vi.advanceTimersByTime(1000); expect(pass).toHaveBeenCalledTimes(1);
  });
  it.each(['disabled', 'ineligible', 'disconnected', 'disposed'])('cancels the timer when %s', reason => {
    const { auto, state, pass } = coordinator(); auto.setEnabled('s1', 'room', true); vi.advanceTimersByTime(4000);
    if (reason === 'disabled') auto.setEnabled('s1', 'room', false);
    if (reason === 'ineligible') { state.eligible = false; auto.refresh('room'); }
    if (reason === 'disconnected') auto.forgetSocket('s1');
    if (reason === 'disposed') auto.dispose();
    vi.advanceTimersByTime(10000); expect(pass).not.toHaveBeenCalled();
  });
  it('rechecks current state at expiry even if no refresh notification was received', () => {
    const { auto, state, pass } = coordinator(); auto.setEnabled('s1', 'room', true);
    vi.advanceTimersByTime(4000); state.eligible = false; vi.advanceTimersByTime(1000);
    expect(pass).not.toHaveBeenCalled();
  });
  it('starts a full new delay after the position changes', () => {
    const { auto, state, pass } = coordinator(); auto.setEnabled('s1', 'room', true); vi.advanceTimersByTime(4000);
    state.position = { ...state.position, room: { ...state.position.room } }; auto.refresh('room');
    vi.advanceTimersByTime(4999); expect(pass).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(pass).toHaveBeenCalledTimes(1);
  });
  it('treats an unannounced changed position as a restart rather than a stale pass', () => {
    const { auto, state, pass } = coordinator(); auto.setEnabled('s1', 'room', true); vi.advanceTimersByTime(4000);
    state.position = { ...state.position, room: { ...state.position.room } }; vi.advanceTimersByTime(1000);
    expect(pass).not.toHaveBeenCalled(); vi.advanceTimersByTime(5000); expect(pass).toHaveBeenCalledTimes(1);
  });
});
describe('authoritative auto-pass integration', () => {
  it('immediately yields empty priority, then lets the player respond in Auto or wait in Full Control', () => {
    const { engine, roomId, store, published } = runtime(0);
    const initial = store.getRoom(roomId)!;
    const response = creature('response', 'player2');
    response.state.zone = 'hand';
    response.blueprint = parseCardDefinition({ schemaVersion: 1, id: 'response', manaCost: '{0}',
      castRequirements: { speed: 'instant' }, onCastEffects: [{ action: 'DRAW', params: { amount: 1 } }] });
    initial.players.player2.hand = [response];
    engine.setAutoPass('s1', roomId, true);
    engine.setAutoPass('s2', roomId, true);
    vi.advanceTimersByTime(10);
    expect(published).toHaveBeenCalledTimes(1);
    expect(store.getRoom(roomId)?.priorityPlayerId).toBe('player2');
    expect(engine.executePlayerAction('s2', { roomId, actionId: 'cast_spell', data: { cardUuid: response.uuid } }).kind).toBe('success');
    engine.setAutoPass('s2', roomId, false);
    const calls = published.mock.calls.length;
    vi.advanceTimersByTime(10);
    expect(published).toHaveBeenCalledTimes(calls);
    expect(store.getRoom(roomId)?.stack).toHaveLength(1);
  });

  it.each([false, true])('passes optional plays for one turn and restores the selected mode (Auto %s)', enabled => {
    const { engine, roomId, store, published, changed } = runtime(0);
    const initial = store.getRoom(roomId)!;
    initial.phase = 'stateEndPhase';
    initial.turnNumber = 5;
    const response = creature('response', 'player1');
    response.state.zone = 'hand';
    response.blueprint = parseCardDefinition({ schemaVersion: 1, id: 'response', castRequirements: { speed: 'instant' } });
    initial.players.player1.hand = [response];
    expect(engine.setAutoPass('s1', roomId, enabled, 4)).toBe(false);
    expect(engine.setAutoPass('s1', roomId, enabled, 5)).toBe(true);
    expect(changed).toHaveBeenLastCalledWith('s1', expect.objectContaining({ untilTurn: 5, enabled }));
    vi.advanceTimersByTime(10);
    expect(published.mock.calls[0][0]).toMatchObject({ playerId: 'player1', action: 'pass_priority' });
    expect(engine.executePlayerAction('s2', { roomId, actionId: 'pass_priority', data: {} }).kind).toBe('success');
    expect(store.getRoom(roomId)?.turnNumber).toBe(6);
    expect(changed).toHaveBeenLastCalledWith('s1', expect.objectContaining({ enabled, passAt: null }));
    expect(changed.mock.calls.at(-1)?.[1]).not.toHaveProperty('untilTurn');
    expect(engine.setAutoPass('s1', roomId, enabled, 5)).toBe(false);
  });

  it('cancels a turn pass in time to retain priority', () => {
    const { engine, roomId, published } = runtime(0);
    engine.setAutoPass('s1', roomId, false, 0);
    engine.setAutoPass('s1', roomId, false);
    vi.advanceTimersByTime(10);
    expect(published).not.toHaveBeenCalled();
  });

  it.each(['declareAttackersStep', 'declareBlockersStep', 'choice'] as const)('stops even with a turn pass at %s', stop => {
    const { engine, roomId, store, published } = runtime(0);
    const room = store.getRoom(roomId)!;
    if (stop === 'choice') {
      room.pendingChoice = { id: 'n', playerId: 'player1', kind: 'number', prompt: 'X', range: { min: 0 },
        continuation: { type: 'action', actionId: 'cast_spell', field: 'numericBindings', data: {} } };
    } else {
      room.phase = stop;
      room.priorityPlayerId = stop === 'declareAttackersStep' ? 'player1' : 'player2';
    }
    engine.setAutoPass('s1', roomId, false, 0);
    engine.setAutoPass('s2', roomId, false, 0);
    vi.advanceTimersByTime(10);
    expect(published).not.toHaveBeenCalled();
  });
  it('uses normal pass commands and published deltas, with a fresh delay for the other player', () => {
    const { engine, roomId, published, store } = runtime();
    expect(engine.setAutoPass('foreign', roomId, true)).toBe(false);
    engine.setAutoPass('s1', roomId, true); engine.setAutoPass('s2', roomId, true);
    vi.advanceTimersByTime(4999); expect(published).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(published).toHaveBeenCalledTimes(1);
    expect(published.mock.calls[0][0]).toMatchObject({ action: 'pass_priority', playerId: 'player1' });
    expect(store.getRoom(roomId)?.priorityPlayerId).toBe('player2');
    vi.advanceTimersByTime(4999); expect(published).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1); expect(published).toHaveBeenCalledTimes(2);
    expect(published.mock.calls[1][0]).toMatchObject({ action: 'pass_priority', playerId: 'player2' });
  });
  it('restarts the delay after a manual pass instead of firing the old timer', () => {
    const { engine, roomId, published } = runtime(); engine.setAutoPass('s1', roomId, true); engine.setAutoPass('s2', roomId, true);
    vi.advanceTimersByTime(4000);
    expect(engine.executePlayerAction('s1', { roomId, actionId: 'pass_priority', data: {} }).kind).toBe('success');
    expect(published).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4999); expect(published).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1); expect(published).toHaveBeenCalledTimes(2);
  });
  it('does not auto-pass an available action or an unknown query', () => {
    const { engine, roomId, store, published } = runtime();
    const room = store.getRoom(roomId)!; const source = creature('cast', 'player1'); source.state.zone = 'hand';
    source.blueprint = parseCardDefinition({ schemaVersion: 1, id: 'cast', onCastEffects: [{ action: 'DRAW', params: { amount: 1 } }] });
    room.players.player1.hand = [source]; engine.setAutoPass('s1', roomId, true);
    vi.advanceTimersByTime(10000); expect(published).not.toHaveBeenCalled();
    source.blueprint = parseCardDefinition({ schemaVersion: 1, id: 'cast', manaCost: '{X}', numericDeclarations: [{ name: 'X', min: 999 }] });
    engine.setAutoPass('s1', roomId, true); vi.advanceTimersByTime(10000); expect(published).not.toHaveBeenCalled();
  });
  it('cancels when either player disconnects and does not carry preferences across reconnect', () => {
    const { engine, roomId, published } = runtime(); engine.setAutoPass('s1', roomId, true); vi.advanceTimersByTime(4000);
    engine.disconnect('s2'); vi.advanceTimersByTime(2000); expect(published).not.toHaveBeenCalled();
    engine.connect('new-s2', 'player2', roomId); vi.advanceTimersByTime(4999); expect(published).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(published).toHaveBeenCalledTimes(1);
    engine.disconnect('s1'); engine.connect('new-s1', 'player1', roomId);
    vi.advanceTimersByTime(5000); expect(published).toHaveBeenCalledTimes(1);
  });
  it('never answers choices, required declarations or finished matches', () => {
    const { engine, roomId, store, published } = runtime(); const room = store.getRoom(roomId)!;
    room.phase = 'declareAttackersStep'; engine.setAutoPass('s1', roomId, true);
    vi.advanceTimersByTime(5000); expect(published).not.toHaveBeenCalled();
    room.phase = 'stateMainPhase'; room.pendingChoice = { id: 'n', playerId: 'player1', kind: 'number', prompt: 'X', range: { min: 0 },
      continuation: { type: 'action', actionId: 'cast_spell', field: 'numericBindings', data: {} } };
    engine.setAutoPass('s1', roomId, true); vi.advanceTimersByTime(5000); expect(published).not.toHaveBeenCalled();
    engine.executePlayerAction('s1', { roomId, actionId: 'concede', data: {} }); published.mockClear();
    vi.advanceTimersByTime(10000); expect(published).not.toHaveBeenCalled();
  });
  it('cancels and releases preferences when a player explicitly leaves', () => {
    const { engine, roomId, published } = runtime(); engine.setAutoPass('s1', roomId, true); vi.advanceTimersByTime(4000);
    engine.leaveRoom('s1', roomId); published.mockClear(); vi.advanceTimersByTime(10000); expect(published).not.toHaveBeenCalled();
  });
  it.each(['rejected', 'exception'])('disables safely after a background pass is %s', failure => {
    const { engine, roomId, changed } = runtime();
    vi.spyOn(engine, 'executePlayerAction').mockImplementation(() => {
      if (failure === 'exception') throw new Error('unexpected');
      return { kind: 'error', message: 'rejected', action: 'pass_priority', commandId: 'test' };
    });
    engine.setAutoPass('s1', roomId, true);
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
    expect(changed).toHaveBeenLastCalledWith('s1', expect.objectContaining({ enabled: false, passAt: null }));
    vi.advanceTimersByTime(10000); expect(engine.executePlayerAction).toHaveBeenCalledTimes(1);
  });
  it('strictly validates toggle messages without accepting client timers or actor IDs', () => {
    expect(AutoPassRequestSchema.safeParse({ protocolVersion: 1, roomId: 'room', enabled: true }).success).toBe(true);
    for (const extra of [{ enabled: 'yes' }, { passAt: 0 }, { playerId: 'other' }, { protocolVersion: 2 }]) {
      expect(AutoPassRequestSchema.safeParse({ protocolVersion: 1, roomId: 'room', enabled: true, ...extra }).success).toBe(false);
    }
  });
});
