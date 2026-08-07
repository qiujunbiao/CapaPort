import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createCloudClient } from './app/cloud-client';
import { DesktopApp } from './app/desktop-app';
import { createLocalClient } from './app/local-client';
import { createSecureSessionStore, desktopSessionStore } from './app/session-store';
import './styles.css';

declare global {
  interface Window {
    __AGENTDOOR_E2E__?: {
      cloud: ReturnType<typeof createCloudClient>;
      local: ReturnType<typeof createLocalClient>;
      sessionStore: typeof desktopSessionStore;
    };
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Desktop root element is missing');

const injected = window.__AGENTDOOR_E2E__;
const local = injected?.local ?? createLocalClient();
const secureSessionStore = injected ? undefined : createSecureSessionStore(local);
if (secureSessionStore) await secureSessionStore.hydrate();
const sessionStore = injected?.sessionStore ?? secureSessionStore ?? desktopSessionStore;
createRoot(root).render(
  <StrictMode>
    <DesktopApp cloud={injected?.cloud ?? createCloudClient()} local={local} sessionStore={sessionStore} />
  </StrictMode>,
);
