import type { LocalClient, Session, SessionStore } from './types';

export function createMemorySessionStore(initial?: Session): SessionStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (session) => {
      value = session;
      for (const listener of listeners) listener();
    },
    clear: () => {
      value = undefined;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const desktopSessionStore = createMemorySessionStore();

export function createSecureSessionStore(local: LocalClient): SessionStore & { hydrate(): Promise<void> } {
  const memory = createMemorySessionStore();
  return {
    ...memory,
    set(session) {
      memory.set(session);
      void local.storeSession?.(session);
    },
    clear() {
      memory.clear();
      void local.clearSession?.();
    },
    async hydrate() {
      const session = await local.loadSession?.().catch(() => undefined);
      if (session) memory.set(session);
    },
  };
}
