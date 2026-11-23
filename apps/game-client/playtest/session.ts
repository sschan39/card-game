import { io, type Socket } from 'socket.io-client';
import { AutoPassStatusSchema, PLAYTEST_SESSION_KEY, PROTOCOL_VERSION, PlaytestCredentialsSchema, isProtocolMessage,
  type ClientEvents, type PlaytestCredentials, type ServerEvents } from '@card-game/protocol';
import { useGameStore } from '../store/gameStore';

export function playtestRoomId(path: string) {
  return /^\/play\/test\/([0-9a-f-]{36})\/?$/i.exec(path)?.[1];
}

export function readPlaytest(roomId: string) {
  try {
    const access = PlaytestCredentialsSchema.parse(JSON.parse(sessionStorage.getItem(`${PLAYTEST_SESSION_KEY}:${roomId}`) ?? 'null'));
    return access.run.roomId === roomId ? access : null;
  } catch { return null; }
}

type Seat = 0 | 1;
type MatchSocket = Socket<ServerEvents, ClientEvents>;
const emptyAutoPass = { enabled: false, passAt: null };

/** Both seats connect to the real runtime. Only the selected seat may update the visible board. */
export function connectPlaytest(access: PlaytestCredentials) {
  const roomId = access.run.roomId;
  const packet = { protocolVersion: PROTOCOL_VERSION, roomId };
  const sockets = access.seats.map(playtestToken => io({ autoConnect: false, forceNew: true,
    auth: { ...packet, playtestToken } })) as [MatchSocket, MatchSocket];
  const preferences: ReturnType<typeof useGameStore.getState>['autoPass'][] = [emptyAutoPass, emptyAutoPass];
  const paused = [false, false];
  let active: Seat = 0;
  let minimumSeq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const clearTimer = () => { clearTimeout(timer); timer = undefined; };
  const recover = () => {
    if (disposed || timer) return;
    const current = sockets[active];
    useGameStore.setState({ roomSync: 'recovering' });
    timer = setTimeout(() => {
      timer = undefined;
      useGameStore.setState({ roomSync: 'sync-failed' });
    }, 5000);
    if (current.connected) current.emit('requestRoomSnapshot', packet);
    else current.connect();
  };

  const select = (seat: Seat) => {
    if (active === seat || disposed) return;
    active = seat;
    clearTimer();
    useGameStore.setState({ room: null, myPlayerId: null, roomSync: 'waiting', matchPaused: paused[seat], autoPass: preferences[seat], error: null });
    recover();
  };

  useGameStore.setState({ roomId, room: null, lastSeq: 0, myPlayerId: null, roomSync: 'waiting', matchPaused: false, error: null, autoPass: emptyAutoPass });
  sockets.forEach((socket, seat) => {
    const selected = () => !disposed && active === seat;
    socket.on('roomSnapshot', data => {
      if (!selected() || !isProtocolMessage(data) || data.room.roomId !== roomId) return;
      if (data.seq < minimumSeq) { socket.emit('requestRoomSnapshot', packet); return; }
      clearTimer();
      minimumSeq = data.seq;
      useGameStore.setState({ myPlayerId: data.room.viewerId, opponentConnected: data.opponentConnected, autoPass: preferences[seat] });
      useGameStore.getState().setRoom(data.room, data.seq, data.testContext, data.lobbyRps);
    });
    socket.on('stateDelta', delta => {
      if (!selected() || !isProtocolMessage(delta) || delta.roomId !== roomId) return;
      const state = useGameStore.getState();
      minimumSeq = Math.max(minimumSeq, delta.seq);
      if (state.roomSync !== 'live') return;
      try { if (state.applyDelta(delta) !== 'gap') return; }
      catch { /* Recover from a canonical snapshot. */ }
      recover();
    });
    socket.on('autoPassStatus', input => {
      const parsed = AutoPassStatusSchema.safeParse(input);
      if (!parsed.success || parsed.data.roomId !== roomId) return;
      const { enabled, passAt, serverTime, untilTurn } = parsed.data;
      preferences[seat] = { enabled, passAt: passAt === null ? null : Date.now() + Math.max(0, passAt - serverTime),
        ...(untilTurn === undefined ? {} : { untilTurn }) };
      if (selected()) useGameStore.setState({ autoPass: preferences[seat] });
    });
    socket.on('opponentPresence', input => {
      if (selected() && isProtocolMessage(input) && input.roomId === roomId) useGameStore.setState({ opponentConnected: input.connected });
    });
    socket.on('matchAccess', input => {
      if (disposed || !isProtocolMessage(input) || input.roomId !== roomId || typeof input.paused !== 'boolean') return;
      paused[seat] = input.paused;
      if (!selected()) return;
      useGameStore.setState({ matchPaused: input.paused });
      if (!input.paused && useGameStore.getState().roomSync !== 'live') {
        clearTimer();
        recover();
      }
    });
    socket.on('optionsForCard', input => {
      if (!selected() || !isProtocolMessage(input) || input.roomId !== roomId) return;
      const state = useGameStore.getState();
      if (state.pendingCard?.cardUuid === input.cardUuid && state.pendingCard?.zone === input.zone) state.showContextMenu(input.options);
    });
    socket.on('error', input => { if (selected() && isProtocolMessage(input)) useGameStore.getState().setError(input.message); });
    socket.on('disconnect', () => {
      preferences[seat] = emptyAutoPass;
      paused[seat] = false;
      if (!selected()) return;
      clearTimer();
      useGameStore.setState({ roomSync: 'offline', matchPaused: false, autoPass: emptyAutoPass });
    });
    socket.on('connect_error', error => {
      if (!selected()) return;
      clearTimer();
      useGameStore.setState({ roomSync: 'offline', error: error.message });
    });
    const ended = () => {
      if (disposed) return;
      try { sessionStorage.removeItem(`${PLAYTEST_SESSION_KEY}:${roomId}`); } catch { /* The revoked credentials cannot reconnect. */ }
      useGameStore.setState({ roomSync: 'offline', error: access.retained
        ? 'Room control ended. Return to Test Rooms to check whether you can resume.'
        : 'This playtest has ended. Return to Scenario Lab to start another.' });
      sockets.forEach(connection => connection.disconnect());
    };
    socket.on('roomDestroyed', ended);
    socket.on('sessionEnded', ended);
  });
  sockets.forEach(socket => socket.connect());
  return { sockets, recover, select, dispose: () => {
    disposed = true;
    clearTimer();
    sockets.forEach(socket => { socket.removeAllListeners(); socket.disconnect(); });
  } };
}
