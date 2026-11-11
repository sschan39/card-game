import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '@card-game/protocol';
import { setStoredAuth } from '@client/session';
import { clientFlags } from '@client/config';

const { socket, emit, connectWithSession, useGameStore, storeState, requestOptions, setMyPlayerId, setError } = vi.hoisted(() => {
  const emit = vi.fn();
  const requestOptions = vi.fn();
  const storeState: Record<string, any> = {
    roomId: 'room-1', room: null, error: null, myPlayerId: 'stable-player', requestOptions,
  };
  const setMyPlayerId = vi.fn((playerId: string) => { storeState.myPlayerId = playerId; });
  const setError = vi.fn((error: string | null) => { storeState.error = error; });
  const useGameStore = ((selector: (state: typeof storeState) => unknown) => selector(storeState)) as {
    (selector: (state: typeof storeState) => unknown): unknown;
    getState: () => typeof storeState;
    setState: (patch: Partial<typeof storeState>) => void;
  };
  useGameStore.getState = () => storeState;
  useGameStore.setState = patch => { Object.assign(storeState, patch); };
  return {
    socket: { disconnected: false, emit, on: vi.fn(), off: vi.fn() },
    emit, connectWithSession: vi.fn(), useGameStore, storeState, requestOptions, setMyPlayerId, setError,
  };
});
type EffectCallback = () => void | (() => void);
const effects: EffectCallback[] = [];

vi.mock('@client/store/gameStore', () => ({ useGameStore }));
vi.mock('@client/socket', () => ({ default: socket, connectWithSession }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const mock = {
    ...actual,
    useCallback: <T,>(callback: T) => callback,
    useEffect: (callback: EffectCallback) => { effects.push(callback); },
  };
  return { ...mock, default: mock };
});

const { useGameActions } = await import('@client/hooks/useGameActions');
const { useSocket } = await import('@client/hooks/useSocket');

const session = {
  protocolVersion: PROTOCOL_VERSION, scope: 'game' as const, sessionId: 'session', playerId: 'stable-player',
  token: 'A'.repeat(43), expiresAt: Date.now() + 60_000, account: null,
};

beforeEach(() => {
  emit.mockReset();
  socket.emit = emit;
  socket.disconnected = false;
  socket.on.mockReset();
  socket.off.mockReset();
  connectWithSession.mockReset().mockResolvedValue(undefined);
  requestOptions.mockReset();
  setMyPlayerId.mockClear();
  setError.mockClear();
  Object.assign(storeState, {
    roomId: 'room-1', room: null, error: null, myPlayerId: 'stable-player', requestOptions, setMyPlayerId, setError,
  });
  effects.length = 0;
  const storage = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  setStoredAuth(null);
  clientFlags.logging.actions = true;
});
afterEach(() => {
  setStoredAuth(null);
  vi.unstubAllGlobals();
});

