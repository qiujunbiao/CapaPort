import type { TenantContext } from '@capaport/contracts/organizations';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../config/config.js';
import { AppError } from '../../platform/errors/app-error.js';
import { type AnalyticsDataStore, AnalyticsService } from './analytics.service.js';

const organizationId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const tenant: TenantContext = {
  organizationId,
  membershipId: '00000000-0000-4000-8000-000000000003',
  organizationRole: 'owner',
};
const config = {
  auth: { verificationPepper: 'analytics-pepper-at-least-32-bytes' },
} as AppConfig;

describe('AnalyticsService', () => {
  it('stores a stable organization-scoped digest and only minimized event fields', async () => {
    const ingest = vi.fn<AnalyticsDataStore['ingest']>().mockResolvedValue(undefined);
    const service = new AnalyticsService({ ingest, metrics: vi.fn() }, config);

    await service.ingest(tenant, userId, {
      eventName: 'capability.installed',
      capabilityId: '00000000-0000-4000-8000-000000000004',
      agent: 'codex',
      outcome: 'success',
      source: 'desktop',
      durationBucket: '1s_10s',
    });

    expect(ingest).toHaveBeenCalledOnce();
    const stored = ingest.mock.calls[0]?.[0];
    expect(stored).toBeDefined();
    if (!stored) throw new Error('Expected an analytics event');
    expect(stored?.actorDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.actorDigest).not.toContain(userId);
    expect(stored?.data).toEqual({ agent: 'codex', outcome: 'success', source: 'desktop', durationBucket: '1s_10s' });
    expect(stored).not.toHaveProperty('userId');
    expect(stored.expiresAt.getTime() - stored.occurredAt.getTime()).toBe(400 * 86_400_000);
  });

  it('restricts aggregate metrics to governance roles and validates the range', async () => {
    const metrics = vi.fn<AnalyticsDataStore['metrics']>().mockResolvedValue({ activeDevices: 1 });
    const service = new AnalyticsService({ ingest: vi.fn(), metrics }, config);
    const member = { ...tenant, organizationRole: 'member' as const };

    expect(() => service.metrics(member, {})).toThrowError(AppError);
    expect(() =>
      service.metrics(tenant, { from: '2024-01-01T00:00:00.000Z', to: '2025-02-01T00:00:00.000Z' }),
    ).toThrowError(AppError);

    await expect(
      service.metrics(tenant, { from: '2026-08-01T00:00:00.000Z', to: '2026-08-02T00:00:00.000Z' }),
    ).resolves.toEqual({ activeDevices: 1 });
    expect(metrics).toHaveBeenCalledWith(
      organizationId,
      new Date('2026-08-01T00:00:00.000Z'),
      new Date('2026-08-02T00:00:00.000Z'),
    );
  });
});
