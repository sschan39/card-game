import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './socket'; // Register handlers; App owns the Play/Home connection lifecycle.
import { resolvePublicRoute } from '@card-game/browser-session';
import { setPageRouteToken, installSmoothScroll } from '@card-game/ui';

/* The route token is written here, in the module body, so it lands before the
   first paint: the page's own artwork (`html[data-route='…'] body`) is therefore
   requested by the first frame instead of by a post-paint effect. Without this the
   fade-in used to start over a flat colour and the picture appeared halfway
   through — the flicker this change removes. App keeps the token in step when the
   route changes without a document load (a room id arriving via replaceState). */
const initial = resolvePublicRoute(typeof window === 'undefined' ? '/' : window.location.pathname);
setPageRouteToken(initial.kind === 'home' ? 'home' : initial.kind === 'room' ? 'room' : 'play');
/* Inertial wheel scrolling for the whole document; internal scroll areas stay native. */
installSmoothScroll();



ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
