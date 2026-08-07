import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createWebClient } from './app/api-client';
import { createBrowserSessionStore } from './app/session-store';
import type { WebClient, WebSessionStore } from './app/types';
import { WebApp } from './app/web-app';
import './styles.css';

declare global {
  interface Window {
    __AGENTDOOR_WEB_E2E__?: { client: WebClient; sessionStore: WebSessionStore };
  }
}

const sessionStore = window.__AGENTDOOR_WEB_E2E__?.sessionStore ?? createBrowserSessionStore();
const client =
  window.__AGENTDOOR_WEB_E2E__?.client ??
  createWebClient(import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3210/api/v1', sessionStore);
const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing.');
createRoot(root).render(
  <StrictMode>
    <WebApp client={client} sessionStore={sessionStore} />
  </StrictMode>,
);
