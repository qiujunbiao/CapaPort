import { randomUUID } from 'node:crypto';
import type {
  SpaceReviewPolicy,
  SpaceRole,
  SpaceSummary,
  SpaceType,
  UpdateSpaceRequest,
} from '@agentdoor/contracts/spaces';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ne, or } from 'drizzle-orm';
import { users } from '../../db/schema/identity.js';
import { auditLogs, organizationMemberships } from '../../db/schema/organizations.js';
import { spaceMemberships, spaces } from '../../db/schema/spaces.js';
import type { DatabaseService } from '../../platform/database/database.service.js';
import { AppError } from '../../platform/errors/app-error.js';
import type { SpaceAccessRecord, SpaceDataStore, SpaceMember, SpaceRecord } from './space.service.js';

@Injectable()
export class SpaceRepository implements SpaceDataStore {
  constructor(@Inject('DATABASE_SERVICE') private readonly database: DatabaseService) {}

  async createSpace(input: {
    id: string;
    organizationId: string;
    createdByMembershipId: string;
    createdByUserId: string;
    type: 'team' | 'project';
    name: string;
    slug: string;
    reviewPolicy: SpaceReviewPolicy;
  }): Promise<SpaceRecord> {
    await this.database.transaction(async (transaction) => {
      await transaction.insert(spaces).values({
        id: input.id,
        organizationId: input.organizationId,
        type: input.type,
        name: input.name,
        slug: input.slug,
        reviewPolicy: input.reviewPolicy,
        createdByMembershipId: input.createdByMembershipId,
      });
      await transaction.insert(spaceMemberships).values({
        id: randomUUID(),
        organizationId: input.organizationId,
        spaceId: input.id,
        userId: input.createdByUserId,
        role: 'manager',
        addedByMembershipId: input.createdByMembershipId,
      });
      await this.audit(transaction, input.organizationId, input.createdByMembershipId, 'space.created', input.id, {
        type: input.type,
        reviewPolicy: input.reviewPolicy,
      });
    });
    return {
      id: input.id,
      organizationId: input.organizationId,
      type: input.type,
      name: input.name,
      slug: input.slug,
      reviewPolicy: input.reviewPolicy,
      status: 'active',
      role: 'manager',
    };
  }

  async listAccessibleSpaces(
    organizationId: string,
    userId: string,
    includeGoverned: boolean,
  ): Promise<SpaceSummary[]> {
    const conditions = [
      and(eq(spaces.type, 'personal'), eq(spaces.ownerUserId, userId)),
      eq(spaces.type, 'organization'),
      and(eq(spaceMemberships.userId, userId), eq(spaceMemberships.status, 'active')),
    ];
    if (includeGoverned) conditions.push(ne(spaces.type, 'personal'));
    const rows = await this.database.db
      .select({
        id: spaces.id,
        organizationId: spaces.organizationId,
        type: spaces.type,
        name: spaces.name,
        slug: spaces.slug,
        ownerUserId: spaces.ownerUserId,
        reviewPolicy: spaces.reviewPolicy,
        status: spaces.status,
        role: spaceMemberships.role,
        memberStatus: spaceMemberships.status,
      })
      .from(spaces)
      .leftJoin(
        spaceMemberships,
        and(
          eq(spaceMemberships.organizationId, organizationId),
          eq(spaceMemberships.spaceId, spaces.id),
          eq(spaceMemberships.userId, userId),
        ),
      )
      .where(and(eq(spaces.organizationId, organizationId), eq(spaces.status, 'active'), or(...conditions)))
      .orderBy(asc(spaces.type), asc(spaces.name));
    return rows.map((row) => this.summary(row));
  }

