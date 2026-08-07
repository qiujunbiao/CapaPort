import { describe, expect, it, vi } from 'vitest';
import { TenantContextService, type TenantStore } from './tenant-context.service.js';

describe('TenantContextService', () => {
  it('resolves only active memberships and rejects guessed cross-tenant identifiers', async () => {
    const store: TenantStore = {
      currentOrganizationId: vi.fn().mockResolvedValue('org-a'),
      findActiveMembership: vi.fn(async (organizationId, userId) =>
        organizationId === 'org-a' && userId === 'user-a'
          ? { id: 'membership-a', organizationId: 'org-a', userId: 'user-a', role: 'member' as const }
          : undefined,
      ),
      setCurrentOrganization: vi.fn(),
    };
    const service = new TenantContextService(store);
    await expect(service.resolve('user-a', 'session-a')).resolves.toEqual({
      organizationId: 'org-a',
      membershipId: 'membership-a',
      organizationRole: 'member',
    });
    await expect(service.resolve('user-a', 'session-a', 'org-b')).rejects.toMatchObject({
      code: 'TENANT_ACCESS_DENIED',
    });
    expect(store.findActiveMembership).toHaveBeenLastCalledWith('org-b', 'user-a');
  });
});
