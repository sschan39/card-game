import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { handlers, disconnect, emit } = vi.hoisted(() => ({
  handlers: new Map<string, (data: any) => void>(), disconnect: vi.fn(), emit: vi.fn(),
}));
vi.mock('socket.io-client', () => ({ io: () => ({ on: (event: string, handler: (data: any) => void) => handlers.set(event, handler), disconnect, emit }) }));
import { recoverBoard } from '@client/socket';
import { useGameStore } from '@client/store/gameStore';
import { clientLogger } from '@client/logger';
import { clientFlags as gameConfig } from '@client/config';
import { useAuthStore } from '@client/auth-state';
import { createTestRoom } from '../helpers/client-view-fixture';
import type { ViewDelta } from '@card-game/protocol';
afterEach(() => vi.restoreAllMocks());
describe('socket rejection feedback', () => {
  it('shows correlated errors even when their console trace is switched off', () => {
    const original = gameConfig.logging.actions; gameConfig.logging.actions = false;
    try {
      const warn = vi.spyOn(clientLogger, 'warn');
      handlers.get('error')!({ protocolVersion: 1, message: 'Not your priority', action: 'choose', commandId: 'c' });
      expect(useGameStore.getState().error).toBe('Not your priority'); expect(warn).not.toHaveBeenCalled();
    } finally { gameConfig.logging.actions = original; }
  });
  it('keeps transport failures visible independently of normal tracing', () => {
    const error = vi.spyOn(clientLogger, 'error');
    handlers.get('connect_error')!(new Error('offline'));
    expect(error).toHaveBeenCalledWith('connection:failed', 'offline');
    expect(useGameStore.getState().error).toContain('offline');
  });
  it('accepts authoritative identity and ignores stale session-ended messages after a newer login', () => {
    const session = { protocolVersion: 1 as const, scope: 'game' as const, sessionId: 'current', token: 'A'.repeat(43), expiresAt: Date.now() + 60_000, playerId: 'placeholder', account: null };
    useAuthStore.getState().setSession(session);
    const { token, ...info } = session;
    handlers.get('sessionReady')!({ ...info, playerId: 'server-owned-seat' });
    expect(useGameStore.getState().myPlayerId).toBe('server-owned-seat');
    handlers.get('sessionEnded')!({ protocolVersion: 1, sessionId: 'old', reason: 'rotated' });
    expect(useAuthStore.getState().session?.sessionId).toBe('current');
    handlers.get('sessionEnded')!({ protocolVersion: 1, sessionId: 'current', reason: 'logout' });
    expect(useAuthStore.getState().session).toBeNull(); expect(disconnect).toHaveBeenCalled();
  });
});

describe('room exit feedback', () => {
  it('ignores old room notices and clears a confirmed departure without signing out', () => {
    const session = { protocolVersion: 1 as const, scope: 'game' as const, sessionId: 'current', token: 'A'.repeat(43),
      expiresAt: Date.now() + 60_000, playerId: 'player1', account: null };
    useAuthStore.getState().setSession(session); useGameStore.setState({ roomId: 'current-room' });
    handlers.get('roomDestroyed')!({ protocolVersion: 1, roomId: 'old-room' });
    expect(useGameStore.getState().roomId).toBe('current-room');
    handlers.get('roomLeft')!({ protocolVersion: 1, roomId: 'current-room' });
    expect(useGameStore.getState().roomId).toBeNull(); expect(useAuthStore.getState().session?.sessionId).toBe('current');
  });
});

describe('auto-pass status', () => {
  it('accepts only this room’s validated status and translates server deadlines to the local clock', () => {
    vi.spyOn(Date, 'now').mockReturnValue(50000); useGameStore.setState({ roomId: 'active', autoPass: { enabled: false, passAt: null } });
    handlers.get('autoPassStatus')!({ protocolVersion: 1, roomId: 'other', enabled: true, passAt: 105000, serverTime: 100000 });
    expect(useGameStore.getState().autoPass.enabled).toBe(false);
    handlers.get('autoPassStatus')!({ protocolVersion: 1, roomId: 'active', enabled: true, passAt: 105000, serverTime: 100000 });
    expect(useGameStore.getState().autoPass).toEqual({ enabled: true, passAt: 55000 });
    handlers.get('disconnect')!(undefined); expect(useGameStore.getState().autoPass).toEqual({ enabled: false, passAt: null });
  });
});

describe('board snapshot recovery', () => {
  const sendDelta = (seq: number, patch: Partial<ViewDelta> = {}) => handlers.get('stateDelta')!({
    protocolVersion: 1, roomId: 'room', viewerId: 'player1', seq, timestamp: 0,
    changes: [{ path: 'players.player1.life', op: 'update', value: 17 }], ...patch,
  });
  const sendSnapshot = (seq: number, room = createTestRoom()) => handlers.get('roomSnapshot')!({
    protocolVersion: 1, room, seq,
  });

  beforeEach(() => {
    emit.mockClear();
    const state = useGameStore.getState();
    state.setRoomId('room');
    state.setMyPlayerId('player1');
    state.setRoom(createTestRoom(), 1);
  });

  afterEach(() => {
    handlers.get('disconnect')!(undefined);
    vi.useRealTimers();
  });

  it('requests once on a gap and resumes only from a matching snapshot that covers the gap', () => {
    const original = useGameStore.getState().room;
    sendDelta(3, { viewerId: 'other' });
    expect(emit).not.toHaveBeenCalled();
    sendDelta(3);
    sendDelta(4);
    sendSnapshot(3);
    sendSnapshot(5, createTestRoom({ roomId: 'other' }));
    expect(emit).toHaveBeenCalledExactlyOnceWith('requestRoomSnapshot', { protocolVersion: 1, roomId: 'room' });
    expect(useGameStore.getState()).toMatchObject({ roomSync: 'recovering', lastSeq: 1 });
    expect(useGameStore.getState().room).toBe(original);

    sendSnapshot(4);
    sendDelta(5);
    sendSnapshot(4);
    expect(useGameStore.getState()).toMatchObject({ roomSync: 'live', lastSeq: 5, viewUpdate: 'delta' });
    expect(useGameStore.getState().room?.players.player1.life).toBe(17);
  });

  it('allows retry after a timeout and treats a reconnect snapshot as a fresh baseline', () => {
    vi.useFakeTimers();
    sendDelta(3);
    vi.advanceTimersByTime(5000);
    expect(useGameStore.getState().roomSync).toBe('sync-failed');
    recoverBoard();
    expect(emit).toHaveBeenCalledTimes(2);
    expect(useGameStore.getState().roomSync).toBe('recovering');
    handlers.get('disconnect')!(undefined);
    sendDelta(2);
    expect(useGameStore.getState().lastSeq).toBe(1);
    sendSnapshot(3);
    expect(useGameStore.getState()).toMatchObject({ roomSync: 'live', lastSeq: 3, viewUpdate: 'snapshot' });
  });
});
