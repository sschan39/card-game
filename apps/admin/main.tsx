import React from 'react';
import ReactDOM from 'react-dom/client';
import { installSmoothScroll } from '@card-game/ui';
import App from './App';
import './style.css';

/* Inertial wheel scrolling for the whole document; internal log/table areas stay native. */
installSmoothScroll();

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
