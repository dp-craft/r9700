import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';

// Dev-only self-heal: a service worker registered by a prior production build or
// preview at this origin persists across rebuilds and keeps serving stale,
// precached assets — causing 404s on renamed chunks and a broken app shell under
// the dev server. The dev server itself registers no SW (vite-plugin-pwa
// devOptions disabled), so unregistering any leftover registration and purging
// its caches here is safe and a no-op in a clean dev session. Skipped in
// production, where the PWA service worker is intended to run.
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then(registrations => {
    registrations.forEach(registration => {
      void registration.unregister();
    });
  });
  if ('caches' in window) {
    void caches.keys().then(keys => {
      keys.forEach(key => {
        void caches.delete(key);
      });
    });
  }
}

const rootElement: HTMLElement | null = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
