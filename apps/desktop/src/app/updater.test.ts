import { describe, expect, it, vi } from 'vitest';
import { createDesktopUpdater, type DesktopUpdate } from './updater.js';

function updateFixture(overrides: Partial<DesktopUpdate> = {}): DesktopUpdate {
  return {
    currentVersion: '0.1.0',
    version: '0.2.0',
    date: '2026-08-08T00:00:00.000Z',
    body: 'Security and reliability update.',
    downloadAndInstall: vi.fn(async (onEvent) => {
      onEvent({ event: 'Started', data: { contentLength: 10 } });
      onEvent({ event: 'Progress', data: { chunkLength: 10 } });
      onEvent({ event: 'Finished' });
    }),
    ...overrides,
  };
}

describe('desktop updater', () => {
  it('does not contact the release endpoint when online updates are disabled', async () => {
    const check = vi.fn(async () => null);
    const updater = createDesktopUpdater({ check, relaunch: vi.fn() }, { enabled: false });

    expect(updater.state()).toEqual({ status: 'disabled' });
    await expect(updater.check()).resolves.toEqual({ status: 'disabled' });
    expect(check).not.toHaveBeenCalled();
  });

  it('checks, downloads a signed update, reports progress, and relaunches only after install', async () => {
    const update = updateFixture();
    const relaunch = vi.fn(async () => undefined);
    const updater = createDesktopUpdater({ check: vi.fn(async () => update), relaunch });
    await expect(updater.check()).resolves.toMatchObject({ status: 'available', version: '0.2.0' });
    await expect(updater.install()).resolves.toMatchObject({ status: 'ready', progress: 100 });
    expect(relaunch).not.toHaveBeenCalled();
    await updater.restart();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it('reports current, manifest, download, and restart failures without claiming success', async () => {
    const current = createDesktopUpdater({ check: vi.fn(async () => null), relaunch: vi.fn() });
    await expect(current.check()).resolves.toMatchObject({ status: 'current' });

    const manifestFailure = createDesktopUpdater({
      check: vi.fn(async () => {
        throw new Error('signature invalid');
      }),
      relaunch: vi.fn(),
    });
    await expect(manifestFailure.check()).resolves.toMatchObject({ status: 'error', error: 'signature invalid' });

    const downloadFailure = createDesktopUpdater({
      check: vi.fn(async () => updateFixture({ downloadAndInstall: vi.fn(async () => Promise.reject('offline')) })),
      relaunch: vi.fn(),
    });
    await downloadFailure.check();
    await expect(downloadFailure.install()).resolves.toMatchObject({ status: 'error', error: 'offline' });
    await expect(downloadFailure.restart()).resolves.toMatchObject({ status: 'error' });
  });
});
