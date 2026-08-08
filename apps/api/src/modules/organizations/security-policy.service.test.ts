import type { TenantContext } from '@capaport/contracts/organizations';
import { describe, expect, it, vi } from 'vitest';
import {
  defaultOrganizationSecurityPolicy,
  type OrganizationSecurityPolicyStore,
  SecurityPolicyService,
} from './security-policy.service.js';

const owner: TenantContext = {
  organizationId: 'org-1',
  membershipId: 'membership-owner',
  organizationRole: 'owner',
};

function dependencies() {
  const store: OrganizationSecurityPolicyStore = {
    find: vi.fn(),
    upsert: vi.fn(),
  };
  return { store, service: new SecurityPolicyService(store) };
}

describe('SecurityPolicyService', () => {
  it('returns the safe default policy when an organization has not customized it', async () => {
    const { service } = dependencies();
    await expect(service.get({ ...owner, organizationRole: 'member' })).resolves.toEqual(
      defaultOrganizationSecurityPolicy,
    );
  });

  it('prevents regular members and auditors from changing organization policy', async () => {
    const { service } = dependencies();
    await expect(
      service.update({ ...owner, organizationRole: 'member' }, defaultOrganizationSecurityPolicy),
    ).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    await expect(
      service.update({ ...owner, organizationRole: 'auditor' }, defaultOrganizationSecurityPolicy),
    ).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });

  it('allows owners and admins to persist an audited policy update', async () => {
    const { service, store } = dependencies();
    const policy = {
      ...defaultOrganizationSecurityPolicy,
      blockedTerms: ['private-customer-name'],
      allowedNetworkHosts: ['registry.example.com'],
      executablePolicy: 'allow-listed' as const,
    };
    vi.mocked(store.upsert).mockResolvedValue(policy);

    await expect(service.update(owner, policy)).resolves.toEqual(policy);
    expect(store.upsert).toHaveBeenCalledWith('org-1', 'membership-owner', policy);
  });
});
