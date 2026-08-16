import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
// IBM Plex, loaded here rather than by Carbon — see the note in styles/index.scss.
// The `-default` bundles carry the Latin ranges at weights 300/400/600, which is
// what Carbon's type scale uses (~8KB of CSS each vs ~44KB for `-all`).
import '@ibm/plex-sans/css/ibm-plex-sans-default.css';
import '@ibm/plex-mono/css/ibm-plex-mono-default.css';
import './styles/index.scss';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
