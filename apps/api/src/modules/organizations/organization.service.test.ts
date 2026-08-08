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
    requestClosure: vi.fn().mockImplementation(async (_org, _user, _membership, scheduledAt) => ({
      id: 'org-1',
      name: 'Acme',
      slug: 'acme',
      status: 'closing',
      deletionScheduledAt: scheduledAt,
    })),
    cancelClosure: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Acme', slug: 'acme', status: 'active' }),
    exportOrganization: vi.fn().mockResolvedValue({ schemaVersion: 1 }),
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

  it('requires owner confirmation and schedules organization deletion after a grace period', async () => {
    const deps = dependencies();
    const service = new OrganizationService(deps.repository, deps.tenants, deps.sender, {
      verificationPepper: 'organization-test-pepper-longer-than-thirty-two-characters',
    });
    await expect(service.close(ownerContext, 'user-1', 'wrong')).rejects.toMatchObject({
      code: 'ORGANIZATION_CONFIRMATION_MISMATCH',
    });
    const result = await service.close(ownerContext, 'user-1', 'acme');
    expect(result.status).toBe('closing');
    expect(deps.repository.requestClosure).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      'membership-owner',
      expect.any(Date),
    );
    const scheduledAt = vi.mocked(deps.repository.requestClosure).mock.calls[0]?.[3];
    expect(scheduledAt?.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  });

  it('limits organization exports to owners and auditors', async () => {
    const deps = dependencies();
    const service = new OrganizationService(deps.repository, deps.tenants, deps.sender, {
      verificationPepper: 'organization-test-pepper-longer-than-thirty-two-characters',
    });
    await expect(service.export({ ...ownerContext, organizationRole: 'member' })).rejects.toMatchObject({
      code: 'ACCESS_DENIED',
    });
    await expect(service.export(ownerContext)).resolves.toEqual({ schemaVersion: 1 });
  });
});
