import type { TenantContext } from '@capaport/contracts/organizations';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../platform/errors/app-error.js';
import { type AuditDataStore, AuditService } from './audit.service.js';

const tenant: TenantContext = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  membershipId: '00000000-0000-4000-8000-000000000002',
  organizationRole: 'auditor',
};

describe('AuditService', () => {
  it('queries only the active tenant and redacts sensitive metadata at read time', async () => {
    const list = vi.fn<AuditDataStore['list']>().mockResolvedValue({
      entries: [
        {
          id: '00000000-0000-4000-8000-000000000003',
          action: 'capability.created',
          resourceType: 'capability',
          resourceId: '00000000-0000-4000-8000-000000000004',
          metadata: { safe: 'visible', nested: { token: 'private', path: '/Users/private/project' } },
          createdAt: new Date('2026-08-07T00:00:00.000Z'),
        },
      ],
    });
    const service = new AuditService({ list });

    const result = await service.list(tenant, { limit: 50 });

    expect(list).toHaveBeenCalledWith(tenant.organizationId, { limit: 50 });
    expect(result.entries[0]?.metadata).toEqual({
      safe: 'visible',
      nested: { token: '[redacted]', path: '[redacted]' },
    });
  });

  it('denies ordinary members before querying the repository', async () => {
    const list = vi.fn<AuditDataStore['list']>();
    const service = new AuditService({ list });

    await expect(service.list({ ...tenant, organizationRole: 'member' }, { limit: 50 })).rejects.toBeInstanceOf(
      AppError,
    );
    expect(list).not.toHaveBeenCalled();
  });
});
