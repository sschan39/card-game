import React from 'react';
import ReactDOM from 'react-dom/client';
import { setPageRouteToken, installSmoothScroll } from '@card-game/ui';
import App from './App';
import '@card-game/ui/style.css';
import './style.css';

/* Written before the first paint so the deck header artwork (`html[data-route='decks']`)
   is requested by the first frame instead of by a post-paint effect. */
setPageRouteToken('decks');
/* Inertial wheel scrolling for the whole document; internal scroll areas stay native. */
installSmoothScroll();

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
