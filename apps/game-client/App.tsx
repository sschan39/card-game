import { useGameStore } from './store/gameStore';
import StartScreen from './components/StartScreen';
import GameScreen from './components/GameScreen';
import AccountControls from './components/AccountControls';
import { useEffect, useState } from 'react';
import { Toast, WorkspaceHeader, applyManaStyleFromUrl, applyCardFaceFromUrl, usePageRouteToken, LEAVE_DURATION_MS } from '@card-game/ui';
import '@card-game/ui/style.css';

/* The rune treatment is picked once per page load, from `?mana=1..5`. */
applyManaStyleFromUrl();
/* `?card=original` puts the untouched card face back for comparison. */
applyCardFaceFromUrl();
import { publicSession, resolvePublicRoute, verifyRoomResume } from '@card-game/browser-session';
import type { PlatformInfo } from '@card-game/protocol';
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
  const testContext = useGameStore(state => state.testContext);
  const identity = useAuthStore(state => state.browserSession);
  /* Lobby and board share one document, so switching between them needs the same
     out-then-in treatment a tab click gets: the outgoing view fades for 160ms before
     the other one mounts and runs its own entrance. */
  const wantsMatch = !!roomId || route.kind === 'room';
  const [view, setView] = useState<'lobby' | 'match'>(() => (wantsMatch ? 'match' : 'lobby'));
  const [viewLeaving, setViewLeaving] = useState(false);
  useEffect(() => {
    const target: 'lobby' | 'match' = wantsMatch ? 'match' : 'lobby';
    if (view === target) return;
    const reduceMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setViewLeaving(true);
    const timer = window.setTimeout(() => { setView(target); setViewLeaving(false); }, reduceMotion ? 0 : LEAVE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [wantsMatch, view]);
  /* The document was loaded with the token main.tsx wrote; this keeps it honest when
     a room id arrives through replaceState (lobby → match) or history pops. A room URL
     counts as a match even before the id has been verified, so the page never paints
     the lobby backdrop on its way to a board. */
  usePageRouteToken(route.kind === 'home' ? 'home' : route.kind === 'room' || roomId ? 'room' : 'play');
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
    <WorkspaceHeader navigation={platform?.navigation ?? null} scenariosAvailable={!!platform?.capabilities.scenarios} current={route.kind === 'home' ? 'home' : 'play'} account={roomId ? session?.account ?? identity?.account ?? null : identity?.account ?? session?.account ?? null} activeRoomId={roomId} breadcrumb={roomId ? 'Play / Match' : route.kind === 'home' ? 'Home' : 'Play / Lobby'} accountMenu={<AccountControls browserAccount={identity?.account} />} />
    {roomId&&testContext&&<p className="test-room-context" role="status">Test Lab · {testContext.name} · revision {testContext.revision} · source {testContext.scenarioId}</p>}
    {error && <Toast message={error} tone="error" onDismiss={() => setError(null)} />}
    {/* The out-then-in switch is driven by `view`: entering a room keeps the lobby
        mounted at opacity 0 for one beat instead of unmounting it in the same frame. */}
    {route.kind === 'invalid' ? <main><h1>Page unavailable</h1><a href="/home">Home</a> · <a href="/play">Play</a></main> : route.kind === 'home' ? <Home identity={identity} decksUrl={platform?.navigation.decks} /> : view === 'match' ? <GameScreen key="match" leaving={viewLeaving} /> : <StartScreen key="lobby" leaving={viewLeaving} decksUrl={platform?.navigation.decks} />}
  </>;
}
