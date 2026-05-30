import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

function App() {
  return (
    <div className="min-h-dvh flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-6xl font-black tracking-tight">PERFLIX</h1>
        <p className="mt-4 text-neutral-400">Phase 0 bootstrap online.</p>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
