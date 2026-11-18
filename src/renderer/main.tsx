import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Tailwind's font-mono and the terminal both ask for JetBrains Mono, which was
// never shipped: each machine fell back to its own monospace, with its own
// character width -- and a terminal sized for one width wraps wrongly in another.
import '@fontsource/jetbrains-mono/400.css';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
