export type DesktopDownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

export type DesktopUpdate = {
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
  downloadAndInstall(onEvent: (event: DesktopDownloadEvent) => void): Promise<void>;
};

export type DesktopUpdaterBridge = {
  check(): Promise<DesktopUpdate | null>;
  relaunch(): Promise<void>;
};

export type DesktopUpdaterState = {
  status: 'disabled' | 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error';
  currentVersion?: string;
  version?: string;
  date?: string;
  body?: string;
  progress?: number;
  error?: string;
};

export type DesktopUpdater = {
  state(): DesktopUpdaterState;
  check(): Promise<DesktopUpdaterState>;
  install(onState?: (state: DesktopUpdaterState) => void): Promise<DesktopUpdaterState>;
  restart(): Promise<DesktopUpdaterState>;
};

function message(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return '桌面更新操作失败';
}

export function createDesktopUpdater(
  bridge: DesktopUpdaterBridge,
  options: { enabled?: boolean } = {},
): DesktopUpdater {
  const enabled = options.enabled !== false;
  let current: DesktopUpdaterState = { status: enabled ? 'idle' : 'disabled' };
  let update: DesktopUpdate | undefined;

  return {
    state: () => current,
    async check() {
      if (!enabled) return current;
      current = { status: 'checking' };
      try {
        update = (await bridge.check()) ?? undefined;
        current = update
          ? {
              status: 'available',
              currentVersion: update.currentVersion,
              version: update.version,
              ...(update.date ? { date: update.date } : {}),
              ...(update.body ? { body: update.body } : {}),
            }
          : { status: 'current' };
      } catch (error) {
        update = undefined;
        current = { status: 'error', error: message(error) };
      }
      return current;
    },
    async install(onState) {
      if (!update) {
        current = { status: 'error', error: '请先检查并选择可用更新' };
        return current;
      }
      const metadata = current;
      let downloaded = 0;
      let total = 0;
      current = { ...metadata, status: 'downloading', progress: 0 };
      onState?.(current);
      try {
        await update.downloadAndInstall((event) => {
          if (event.event === 'Started') total = event.data.contentLength ?? 0;
          if (event.event === 'Progress') downloaded += event.data.chunkLength;
          current = {
            ...current,
            status: 'downloading',
            progress: total > 0 ? Math.min(99, Math.round((downloaded / total) * 100)) : 0,
          };
          if (event.event === 'Finished') current = { ...current, status: 'ready', progress: 100 };
          onState?.(current);
        });
        current = { ...current, status: 'ready', progress: 100 };
        onState?.(current);
      } catch (error) {
        current = { ...metadata, status: 'error', error: message(error) };
        onState?.(current);
      }
      return current;
    },
    async restart() {
      if (current.status !== 'ready') {
        current = { ...current, status: 'error', error: '更新尚未完成，不能重启应用' };
        return current;
      }
      try {
        await bridge.relaunch();
      } catch (error) {
        current = { ...current, status: 'error', error: message(error) };
      }
      return current;
    },
  };
}

export function createTauriUpdater(): DesktopUpdater {
  return createDesktopUpdater(
    {
      check: async () => {
        const { check } = await import('@tauri-apps/plugin-updater');
        return check({ timeout: 30_000 });
      },
      relaunch: async () => {
        const { relaunch } = await import('@tauri-apps/plugin-process');
        await relaunch();
      },
    },
    { enabled: import.meta.env.VITE_UPDATER_ENABLED === 'true' },
  );
}