  async findSpaceAccess(
    organizationId: string,
    spaceId: string,
    userId: string,
  ): Promise<SpaceAccessRecord | undefined> {
    const [row] = await this.database.db
      .select({
        id: spaces.id,
        organizationId: spaces.organizationId,
        type: spaces.type,
        name: spaces.name,
        slug: spaces.slug,
        ownerUserId: spaces.ownerUserId,
        reviewPolicy: spaces.reviewPolicy,
        status: spaces.status,
        membershipId: spaceMemberships.id,
        role: spaceMemberships.role,
        memberStatus: spaceMemberships.status,
      })
      .from(spaces)
      .leftJoin(
        spaceMemberships,
        and(
          eq(spaceMemberships.organizationId, organizationId),
          eq(spaceMemberships.spaceId, spaces.id),
          eq(spaceMemberships.userId, userId),
        ),
      )
      .where(and(eq(spaces.organizationId, organizationId), eq(spaces.id, spaceId)))
      .limit(1);
    if (!row) return undefined;
    const summary = this.summary(row);
    return {
      space: summary,
      ...(row.membershipId && row.role && row.memberStatus
        ? {
            membership: {
              id: row.membershipId,
              role: row.role as SpaceRole,
              status: row.memberStatus as 'active' | 'disabled',
            },
          }
        : {}),
    };
  }

