import { describe, expect, it, vi } from 'vitest';
import { type DependencyProbe, HealthService } from './health.service.js';

describe('HealthService', () => {
  it('returns healthy when every required dependency responds', async () => {
    const probe: DependencyProbe = { name: 'database', check: vi.fn().mockResolvedValue(undefined) };
    await expect(new HealthService([probe]).ready()).resolves.toEqual({
      status: 'ok',
      dependencies: { database: 'up' },
    });
  });

  it('returns an unavailable result without changing liveness when a dependency fails', async () => {
    const probe: DependencyProbe = { name: 'database', check: vi.fn().mockRejectedValue(new Error('offline')) };
    const service = new HealthService([probe]);
    await expect(service.ready()).resolves.toEqual({ status: 'unavailable', dependencies: { database: 'down' } });
    expect(service.live()).toEqual({ status: 'ok' });
  });
});
