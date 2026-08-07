import type { TenantContext } from '@agentdoor/contracts/organizations';
import { describe, expect, it, vi } from 'vitest';
import {
  type OrganizationDataStore,
  type OrganizationInvitationSender,
  OrganizationService,
} from './organization.service.js';

const ownerContext: TenantContext = {
  organizationId: 'org-1',
  membershipId: 'membership-owner',
  organizationRole: 'owner',
};

function dependencies() {
  const repository: OrganizationDataStore = {
    createOrganization: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Acme', slug: 'acme', status: 'active' }),
    listOrganizations: vi.fn(),
    findOrganization: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Acme', slug: 'acme', status: 'active' }),
    updateOrganization: vi.fn(),
    archiveOrganization: vi.fn(),
    listMembers: vi.fn(),
    findMembership: vi.fn(),
    countOwners: vi.fn(),
    changeRole: vi.fn(),
    disableMembership: vi.fn(),
    transferOwnership: vi.fn(),
    leaveOrganization: vi.fn(),
    createInvitation: vi.fn().mockResolvedValue(undefined),
    listInvitations: vi.fn(),
    revokeInvitation: vi.fn(),
    acceptInvitation: vi.fn(),
  };
  const tenants = { switch: vi.fn().mockResolvedValue(ownerContext) };
  const sender: OrganizationInvitationSender = { send: vi.fn().mockResolvedValue(undefined) };
  return { repository, tenants, sender };
}

describe('OrganizationService', () => {
  it('creates the first membership as owner and switches the active session', async () => {
    const deps = dependencies();
    const result = await new OrganizationService(deps.repository, deps.tenants, deps.sender, {
      verificationPepper: 'organization-test-pepper-longer-than-thirty-two-characters',
    }).create('user-1', 'session-1', { name: 'Acme', slug: 'acme' });
    expect(result).toMatchObject({ id: 'org-1', role: 'owner' });
    expect(deps.repository.createOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', ownerMembershipId: expect.any(String) }),
    );
    expect(deps.tenants.switch).toHaveBeenCalledWith('user-1', 'session-1', 'org-1');
  });

  it('delivers expiring single-use invitation tokens without exposing them in API responses', async () => {
    const deps = dependencies();
    const service = new OrganizationService(deps.repository, deps.tenants, deps.sender, {
      verificationPepper: 'organization-test-pepper-longer-than-thirty-two-characters',
    });
    const response = await service.invite(ownerContext, 'user-1', {
      kind: 'email',
      target: 'Invitee@Example.com',
      role: 'member',
    });
    expect(response).toMatchObject({ maskedTarget: 'in***@example.com', expiresIn: 604800 });
    expect(response).not.toHaveProperty('token');
    expect(deps.repository.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        target: 'invitee@example.com',
        tokenDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(deps.sender.send).toHaveBeenCalledWith(expect.objectContaining({ token: expect.any(String) }));
  });

  it('rejects expired and replayed invitations with stable error codes', async () => {
    const deps = dependencies();
    vi.mocked(deps.repository.acceptInvitation)
      .mockResolvedValueOnce({ status: 'expired' })
      .mockResolvedValueOnce({ status: 'already_used' });
    const service = new OrganizationService(deps.repository, deps.tenants, deps.sender, {
      verificationPepper: 'organization-test-pepper-longer-than-thirty-two-characters',
    });
    await expect(service.accept('user-1', 'session-1', 'invitation-token-that-is-long-enough')).rejects.toMatchObject({
      code: 'INVITATION_EXPIRED',
    });
    await expect(service.accept('user-1', 'session-1', 'invitation-token-that-is-long-enough')).rejects.toMatchObject({
      code: 'INVITATION_ALREADY_USED',
    });
  });
});