  async updateSpace(
    organizationId: string,
    spaceId: string,
    actorMembershipId: string,
    input: UpdateSpaceRequest,
  ): Promise<SpaceRecord> {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .update(spaces)
        .set({ name: input.name, updatedAt: new Date() })
        .where(and(eq(spaces.organizationId, organizationId), eq(spaces.id, spaceId)))
        .returning();
      if (!row) this.notFound();
      await this.audit(transaction, organizationId, actorMembershipId, 'space.updated', spaceId, {
        name: input.name,
      });
      return this.record(row);
    });
  }

  async archiveSpace(organizationId: string, spaceId: string, actorMembershipId: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const updated = await transaction
        .update(spaces)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(and(eq(spaces.organizationId, organizationId), eq(spaces.id, spaceId)))
        .returning({ id: spaces.id });
      if (!updated[0]) this.notFound();
      await this.audit(transaction, organizationId, actorMembershipId, 'space.archived', spaceId);
    });
  }

  async updateReviewPolicy(
    organizationId: string,
    spaceId: string,
    actorMembershipId: string,
    reviewPolicy: SpaceReviewPolicy,
  ): Promise<SpaceRecord> {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .update(spaces)
        .set({ reviewPolicy, updatedAt: new Date() })
        .where(and(eq(spaces.organizationId, organizationId), eq(spaces.id, spaceId)))
        .returning();
      if (!row) this.notFound();
      await this.audit(transaction, organizationId, actorMembershipId, 'space.review_policy_changed', spaceId, {
        reviewPolicy,
      });
      return this.record(row);
    });
  }

  async listMembers(organizationId: string, spaceId: string): Promise<SpaceMember[]> {
    const rows = await this.database.db
      .select({
        id: spaceMemberships.id,
        userId: spaceMemberships.userId,
        displayName: users.displayName,
        role: spaceMemberships.role,
        status: spaceMemberships.status,
        createdAt: spaceMemberships.createdAt,
      })
      .from(spaceMemberships)
      .innerJoin(users, eq(users.id, spaceMemberships.userId))
      .where(and(eq(spaceMemberships.organizationId, organizationId), eq(spaceMemberships.spaceId, spaceId)))
      .orderBy(asc(users.displayName));
    return rows.map((row) => ({
      ...row,
      role: row.role as SpaceRole,
      status: row.status as SpaceMember['status'],
    }));
  }

  async upsertMember(input: {
    organizationId: string;
    spaceId: string;
    userId: string;
    role: SpaceRole;
    actorMembershipId: string;
  }): Promise<SpaceMember> {
    const activeOrganizationMember = await this.database.db
      .select({ id: organizationMemberships.id })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, input.organizationId),
          eq(organizationMemberships.userId, input.userId),
          eq(organizationMemberships.status, 'active'),
        ),
      )
      .limit(1);
    if (!activeOrganizationMember[0])
      throw new AppError('SPACE_MEMBER_INVALID', 'User is not an active organization member.', 409);

    const membershipId = randomUUID();
    await this.database.transaction(async (transaction) => {
      await transaction
        .insert(spaceMemberships)
        .values({
          id: membershipId,
          organizationId: input.organizationId,
          spaceId: input.spaceId,
          userId: input.userId,
          role: input.role,
          status: 'active',
          addedByMembershipId: input.actorMembershipId,
        })
        .onConflictDoUpdate({
          target: [spaceMemberships.spaceId, spaceMemberships.userId],
          set: { role: input.role, status: 'active', updatedAt: new Date() },
        });
      await this.audit(
        transaction,
        input.organizationId,
        input.actorMembershipId,
        'space.member_upserted',
        input.spaceId,
        {
          userId: input.userId,
          role: input.role,
        },
      );
    });
    const [member] = (await this.listMembers(input.organizationId, input.spaceId)).filter(
      (candidate) => candidate.userId === input.userId,
    );
    if (!member) this.notFound();
    return member;
  }

  async findMember(
    organizationId: string,
    spaceId: string,
    spaceMembershipId: string,
  ): Promise<SpaceMember | undefined> {
    return (await this.listMembers(organizationId, spaceId)).find((member) => member.id === spaceMembershipId);
  }

  async changeMemberRole(
    organizationId: string,
    spaceId: string,
    spaceMembershipId: string,
    role: SpaceRole,
    actorMembershipId: string,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const updated = await transaction
        .update(spaceMemberships)
        .set({ role, updatedAt: new Date() })
        .where(
          and(
            eq(spaceMemberships.organizationId, organizationId),
            eq(spaceMemberships.spaceId, spaceId),
            eq(spaceMemberships.id, spaceMembershipId),
          ),
        )
        .returning({ userId: spaceMemberships.userId });
      if (!updated[0]) this.notFound();
      await this.audit(transaction, organizationId, actorMembershipId, 'space.member_role_changed', spaceId, {
        userId: updated[0].userId,
        role,
      });
    });
  }

  async disableMember(
    organizationId: string,
    spaceId: string,
    spaceMembershipId: string,
    actorMembershipId: string,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const updated = await transaction
        .update(spaceMemberships)
        .set({ status: 'disabled', updatedAt: new Date() })
        .where(
          and(
            eq(spaceMemberships.organizationId, organizationId),
            eq(spaceMemberships.spaceId, spaceId),
            eq(spaceMemberships.id, spaceMembershipId),
          ),
        )
        .returning({ userId: spaceMemberships.userId });
      if (!updated[0]) this.notFound();
      await this.audit(transaction, organizationId, actorMembershipId, 'space.member_disabled', spaceId, {
        userId: updated[0].userId,
      });
    });
  }

  private summary(row: {
    id: string;
    organizationId: string;
    type: string;
    name: string;
    slug: string;
    ownerUserId: string | null;
    reviewPolicy: string;
    status: string;
    role?: string | null;
    memberStatus?: string | null;
  }): SpaceSummary {
    return {
      id: row.id,
      organizationId: row.organizationId,
      type: row.type as SpaceType,
      name: row.name,
      slug: row.slug,
      reviewPolicy: row.reviewPolicy as SpaceReviewPolicy,
      status: row.status as SpaceSummary['status'],
      ...(row.ownerUserId ? { ownerUserId: row.ownerUserId } : {}),
      ...(row.role && row.memberStatus === 'active' ? { role: row.role as SpaceRole } : {}),
    };
  }

  private record(row: typeof spaces.$inferSelect): SpaceRecord {
    return this.summary(row);
  }

  private async audit(
    transaction: Parameters<Parameters<DatabaseService['transaction']>[0]>[0],
    organizationId: string,
    actorMembershipId: string,
    action: string,
    resourceId: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await transaction.insert(auditLogs).values({
      id: randomUUID(),
      organizationId,
      actorMembershipId,
      action,
      resourceType: 'space',
      resourceId,
      metadata,
    });
  }

  private notFound(): never {
    throw new AppError('ACCESS_DENIED', 'You do not have access to this space action.', 403);
  }
}
