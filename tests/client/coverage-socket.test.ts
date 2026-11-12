/**
 * Behavioural coverage for the client socket singleton (apps/game-client/socket.ts).
 *
 * `socket.io-client` is replaced with a fake socket so the module can be
 * exercised without a live server: the fake records every `on(event, handler)`
 * registration and exposes the options object handed to `io()` (including the
 * lazily evaluated `auth` callback).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const handlers = new Map<string, (data: any) => void>();
  const connect = vi.fn();
  const disconnect = vi.fn();
  const ioOptions: { value: any } = { value: undefined };
  const socket = {
    id: 'socket-1',
    connect,
    disconnect,
    on: vi.fn((event: string, handler: (data: any) => void) => {
      handlers.set(event, handler);
      return socket;
    }),
  };
  const io = vi.fn((options: any) => {
    ioOptions.value = options;
    return socket;
  });
  return { handlers, connect, disconnect, ioOptions, socket, io };
});

vi.mock('socket.io-client', () => ({ io: h.io }));

import socket, { connectWithSession } from '@client/socket';
import { useGameStore } from '@client/store/gameStore';
import { useAuthStore } from '@client/auth-state';
import { getStoredAuth, setStoredAuth, setStoredRoomId } from '@client/session';
import { clientLogger } from '@client/logger';
import { clientFlags as gameConfig } from '@client/config';
import { createTestRoom } from '../helpers/client-view-fixture';

const TEST_ROOM = '123e4567-e89b-42d3-a456-426614174000';

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1 as const,
    scope: 'game' as const,
    sessionId: 'session-1',
    token: 'A'.repeat(43),
    expiresAt: 9_999_999_999_999,
    playerId: 'player1',
    account: null,
    ...overrides,
  };
}

function makeInfo(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1 as const,
    sessionId: 'session-1',
    expiresAt: 9_999_999_999_999,
    playerId: 'server-seat',
    scope: 'game' as const,
    account: null,
    ...overrides,
  };
}

function stubWindow(url: string) {
  const history = { replaceState: vi.fn() };
  const dispatchEvent = vi.fn();
  vi.stubGlobal('window', { location: new URL(url), history, dispatchEvent });
  vi.stubGlobal('PopStateEvent', class FakePopStateEvent {
    type: string;
    constructor(type: string) { this.type = type; }
  });
  return { history, dispatchEvent };
}

function send(event: string, data?: unknown) {
  const handler = h.handlers.get(event);
  if (!handler) throw new Error('No handler registered for ' + event);
  handler(data);
}

const fetchMock = vi.fn();
const ensureGuest = vi.fn(async (_preferBrowser?: boolean) => makeSession());

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  ensureGuest.mockReset();
  ensureGuest.mockResolvedValue(makeSession());
  useAuthStore.setState({ session: null, busy: false, error: null, ensureGuest: ensureGuest as any });
  setStoredAuth(null);
  useGameStore.getState().clearSession();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('socket construction and auth handshake', () => {
  it('lazily creates the single socket and re-reads the persisted credential on every handshake', () => {
    expect(socket).toBe(h.socket);
    expect(h.ioOptions.value.autoConnect).toBe(false);

    setStoredAuth(makeSession());
    setStoredRoomId('room-9');
    const first = vi.fn();
    h.ioOptions.value.auth(first);
    expect(first).toHaveBeenCalledWith({ protocolVersion: 1, token: 'A'.repeat(43), roomId: 'room-9' });

    const secondSession = makeSession({ token: 'B'.repeat(43) });
    setStoredAuth(secondSession);
    const second = vi.fn();
    h.ioOptions.value.auth(second);
    expect(second).toHaveBeenCalledWith({ protocolVersion: 1, token: 'B'.repeat(43), roomId: 'room-9' });
  });
});

describe('connectWithSession', () => {
  it('uses the default guest path and connects when the browser has no test-room parameter', async () => {
    stubWindow('http://localhost/play');
    await connectWithSession();
    expect(ensureGuest).toHaveBeenCalledWith(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.connect).toHaveBeenCalledTimes(1);
  });

  it('accepts an explicitly preferred browser sign-in and tolerates a missing window', async () => {
    await connectWithSession(true);
    expect(ensureGuest).toHaveBeenCalledWith(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.connect).toHaveBeenCalledTimes(1);
  });

  it('claims an assigned test room, adopts the returned seat and opens the socket', async () => {
    const current = makeSession({ roomId: 'old-room' });
    setStoredAuth(current);
    useAuthStore.setState({ session: current });
    const info = makeInfo({ sessionId: current.sessionId, playerId: 'claimed-seat' });
    fetchMock.mockResolvedValue({ ok: true, json: async () => info });
    const ui = stubWindow('http://localhost/play?testRoom=' + TEST_ROOM + '&mode=lab');

    await connectWithSession(true);

    expect(fetchMock).toHaveBeenCalledWith('/api/lab/rooms/' + TEST_ROOM + '/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + current.token },
      body: JSON.stringify({ protocolVersion: 1 }),
    });
    expect(useAuthStore.getState().session).toMatchObject({ ...info, token: current.token });
    expect(useGameStore.getState().roomId).toBe(TEST_ROOM);
    expect(ui.history.replaceState).toHaveBeenCalledWith(null, '', '/play?mode=lab');
    expect(h.connect).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed test-room reference before contacting the server', async () => {
    setStoredAuth(makeSession());
    stubWindow('http://localhost/play?testRoom=not-a-room');
    await expect(connectWithSession()).rejects.toThrow('Invalid test room reference.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.connect).not.toHaveBeenCalled();
  });

  it('refuses a claim the server rejects and never connects', async () => {
    setStoredAuth(makeSession());
    stubWindow('http://localhost/play?testRoom=' + TEST_ROOM);
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ message: 'denied' }) });

    await expect(connectWithSession()).rejects.toThrow('Sign in with an assigned lab account before claiming this test seat.');
    expect(h.connect).not.toHaveBeenCalled();
    expect(useGameStore.getState().roomId).toBeNull();
  });

  it('drops a claim that resolves after the tab moved to another session', async () => {
    setStoredAuth(makeSession());
    stubWindow('http://localhost/play?testRoom=' + TEST_ROOM);
    fetchMock.mockImplementation(async () => {
      setStoredAuth(null);
      return { ok: true, json: async () => makeInfo() };
    });

    await connectWithSession();

    expect(getStoredAuth()).toBeNull();
    expect(h.connect).not.toHaveBeenCalled();
    expect(useGameStore.getState().roomId).toBeNull();
  });

  it('ignores a test-room parameter when the tab has no credential yet', async () => {
    stubWindow('http://localhost/play?testRoom=' + TEST_ROOM);
    await connectWithSession();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.connect).toHaveBeenCalledTimes(1);
  });
});

describe('authoritative state handlers', () => {
  it('applies only protocol-tagged deltas to the current room', () => {
    send('stateDelta', null);
    expect(useGameStore.getState().lastSeq).toBe(0);

    const room = createTestRoom();
    useGameStore.getState().setRoomId(room.roomId);
    useGameStore.getState().setMyPlayerId(room.viewerId);
    useGameStore.getState().setRoom(room, 0);
    send('stateDelta', {
      protocolVersion: 1, viewerId: 'player1', roomId: room.roomId, seq: 1,
      timestamp: 0, commandId: 'cmd-1', action: 'pass', changes: [],
    });

    expect(useGameStore.getState().lastSeq).toBe(1);
    expect(useGameStore.getState().room?.roomId).toBe(room.roomId);
    expect(useGameStore.getState().log).toHaveLength(1);
  });

  it('adopts roomCreated and roomJoined ids only from protocol messages', () => {
    send('roomCreated', { protocolVersion: 2, roomId: 'bad' });
    send('roomJoined', { roomId: 'bad' });
    expect(useGameStore.getState().roomId).toBeNull();

    send('roomCreated', { protocolVersion: 1, roomId: 'created-room' });
    expect(useGameStore.getState().roomId).toBe('created-room');

    send('roomJoined', { protocolVersion: 1, roomId: 'joined-room' });
    expect(useGameStore.getState().roomId).toBe('joined-room');
  });

  it('restores a snapshot only when it is a protocol message for this viewer', () => {
    const room = createTestRoom();

    send('roomSnapshot', null);
    send('roomSnapshot', { protocolVersion: 1, seq: 1, room: { roomId: 'no-protocol' } });
    send('roomSnapshot', { protocolVersion: 1, seq: 1, room });
    expect(useGameStore.getState().room).toBeNull();

    useGameStore.getState().setMyPlayerId('player1');
    send('roomSnapshot', { protocolVersion: 1, seq: 4, room });
    expect(useGameStore.getState().room).toBeNull();
    send('roomJoined', { protocolVersion: 1, roomId: room.roomId });
    send('roomSnapshot', { protocolVersion: 1, seq: 4, room });
    expect(useGameStore.getState().room).toBe(room);
    expect(useGameStore.getState().lastSeq).toBe(4);
  });
});

describe('seat and session lifecycle handlers', () => {
  it('ignores unversioned sessionReady, then restores missing sessions and rejects stale ids', () => {
    send('sessionReady', { protocolVersion: 2 });
    send('sessionReady', makeInfo());
    expect(useGameStore.getState().myPlayerId).toBeNull();

    const current = makeSession({ roomId: 'stale-room' });
    useAuthStore.getState().setSession(current);
    send('sessionReady', makeInfo({ sessionId: 'another-session' }));
    expect(useGameStore.getState().myPlayerId).toBeNull();

    send('sessionReady', makeInfo());
    expect(useGameStore.getState().myPlayerId).toBe('server-seat');
    const updated = useAuthStore.getState().session!;
    expect(updated.token).toBe(current.token);
    expect(updated.sessionId).toBe('session-1');
    expect(updated.playerId).toBe('server-seat');
    expect('roomId' in updated).toBe(false);
  });

  it('ends a session for linked, rotated and signed-out reasons with the right cleanup', () => {
    send('sessionEnded', { protocolVersion: 2, sessionId: 'session-1', reason: 'logout' });
    send('sessionEnded', { protocolVersion: 1, sessionId: 'session-1', reason: 'logout' });
    expect(useAuthStore.getState().session).toBeNull();

    useAuthStore.getState().setSession(makeSession());
    send('sessionEnded', { protocolVersion: 1, sessionId: 'other-session', reason: 'logout' });
    expect(useAuthStore.getState().session).not.toBeNull();

    useGameStore.getState().setRoom(createTestRoom(), 0);
    useGameStore.setState({ roomId: 'room' });
    send('sessionEnded', { protocolVersion: 1, sessionId: 'session-1', reason: 'linked' });
    expect(useAuthStore.getState().session).toBeNull();
    expect(h.disconnect).toHaveBeenCalledTimes(1);
    expect(useGameStore.getState().room).not.toBeNull();
    expect(useGameStore.getState().error).toBeNull();

    useAuthStore.getState().setSession(makeSession());
    useGameStore.getState().setRoom(createTestRoom(), 0);
    send('sessionEnded', { protocolVersion: 1, sessionId: 'session-1', reason: 'rotated' });
    expect(useGameStore.getState().room).toBeNull();
    expect(useGameStore.getState().error).toBeNull();

    useAuthStore.getState().setSession(makeSession());
    send('sessionEnded', { protocolVersion: 1, sessionId: 'session-1', reason: 'expired' });
    expect(useGameStore.getState().room).toBeNull();
    expect(useGameStore.getState().error).toBe('Session ended. Sign in again to continue.');
  });

  it('rejoins a room and adopts the server-owned player id', () => {
    const info = vi.spyOn(clientLogger, 'info');
    send('rejoined', { roomId: 'not-valid' });
    expect(useGameStore.getState().roomId).toBeNull();

    send('rejoined', { protocolVersion: 1, roomId: 'room-7', playerId: 'seat-7' });
    expect(useGameStore.getState().roomId).toBe('room-7');
    expect(useGameStore.getState().myPlayerId).toBe('seat-7');
    expect(info).toHaveBeenCalledWith('rejoined', 'Rejoined room', { roomId: 'room-7', playerId: 'seat-7' });
  });

  it('returns to the lobby on rejoin failure and navigates back to /play', () => {
    const warn = vi.spyOn(clientLogger, 'warn');
    const ui = stubWindow('http://localhost/play?testRoom=' + TEST_ROOM);
    useGameStore.setState({ roomId: 'room', myPlayerId: 'seat' });

    send('rejoinFailed', { reason: 'no-such-room' });
    expect(warn).not.toHaveBeenCalled();

    send('rejoinFailed', { protocolVersion: 1, reason: 'no-such-room' });
    expect(warn).toHaveBeenCalledWith('rejoin:failed', 'Rejoin failed: no-such-room', { reason: 'no-such-room' });
    expect(useGameStore.getState().roomId).toBeNull();
    expect(useGameStore.getState().myPlayerId).toBeNull();
    expect(ui.history.replaceState).toHaveBeenCalledWith(null, '', '/play');
    expect(ui.dispatchEvent).toHaveBeenCalledTimes(1);
    expect((ui.dispatchEvent.mock.calls[0][0] as { type: string }).type).toBe('popstate');
  });

  it('clears the room for matching roomLeft and roomDestroyed notices only', () => {
    const info = vi.spyOn(clientLogger, 'info');
    useGameStore.setState({ roomId: 'room-a' });

    send('roomLeft', { protocolVersion: 2, roomId: 'room-a' });
    send('roomLeft', { protocolVersion: 1, roomId: 'room-b' });
    expect(useGameStore.getState().roomId).toBe('room-a');

    send('roomDestroyed', { protocolVersion: 2, roomId: 'room-a' });
    send('roomDestroyed', { protocolVersion: 1, roomId: 'room-b' });
    expect(useGameStore.getState().roomId).toBe('room-a');

    send('roomDestroyed', { protocolVersion: 1, roomId: 'room-a' });
    expect(useGameStore.getState().roomId).toBeNull();
    expect(info).toHaveBeenCalledWith('room:destroyed', 'Room was destroyed', { roomId: 'room-a' });

    useGameStore.setState({ roomId: 'room-c' });
    send('roomLeft', { protocolVersion: 1, roomId: 'room-c' });
    expect(useGameStore.getState().roomId).toBeNull();
  });
});

describe('informational and error handlers', () => {
  it('logs connection, reconnect and game-start diagnostics', () => {
    const info = vi.spyOn(clientLogger, 'info');

    send('connect');
    expect(info).toHaveBeenCalledWith('connected', 'Connected to server', { socketId: 'socket-1' });

    send('playerJoined', { protocolVersion: 1, playerId: 'player2' });
    expect(info).toHaveBeenCalledWith('opponent:joined', 'Opponent joined', { opponentId: 'player2' });

    send('rpsPhase', { protocolVersion: 1, message: 'Choose a card' });
    expect(info).toHaveBeenCalledWith('rps:phase', 'Choose a card');

    send('startGame', { protocolVersion: 1, roomId: 'room' });
    expect(info).toHaveBeenCalledWith('game:started', 'Game started', { roomId: 'room' });

    info.mockClear();
    send('playerJoined', { playerId: 'no-protocol' });
    send('rpsPhase', { message: 'not protocol tagged' });
    send('startGame', { roomId: 'no-protocol' });
    expect(info).not.toHaveBeenCalled();
  });

  it('reports disconnect and transport failures', () => {
    const info = vi.spyOn(clientLogger, 'info');
    const error = vi.spyOn(clientLogger, 'error');

    send('disconnect');
    expect(useGameStore.getState().autoPass).toEqual({ enabled: false, passAt: null });
    expect(info).toHaveBeenCalledWith('disconnected', 'Disconnected from server');

    send('connect_error', new Error('offline'));
    expect(error).toHaveBeenCalledWith('connection:failed', 'offline');
    expect(useGameStore.getState().error).toBe('Unable to connect to the game server: offline');
  });

  it('shows protocol errors and only traces them when action logging is enabled', () => {
    const warn = vi.spyOn(clientLogger, 'warn');

    send('error', { protocolVersion: 2, message: 'ignored' });
    expect(warn).not.toHaveBeenCalled();
    expect(useGameStore.getState().error).toBeNull();

    send('error', { protocolVersion: 1, message: 'Not your priority', action: 'choose', commandId: 'c1' });
    expect(warn).toHaveBeenLastCalledWith('action:rejected', 'Not your priority', expect.objectContaining({ message: 'Not your priority' }));

    send('error', { protocolVersion: 1, message: 'Room is unavailable', commandId: 'c2' });
    expect(warn).toHaveBeenLastCalledWith('room:rejected', 'Room is unavailable', expect.objectContaining({ message: 'Room is unavailable' }));
    expect(useGameStore.getState().error).toBe('Room is unavailable');

    const original = gameConfig.logging.actions;
    gameConfig.logging.actions = false;
    try {
      send('error', { protocolVersion: 1, message: 'Silent rejection', action: 'play' });
      expect(warn).toHaveBeenCalledTimes(2);
      expect(useGameStore.getState().error).toBe('Silent rejection');
    } finally {
      gameConfig.logging.actions = original;
    }
  });

  it('surfaces a full room only for protocol-tagged notices', () => {
    send('roomFull', { roomId: 'room' });
    expect(useGameStore.getState().error).toBeNull();

    send('roomFull', { protocolVersion: 1 });
    expect(useGameStore.getState().error).toBe('This room is full.');
  });

  it('translates auto-pass deadlines, including a disabled deadline', () => {
    useGameStore.setState({ roomId: 'active', autoPass: { enabled: false, passAt: null } });

    send('autoPassStatus', { protocolVersion: 1, roomId: 'active', enabled: 'yes', passAt: null, serverTime: 0 });
    expect(useGameStore.getState().autoPass).toEqual({ enabled: false, passAt: null });

    send('autoPassStatus', { protocolVersion: 1, roomId: 'other', enabled: true, passAt: null, serverTime: 0 });
    expect(useGameStore.getState().autoPass).toEqual({ enabled: false, passAt: null });

    send('autoPassStatus', { protocolVersion: 1, roomId: 'active', enabled: true, passAt: null, serverTime: 0 });
    expect(useGameStore.getState().autoPass).toEqual({ enabled: true, passAt: null });

    vi.spyOn(Date, 'now').mockReturnValue(50000);
    send('autoPassStatus', { protocolVersion: 1, roomId: 'active', enabled: true, passAt: 105000, serverTime: 100000 });
    expect(useGameStore.getState().autoPass).toEqual({ enabled: true, passAt: 55000 });
  });

  it('opens the context menu only for the card and zone that asked for options', () => {
    useGameStore.setState({ roomId: 'room', pendingCard: { cardUuid: 'card-1', zone: 'hand', position: { x: 12, y: 34 } } });
    const options = [{ actionId: 'play_land' as const, label: 'Play land' }];

    send('optionsForCard', null);
    send('optionsForCard', { protocolVersion: 1, roomId: 'other', cardUuid: 'card-1', zone: 'hand', options });
    send('optionsForCard', { protocolVersion: 1, roomId: 'room', cardUuid: 'card-2', zone: 'hand', options });
    send('optionsForCard', { protocolVersion: 1, roomId: 'room', cardUuid: 'card-1', zone: 'battlefield', options });
    expect(useGameStore.getState().contextMenu).toBeNull();
    expect(useGameStore.getState().pendingCard).not.toBeNull();

    useGameStore.setState({ pendingCard: null });
    send('optionsForCard', { protocolVersion: 1, roomId: 'room', cardUuid: 'card-1', zone: 'hand', options });
    expect(useGameStore.getState().contextMenu).toBeNull();

    useGameStore.setState({ pendingCard: { cardUuid: 'card-1', zone: 'hand', position: { x: 12, y: 34 } } });
    send('optionsForCard', { protocolVersion: 1, roomId: 'room', cardUuid: 'card-1', zone: 'hand', options });
    expect(useGameStore.getState().contextMenu).toMatchObject({ x: 12, y: 34, cardUuid: 'card-1', zone: 'hand', options });
    expect(useGameStore.getState().pendingCard).toBeNull();
  });
});
