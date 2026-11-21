import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './socket'; // Register handlers; App owns the Play/Home connection lifecycle.
import { resolvePublicRoute } from '@card-game/browser-session';
import { getStoredRoomId } from './session';
import { setPageRouteToken, installSmoothScroll } from '@card-game/ui';
import { playtestRoomId } from './playtest/session';

const PlaytestScreen = React.lazy(() => import('./playtest/PlaytestScreen'));
const OperatorTestRooms = React.lazy(() => import('./playtest/OperatorTestRooms'));

/* The route token is written here, in the module body, so it lands before the
   first paint: the page's own artwork (`html[data-route='…'] body`) is therefore
   requested by the first frame instead of by a post-paint effect. Without this the
   fade-in used to start over a flat colour and the picture appeared halfway
   through — the flicker this change removes. App keeps the token in step when the
   route changes without a document load (a room id arriving via replaceState). */
const initial = resolvePublicRoute(typeof window === 'undefined' ? '/' : window.location.pathname, typeof window === 'undefined' ? '' : window.location.search, getStoredRoomId());
const playtest = typeof window === 'undefined' ? undefined : playtestRoomId(window.location.pathname);
const operatorRooms = typeof window !== 'undefined' && /^\/play\/test-rooms\/?$/.test(window.location.pathname);
setPageRouteToken(initial.kind === 'home' ? 'home' : initial.kind === 'room' || playtest ? 'room' : 'play');
/* Inertial wheel scrolling for the whole document; internal scroll areas stay native. */
installSmoothScroll();



ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {playtest || operatorRooms ? <React.Suspense fallback={<main role="status">Loading Test Rooms…</main>}>
      {playtest ? <PlaytestScreen roomId={playtest} /> : <OperatorTestRooms />}
    </React.Suspense> : <App />}
  </React.StrictMode>,
);
