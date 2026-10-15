import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { Capacitor } from '@capacitor/core';
import { initBackground } from './platform/background';
import { App } from './ui/App';
import { next } from './ui/controller';
import './ui/styles.css';

initBackground({ next: () => void next() });

// Dev-only handle for inspecting playback from the browser console.
if (import.meta.env.DEV) {
  void Promise.all([import('tone'), import('./engine/player')]).then(([Tone, { player }]) => {
    (window as unknown as { __mh: unknown }).__mh = { Tone, player };
  });
}

// The Android app bundles its files, so the service worker is only for the installed web app.
if (!Capacitor.isNativePlatform()) registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
