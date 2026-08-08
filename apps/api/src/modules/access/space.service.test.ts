import type { TenantContext } from '@capaport/contracts/organizations';
import { describe, expect, it, vi } from 'vitest';
import { type SpaceDataStore, SpaceService } from './space.service.js';

describe('SpaceService', () => {
  it('generates an internal slug when a space is created from its display name only', async () => {
    const createSpace = vi.fn(async (input) => ({
      ...input,
      status: 'active' as const,
      role: 'manager' as const,
    }));
    const service = new SpaceService({ createSpace } as unknown as SpaceDataStore);
    const tenant: TenantContext = {
      organizationId: 'org-a',
      membershipId: 'membership-a',
      organizationRole: 'owner',
    };

    await service.create(tenant, 'user-a', {
      type: 'team',
      name: '团队一',
      reviewPolicy: 'required',
    });

    expect(createSpace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '团队一',
        slug: expect.stringMatching(/^space-[a-f0-9]{12}$/),
      }),
    );
  });
});
