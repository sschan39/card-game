import React from 'react';
import ReactDOM from 'react-dom/client';
import { LocaleProvider, applyDocumentLocale, resolveInitialLocale, installSmoothScroll } from '@card-game/ui';
import App from './App';
import './style.css';

/* The admin app shares the same language choice: one operator switching language
   expects the console to follow, not only the player app. */
applyDocumentLocale(resolveInitialLocale());
/* Inertial wheel scrolling for the whole document; internal log/table areas stay native. */
installSmoothScroll();

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><LocaleProvider><App /></LocaleProvider></React.StrictMode>);