describe('game action dispatchers', () => {
  it('creates and joins rooms with optional deck ids', () => {
    const actions = useGameActions() as ReturnType<typeof useGameActions>;
    actions.createRoom();
    actions.createRoom('deck-1');
    expect(emit).toHaveBeenNthCalledWith(1, 'createRoom', { protocolVersion: PROTOCOL_VERSION });
    expect(emit).toHaveBeenNthCalledWith(2, 'createRoom', { protocolVersion: PROTOCOL_VERSION, deckId: 'deck-1' });

    actions.joinRoom('room-1');
    actions.joinRoom('room-1', 'deck-2');
    expect(emit).toHaveBeenNthCalledWith(3, 'joinRoom', { protocolVersion: PROTOCOL_VERSION, roomId: 'room-1' });
    expect(emit).toHaveBeenNthCalledWith(4, 'joinRoom', { protocolVersion: PROTOCOL_VERSION, roomId: 'room-1', deckId: 'deck-2' });
  });

  it('refuses player actions while disconnected, unseated or finished', () => {
    const actions = useGameActions() as ReturnType<typeof useGameActions>;
    socket.disconnected = true;
    actions.playerAction('pass_priority');
    expect(storeState.error).toBe('Reconnect before sending an action.');
    expect(emit).not.toHaveBeenCalled();

    socket.disconnected = false;
    storeState.roomId = null;
    (useGameActions() as ReturnType<typeof useGameActions>).playerAction('pass_priority');
    expect(emit).not.toHaveBeenCalled();

    storeState.roomId = 'room-1';
    storeState.room = { status: 'gameOver' };
    (useGameActions() as ReturnType<typeof useGameActions>).playerAction('pass_priority');
    expect(emit).not.toHaveBeenCalled();
  });

  it('dispatches without tracing when action logging is disabled', () => {
    clientFlags.logging.actions = false;
    const actions = useGameActions() as ReturnType<typeof useGameActions>;
    actions.createRoom('deck-1');
    actions.joinRoom('room-1', 'deck-1');
    actions.playerAction('pass_priority');
    actions.getOptions('card-1', 'hand');
    expect(emit).toHaveBeenCalledTimes(4);
    expect(storeState.error).toBeNull();
  });

  it('sends player actions with a command id, targets and choice details', () => {
    const actions = useGameActions() as ReturnType<typeof useGameActions>;
    actions.playerAction('cast_spell', 'card-1', [{ targetType: 'player', playerId: 'p2' }], { choiceId: 'choice-1', cancel: true });
    const payload = emit.mock.calls[0][1];
    expect(emit.mock.calls[0][0]).toBe('playerAction');
    expect(payload).toMatchObject({
      protocolVersion: PROTOCOL_VERSION, roomId: 'room-1', actionId: 'cast_spell', cardUuid: 'card-1',
      targets: [{ targetType: 'player', playerId: 'p2' }], choiceId: 'choice-1', cancel: true,
    });
    expect(payload.commandId).toMatch(/^[0-9a-f-]{36}$/);
    expect(storeState.error).toBeNull();
  });

  it('requests card options only for a live seated room', () => {
    const actions = useGameActions() as ReturnType<typeof useGameActions>;
    actions.getOptions('card-1', 'hand', { x: 1, y: 2 });
    expect(requestOptions).toHaveBeenCalledWith('card-1', 'hand', { x: 1, y: 2 });
    expect(emit).toHaveBeenCalledWith('getOptions', { protocolVersion: PROTOCOL_VERSION, roomId: 'room-1', cardUuid: 'card-1', zone: 'hand' });

    emit.mockClear();
    socket.disconnected = true;
    actions.getOptions('card-1', 'battlefield');
    expect(requestOptions).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();

    socket.disconnected = false;
    storeState.roomId = null;
    (useGameActions() as ReturnType<typeof useGameActions>).getOptions('card-1', 'battlefield');
    expect(requestOptions).toHaveBeenCalledTimes(1);

    storeState.roomId = 'room-1';
    storeState.room = { status: 'gameOver' };
    (useGameActions() as ReturnType<typeof useGameActions>).getOptions('card-1', 'battlefield');
    expect(requestOptions).toHaveBeenCalledTimes(1);
  });

  it('leaves rooms only when seated and connected', () => {
    const actions = useGameActions() as ReturnType<typeof useGameActions>;
    actions.leaveRoom();
    expect(emit).toHaveBeenCalledWith('leaveRoom', { protocolVersion: PROTOCOL_VERSION, roomId: 'room-1' });

    emit.mockClear();
    socket.disconnected = true;
    actions.leaveRoom();
    expect(storeState.error).toBe('Reconnect before leaving the room.');
    expect(emit).not.toHaveBeenCalled();

    socket.disconnected = false;
    storeState.roomId = null;
    (useGameActions() as ReturnType<typeof useGameActions>).leaveRoom();
    expect(emit).not.toHaveBeenCalled();
  });

  it('toggles auto-pass only when seated and connected', () => {
    const actions = useGameActions() as ReturnType<typeof useGameActions>;
    actions.setAutoPass(true);
    expect(emit).toHaveBeenCalledWith('setAutoPass', { protocolVersion: PROTOCOL_VERSION, roomId: 'room-1', enabled: true });

    emit.mockClear();
    socket.disconnected = true;
    actions.setAutoPass(false);
    expect(storeState.error).toBe('Reconnect before changing auto-pass.');
    expect(emit).not.toHaveBeenCalled();

    socket.disconnected = false;
    storeState.roomId = null;
    (useGameActions() as ReturnType<typeof useGameActions>).setAutoPass(false);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('socket binding hook', () => {
  it('does nothing when disabled', () => {
    useSocket(false);
    expect(effects).toHaveLength(1);
    expect(effects[0]()).toBeUndefined();
    expect(connectWithSession).not.toHaveBeenCalled();
    expect(socket.on).not.toHaveBeenCalled();
  });

  it('restores the stable player id and rebinds connect handlers', async () => {
    setStoredAuth(session);
    useSocket();
    expect(effects).toHaveLength(1);
    const cleanup = effects[0]();
    expect(setMyPlayerId).toHaveBeenCalledWith('stable-player');
    expect(connectWithSession).toHaveBeenCalledTimes(1);
    expect(socket.on).toHaveBeenCalledWith('connect', expect.any(Function));

    setStoredAuth({ ...session, playerId: 'changed-player' });
    const handler = socket.on.mock.calls[0][1] as () => void;
    handler();
    expect(setMyPlayerId).toHaveBeenLastCalledWith('changed-player');

    expect(typeof cleanup).toBe('function');
    cleanup?.();
    expect(socket.off).toHaveBeenCalledWith('connect', handler);
  });

  it('ignores a connect event when this tab has no session', () => {
    useSocket();
    effects[0]();
    const handler = socket.on.mock.calls[0][1] as () => void;
    expect(() => handler()).not.toThrow();
    expect(storeState.myPlayerId).toBe('stable-player');
  });

  it('surfaces session failures with Error and generic messages', async () => {
    useSocket();
    connectWithSession.mockRejectedValueOnce(new Error('offline'));
    effects[0]();
    await vi.waitFor(() => expect(storeState.error).toBe('offline'));

    storeState.error = null;
    useSocket();
    connectWithSession.mockRejectedValueOnce('offline');
    effects[1]?.();
    await vi.waitFor(() => expect(storeState.error).toBe('Unable to establish a session. Try signing in again.'));
  });
});
