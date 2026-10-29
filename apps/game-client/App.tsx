import { useGameStore } from './store/gameStore';
import StartScreen from './components/StartScreen';
import GameScreen from './components/GameScreen';
import AccountControls from './components/AccountControls';
import { useEffect, useState } from 'react';
import { WorkspaceHeader } from '@card-game/ui';
import '@card-game/ui/style.css';
import { publicSession, resolvePublicRoute, verifyRoomResume } from '@card-game/browser-session';
import type { PlatformInfo, SessionInfo } from '@card-game/protocol';
import { useAuthStore } from './auth-state';
import { getStoredRoomId, setStoredRoomId } from './session';
import socket from './socket';
import { useSocket } from './hooks/useSocket';
import Home from './components/Home';

export default function App() {
  const roomId = useGameStore((s) => s.roomId);
  const error = useGameStore(s => s.error);
  const setError = useGameStore(s => s.setError);
  const session = useAuthStore(state => state.session);
  const [route, setRoute] = useState(() => resolvePublicRoute(typeof window === 'undefined' ? '/' : window.location.pathname));
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  const identity = useAuthStore(state => state.browserSession);
  useSocket(route.kind !== 'home' && route.kind !== 'invalid' || !!roomId);
  useEffect(() => {
    const controller = new AbortController();
    void publicSession.platform(controller.signal).then(value => { if (!controller.signal.aborted) setPlatform(value); }).catch(() => { if (!controller.signal.aborted) setError('Navigation unavailable. Reload or check server configuration.'); });
    let identityRead = 0;
    const refresh = () => {
      const read = ++identityRead;
      void publicSession.me(controller.signal).then(value => { if (!controller.signal.aborted && read === identityRead) useAuthStore.setState({ browserSession: value.session }); }).catch(() => { /* Gameplay can continue on an existing valid tab credential while the API is offline. */ });
    };
    refresh(); window.addEventListener('focus', refresh);
    const changed = () => setRoute(resolvePublicRoute(window.location.pathname)); window.addEventListener('popstate', changed);
    return () => { controller.abort(); window.removeEventListener('focus', refresh); window.removeEventListener('popstate', changed); };
  }, [session?.sessionId]);
  useEffect(() => {
    if (route.kind !== 'room' || !session) return;
    const controller = new AbortController();
    void verifyRoomResume(route.roomId, session, controller.signal).then(verified => {
      if (controller.signal.aborted) return;
      const current = useAuthStore.getState().session;
      if (!current || current.sessionId !== verified.sessionId) return;
      useAuthStore.getState().setSession({ ...current, playerId: verified.playerId, roomId: verified.roomId });
      if (!controller.signal.aborted && getStoredRoomId() !== route.roomId) { socket.disconnect(); setStoredRoomId(route.roomId); socket.connect(); }
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Unable to resume the room.'); });
    return () => controller.abort();
  }, [route.kind === 'room' ? route.roomId : '', session?.sessionId]);
  useEffect(() => {
    if (!roomId || route.kind === 'home') return;
    const path = '/play/rooms/' + encodeURIComponent(roomId);
    if (window.location.pathname !== path) { window.history.replaceState(null, '', path + window.location.search); setRoute({ kind: 'room', roomId }); }
  }, [roomId]);

  return <>
    <WorkspaceHeader navigation={platform?.navigation ?? null} current={route.kind === 'home' ? 'home' : 'play'} account={roomId ? session?.account ?? identity?.account ?? null : identity?.account ?? session?.account ?? null} activeRoomId={roomId} breadcrumb={roomId ? 'Play / Room ' + roomId : route.kind === 'home' ? 'Home' : 'Play / Lobby'} accountMenu={<AccountControls browserAccount={identity?.account} />} />
    {error && <div className="action-error" role="alert">
      <span>{error}</span><button onClick={() => setError(null)}>Dismiss</button>
    </div>}
    {route.kind === 'invalid' ? <main><h1>Page unavailable</h1><a href="/home">Home</a> · <a href="/play">Play</a></main> : route.kind === 'home' ? <Home identity={identity} decksUrl={platform?.navigation.decks} /> : roomId ? <GameScreen /> : <StartScreen decksUrl={platform?.navigation.decks} />}
  </>;
}
