import type { WebSession, WebSessionStore } from './types';

export function createMemoryWebSessionStore(initial?: WebSession): WebSessionStore {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(session) {
      current = session;
      for (const listener of listeners) listener();
    },
    clear() {
      current = undefined;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createBrowserSessionStore(): WebSessionStore {
  const key = 'agentdoor:web-session';
  let initial: WebSession | undefined;
  try {
    const raw = sessionStorage.getItem(key);
    initial = raw ? (JSON.parse(raw) as WebSession) : undefined;
  } catch {
    initial = undefined;
  }
  const memory = createMemoryWebSessionStore(initial);
  return {
    ...memory,
    set(session) {
      sessionStorage.setItem(key, JSON.stringify(session));
      memory.set(session);
    },
    clear() {
      sessionStorage.removeItem(key);
      memory.clear();
    },
  };
}
