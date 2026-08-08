import { randomUUID } from 'node:crypto';
import type { OrganizationRole, TenantContext } from '@capaport/contracts/organizations';
import type {
  CreateSpaceRequest,
  SpaceReviewPolicy,
  SpaceRole,
  SpaceSummary,
  UpdateSpaceRequest,
} from '@capaport/contracts/spaces';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../platform/errors/app-error.js';
import { type AuthorizationAction, type AuthorizationSubject, authorize } from './authorization.js';

export type SpaceRecord = SpaceSummary;
export type SpaceAccessRecord = {
  space: SpaceRecord;
  membership?: { id: string; role: SpaceRole; status: 'active' | 'disabled' };
};
export type SpaceMember = {
  id: string;
  userId: string;
  displayName: string;
  role: SpaceRole;
  status: 'active' | 'disabled';
  createdAt: Date;
};

export interface SpaceDataStore {
  createSpace(input: {
    id: string;
    organizationId: string;
    createdByMembershipId: string;
    createdByUserId: string;
    type: 'team' | 'project';
    name: string;
    slug: string;
    reviewPolicy: SpaceReviewPolicy;
  }): Promise<SpaceRecord>;
  listAccessibleSpaces(organizationId: string, userId: string, includeGoverned: boolean): Promise<SpaceSummary[]>;
  findSpaceAccess(organizationId: string, spaceId: string, userId: string): Promise<SpaceAccessRecord | undefined>;
  updateSpace(
    organizationId: string,
    spaceId: string,
    actorMembershipId: string,
    input: UpdateSpaceRequest,
  ): Promise<SpaceRecord>;
  archiveSpace(organizationId: string, spaceId: string, actorMembershipId: string): Promise<void>;
  updateReviewPolicy(
    organizationId: string,
    spaceId: string,
    actorMembershipId: string,
    reviewPolicy: SpaceReviewPolicy,
  ): Promise<SpaceRecord>;
  listMembers(organizationId: string, spaceId: string): Promise<SpaceMember[]>;
  upsertMember(input: {
    organizationId: string;
    spaceId: string;
    userId: string;
    role: SpaceRole;
    actorMembershipId: string;
  }): Promise<SpaceMember>;
  findMember(organizationId: string, spaceId: string, spaceMembershipId: string): Promise<SpaceMember | undefined>;
  changeMemberRole(
    organizationId: string,
    spaceId: string,
    spaceMembershipId: string,
    role: SpaceRole,
    actorMembershipId: string,
  ): Promise<void>;
  disableMember(
    organizationId: string,
    spaceId: string,
    spaceMembershipId: string,
    actorMembershipId: string,
  ): Promise<void>;
}

export type AuthorizedSpaceContext = SpaceAccessRecord & {
  tenant: TenantContext;
  userId: string;
};

@Injectable()
export class SpaceService {
  constructor(@Inject('SPACE_DATA_STORE') private readonly repository: SpaceDataStore) {}

  async create(tenant: TenantContext, userId: string, input: CreateSpaceRequest): Promise<SpaceRecord> {
    if (tenant.organizationRole !== 'owner' && tenant.organizationRole !== 'admin') this.denied();
    try {
      return await this.repository.createSpace({
        id: randomUUID(),
        organizationId: tenant.organizationId,
        createdByMembershipId: tenant.membershipId,
        createdByUserId: userId,
        type: input.type,
        name: input.name,
        slug: input.slug,
        reviewPolicy: input.reviewPolicy,
      });
    } catch (error) {
      if (this.isUniqueViolation(error))
        throw new AppError('SPACE_SLUG_EXISTS', 'This space URL is already in use.', 409);
      throw error;
    }
  }

  list(tenant: TenantContext, userId: string): Promise<SpaceSummary[]> {
    const includeGoverned = tenant.organizationRole === 'owner' || tenant.organizationRole === 'admin';
    return this.repository.listAccessibleSpaces(tenant.organizationId, userId, includeGoverned);
  }

  async authorize(
    tenant: TenantContext,
    userId: string,
    spaceId: string,
    action: AuthorizationAction,
  ): Promise<AuthorizedSpaceContext> {
    const access = await this.repository.findSpaceAccess(tenant.organizationId, spaceId, userId);
    if (!access) this.denied();
    const subject: AuthorizationSubject = {
      userId,
      organizationId: tenant.organizationId,
      organizationRole: tenant.organizationRole,
      organizationMembershipStatus: 'active',
      ...(access.membership
        ? { spaceMembershipRole: access.membership.role, spaceMembershipStatus: access.membership.status }
        : {}),
    };
    const decision = authorize(subject, action, access.space);
    if (!decision.allowed) this.denied();
    return { ...access, tenant, userId };
  }

  update(context: AuthorizedSpaceContext, input: UpdateSpaceRequest): Promise<SpaceRecord> {
    return this.repository.updateSpace(
      context.tenant.organizationId,
      context.space.id,
      context.tenant.membershipId,
      input,
    );
  }

  async archive(context: AuthorizedSpaceContext): Promise<void> {
    if (context.space.type !== 'team' && context.space.type !== 'project') {
      throw new AppError('SPACE_SYSTEM_IMMUTABLE', 'Personal and organization spaces cannot be archived.', 409);
    }
    await this.repository.archiveSpace(context.tenant.organizationId, context.space.id, context.tenant.membershipId);
  }

  updateReviewPolicy(context: AuthorizedSpaceContext, reviewPolicy: SpaceReviewPolicy): Promise<SpaceRecord> {
    if (context.space.type !== 'team' && context.space.type !== 'project') {
      throw new AppError('SPACE_POLICY_IMMUTABLE', 'This space has a fixed review policy.', 409);
    }
    return this.repository.updateReviewPolicy(
      context.tenant.organizationId,
      context.space.id,
      context.tenant.membershipId,
      reviewPolicy,
    );
  }

  members(context: AuthorizedSpaceContext): Promise<SpaceMember[]> {
    return this.repository.listMembers(context.tenant.organizationId, context.space.id);
  }

  addMember(context: AuthorizedSpaceContext, userId: string, role: SpaceRole): Promise<SpaceMember> {
    if (context.space.type === 'personal') this.denied();
    return this.repository.upsertMember({
      organizationId: context.tenant.organizationId,
      spaceId: context.space.id,
      userId,
      role,
      actorMembershipId: context.tenant.membershipId,
    });
  }

  async changeMemberRole(context: AuthorizedSpaceContext, spaceMembershipId: string, role: SpaceRole): Promise<void> {
    if (context.space.type === 'personal') this.denied();
    if (!(await this.repository.findMember(context.tenant.organizationId, context.space.id, spaceMembershipId))) {
      this.denied();
    }
    await this.repository.changeMemberRole(
      context.tenant.organizationId,
      context.space.id,
      spaceMembershipId,
      role,
      context.tenant.membershipId,
    );
  }

  async removeMember(context: AuthorizedSpaceContext, spaceMembershipId: string): Promise<void> {
    if (context.space.type === 'personal') this.denied();
    if (!(await this.repository.findMember(context.tenant.organizationId, context.space.id, spaceMembershipId))) {
      this.denied();
    }
    await this.repository.disableMember(
      context.tenant.organizationId,
      context.space.id,
      spaceMembershipId,
      context.tenant.membershipId,
    );
  }

  private denied(): never {
    throw new AppError('ACCESS_DENIED', 'You do not have access to this space action.', 403);
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }
}

export function organizationCanCreateSpaces(role: OrganizationRole): boolean {
  return role === 'owner' || role === 'admin';
}
