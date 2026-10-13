/// <reference types="vite/client" />
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';


createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const registerOfflineShell = () => {
    navigator.serviceWorker.register('/service-worker.js').catch((error: unknown) => {
      console.warn('Offline support could not be enabled.', error);
    });
  };
  if (document.readyState === 'complete') registerOfflineShell();
  else window.addEventListener('load', registerOfflineShell, { once: true });
}
