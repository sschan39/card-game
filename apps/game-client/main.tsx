import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './socket'; // Register handlers; App owns the Play/Home connection lifecycle.

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
