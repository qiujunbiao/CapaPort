import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type {
  CreateOrganizationRequest,
  InviteMemberRequest,
  OrganizationRole,
  OrganizationSummary,
  TenantContext,
  UpdateOrganizationRequest,
} from '@capaport/contracts/organizations';
import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../../config/config.js';
import { APP_CONFIG } from '../../config/config.js';
import { AppError } from '../../platform/errors/app-error.js';
import type { TenantContextService } from '../../platform/tenancy/tenant-context.service.js';
import { maskIdentity, normalizeIdentity } from '../identity/identity.policy.js';
import {
  canChangeMemberRole,
  canManageOrganization,
  canRemoveMember,
  requireAnotherOwner,
} from './organization.policy.js';

export type OrganizationRecord = {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'closing' | 'archived';
  deletionScheduledAt?: Date;
};
export type OrganizationMember = {
  id: string;
  userId: string;
  displayName: string;
  role: OrganizationRole;
  status: 'active' | 'disabled' | 'left';
  joinedAt: Date;
};
export type InvitationAcceptance =
  | { status: 'accepted'; organizationId: string; membershipId: string }
  | { status: 'not_found' | 'expired' | 'revoked' | 'already_used' | 'identity_mismatch' | 'organization_inactive' };
export type OrganizationInvitation = {
  id: string;
  kind: 'email' | 'phone';
  target: string;
  role: Exclude<OrganizationRole, 'owner'>;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

export interface OrganizationDataStore {
  createOrganization(input: {
    organizationId: string;
    ownerMembershipId: string;
    userId: string;
    name: string;
    slug: string;
  }): Promise<OrganizationRecord>;
  listOrganizations(userId: string): Promise<OrganizationSummary[]>;
  findOrganization(organizationId: string): Promise<OrganizationRecord | undefined>;
  updateOrganization(
    organizationId: string,
    actorMembershipId: string,
    input: UpdateOrganizationRequest,
  ): Promise<OrganizationRecord>;
  requestClosure(
    organizationId: string,
    actorUserId: string,
    actorMembershipId: string,
    scheduledAt: Date,
  ): Promise<OrganizationRecord>;
  cancelClosure(organizationId: string, actorUserId: string, actorMembershipId: string): Promise<OrganizationRecord>;
  exportOrganization(organizationId: string): Promise<Record<string, unknown>>;
  listMembers(organizationId: string): Promise<OrganizationMember[]>;
  findMembership(organizationId: string, membershipId: string): Promise<OrganizationMember | undefined>;
  countOwners(organizationId: string): Promise<number>;
  changeRole(
    organizationId: string,
    membershipId: string,
    role: OrganizationRole,
    actorMembershipId: string,
  ): Promise<void>;
  disableMembership(organizationId: string, membershipId: string, actorMembershipId: string): Promise<void>;
  transferOwnership(organizationId: string, fromMembershipId: string, toMembershipId: string): Promise<void>;
  leaveOrganization(organizationId: string, membershipId: string): Promise<void>;
  createInvitation(input: {
    id: string;
    organizationId: string;
    kind: 'email' | 'phone';
    target: string;
    role: Exclude<OrganizationRole, 'owner'>;
    tokenDigest: string;
    invitedByMembershipId: string;
    expiresAt: Date;
  }): Promise<void>;
  listInvitations(organizationId: string): Promise<OrganizationInvitation[]>;
  revokeInvitation(organizationId: string, invitationId: string, actorMembershipId: string): Promise<void>;
  acceptInvitation(tokenDigest: string, userId: string, now: Date): Promise<InvitationAcceptance>;
}

export type InvitationDelivery = {
  invitationId: string;
  organizationId: string;
  kind: 'email' | 'phone';
  target: string;
  organizationName: string;
  token: string;
  expiresAt: Date;
};

export interface OrganizationInvitationSender {
  send(input: InvitationDelivery): Promise<void>;
}

type OrganizationSecurityConfig = Pick<AppConfig['auth'], 'verificationPepper'>;

@Injectable()
export class OrganizationService {
  private readonly config: OrganizationSecurityConfig;

  constructor(
    @Inject('ORGANIZATION_DATA_STORE') private readonly repository: OrganizationDataStore,
    @Inject('TENANT_CONTEXT_SERVICE') private readonly tenants: Pick<TenantContextService, 'switch'>,
    @Inject('ORGANIZATION_INVITATION_SENDER') private readonly sender: OrganizationInvitationSender,
    @Inject(APP_CONFIG) config: OrganizationSecurityConfig | AppConfig,
  ) {
    this.config = 'auth' in config ? config.auth : config;
  }

  async create(userId: string, sessionId: string, input: CreateOrganizationRequest): Promise<OrganizationSummary> {
    let organization: OrganizationRecord;
    try {
      organization = await this.repository.createOrganization({
        organizationId: randomUUID(),
        ownerMembershipId: randomUUID(),
        userId,
        name: input.name.trim(),
        slug: input.slug,
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new AppError('ORGANIZATION_SLUG_EXISTS', 'This organization URL is already in use.', 409);
      }
      throw error;
    }
    await this.tenants.switch(userId, sessionId, organization.id);
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
      role: 'owner',
      ...(organization.deletionScheduledAt
        ? { deletionScheduledAt: organization.deletionScheduledAt.toISOString() }
        : {}),
    };
  }

  list(userId: string): Promise<OrganizationSummary[]> {
    return this.repository.listOrganizations(userId);
  }

  switch(userId: string, sessionId: string, organizationId: string): Promise<TenantContext> {
    return this.tenants.switch(userId, sessionId, organizationId);
  }

  async get(context: TenantContext): Promise<OrganizationRecord> {
    const organization = await this.repository.findOrganization(context.organizationId);
    if (!organization) throw new AppError('ORGANIZATION_NOT_FOUND', 'Organization not found.', 404);
    return organization;
  }

  async update(context: TenantContext, input: UpdateOrganizationRequest): Promise<OrganizationRecord> {
    this.requireManager(context.organizationRole);
    return this.repository.updateOrganization(context.organizationId, context.membershipId, input);
  }

  async close(context: TenantContext, actorUserId: string, confirmation?: string): Promise<OrganizationRecord> {
    if (context.organizationRole !== 'owner')
      throw new AppError('ACCESS_DENIED', 'Only an owner can close the organization.', 403);
    const organization = await this.get(context);
    if (organization.status === 'closing') return organization;
    if (confirmation !== undefined && confirmation !== organization.slug && confirmation !== organization.name) {
      throw new AppError('ORGANIZATION_CONFIRMATION_MISMATCH', 'Enter the organization name or slug to confirm.', 400);
    }
    return this.repository.requestClosure(
      context.organizationId,
      actorUserId,
      context.membershipId,
      new Date(Date.now() + 30 * 86_400_000),
    );
  }

  async cancelClosure(context: TenantContext, actorUserId: string): Promise<OrganizationRecord> {
    if (context.organizationRole !== 'owner')
      throw new AppError('ACCESS_DENIED', 'Only an owner can cancel organization closure.', 403);
    return this.repository.cancelClosure(context.organizationId, actorUserId, context.membershipId);
  }

  async export(context: TenantContext): Promise<Record<string, unknown>> {
    if (context.organizationRole !== 'owner' && context.organizationRole !== 'auditor') {
      throw new AppError('ACCESS_DENIED', 'Owner or auditor access is required to export organization data.', 403);
    }
    return this.repository.exportOrganization(context.organizationId);
  }

  members(context: TenantContext): Promise<OrganizationMember[]> {
    return this.repository.listMembers(context.organizationId);
  }

  async invite(
    context: TenantContext,
    _actorUserId: string,
    input: InviteMemberRequest,
  ): Promise<{ id: string; maskedTarget: string; expiresIn: number }> {
    if (!canChangeMemberRole(context.organizationRole, 'member', input.role)) {
      throw new AppError('ACCESS_DENIED', 'You cannot invite a member with this role.', 403);
    }
    const target = normalizeIdentity(input.kind, input.target);
    const token = randomBytes(32).toString('base64url');
    const invitationId = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    await this.repository.createInvitation({
      id: invitationId,
      organizationId: context.organizationId,
      kind: input.kind,
      target,
      role: input.role,
      tokenDigest: this.digestInvitation(token),
      invitedByMembershipId: context.membershipId,
      expiresAt,
    });
    const organization = await this.get(context);
    await this.sender.send({
      invitationId,
      organizationId: context.organizationId,
      kind: input.kind,
      target,
      organizationName: organization.name,
      token,
      expiresAt,
    });
    return { id: invitationId, maskedTarget: maskIdentity(input.kind, target), expiresIn: 604_800 };
  }

  async invitations(context: TenantContext) {
    this.requireManager(context.organizationRole);
    const invitations = await this.repository.listInvitations(context.organizationId);
    return invitations.map(({ target, ...invitation }) => ({
      ...invitation,
      maskedTarget: maskIdentity(invitation.kind, target),
    }));
  }

  async revokeInvitation(context: TenantContext, invitationId: string): Promise<void> {
    this.requireManager(context.organizationRole);
    await this.repository.revokeInvitation(context.organizationId, invitationId, context.membershipId);
  }

  async accept(userId: string, sessionId: string, token: string): Promise<TenantContext> {
    const result = await this.repository.acceptInvitation(this.digestInvitation(token), userId, new Date());
    if (result.status === 'accepted') return this.tenants.switch(userId, sessionId, result.organizationId);
    const errors: Record<Exclude<InvitationAcceptance['status'], 'accepted'>, [string, string, number]> = {
      not_found: ['INVITATION_INVALID', 'The invitation is invalid.', 404],
      expired: ['INVITATION_EXPIRED', 'The invitation has expired.', 410],
      revoked: ['INVITATION_REVOKED', 'The invitation was revoked.', 410],
      already_used: ['INVITATION_ALREADY_USED', 'The invitation has already been used.', 409],
      identity_mismatch: [
        'INVITATION_IDENTITY_MISMATCH',
        'Sign in with the invited email address or phone number.',
        403,
      ],
      organization_inactive: ['INVITATION_ORGANIZATION_INACTIVE', 'The organization is no longer active.', 410],
    };
    const [code, message, status] = errors[result.status];
    throw new AppError(code, message, status);
  }

  async changeRole(
    context: TenantContext,
    membershipId: string,
    role: Exclude<OrganizationRole, 'owner'>,
  ): Promise<void> {
    const target = await this.requireMember(context.organizationId, membershipId);
    if (!canChangeMemberRole(context.organizationRole, target.role, role)) {
      throw new AppError('ACCESS_DENIED', 'You cannot change this organization role.', 403);
    }
    await this.repository.changeRole(context.organizationId, membershipId, role, context.membershipId);
  }

  async removeMember(context: TenantContext, membershipId: string): Promise<void> {
    const target = await this.requireMember(context.organizationId, membershipId);
    if (!canRemoveMember(context.organizationRole, target.role)) {
      throw new AppError('ACCESS_DENIED', 'You cannot remove this organization member.', 403);
    }
    await this.repository.disableMembership(context.organizationId, membershipId, context.membershipId);
  }

  async transferOwnership(context: TenantContext, targetMembershipId: string): Promise<void> {
    if (context.organizationRole !== 'owner')
      throw new AppError('ACCESS_DENIED', 'Only an owner can transfer ownership.', 403);
    if (context.membershipId === targetMembershipId) {
      throw new AppError('ORGANIZATION_OWNER_UNCHANGED', 'Choose another member for ownership transfer.', 409);
    }
    const target = await this.requireMember(context.organizationId, targetMembershipId);
    if (target.status !== 'active')
      throw new AppError('ORGANIZATION_MEMBER_DISABLED', 'The target member is disabled.', 409);
    await this.repository.transferOwnership(context.organizationId, context.membershipId, targetMembershipId);
  }

  async leave(context: TenantContext): Promise<void> {
    requireAnotherOwner(context.organizationRole, await this.repository.countOwners(context.organizationId));
    await this.repository.leaveOrganization(context.organizationId, context.membershipId);
  }

  private async requireMember(organizationId: string, membershipId: string): Promise<OrganizationMember> {
    const member = await this.repository.findMembership(organizationId, membershipId);
    if (!member) throw new AppError('ORGANIZATION_MEMBER_NOT_FOUND', 'Organization member not found.', 404);
    return member;
  }

  private requireManager(role: OrganizationRole): void {
    if (!canManageOrganization(role))
      throw new AppError('ACCESS_DENIED', 'Organization management access is required.', 403);
  }

  private digestInvitation(token: string): string {
    return createHmac('sha256', this.config.verificationPepper)
      .update(`organization-invitation:${token}`)
      .digest('hex');
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }
}
