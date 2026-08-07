import { randomUUID } from 'node:crypto';
import type {
  OrganizationRole,
  OrganizationSummary,
  UpdateOrganizationRequest,
} from '@agentdoor/contracts/organizations';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { sessions, userIdentities, users } from '../../db/schema/identity.js';
import {
  auditLogs,
  organizationInvitations,
  organizationMemberships,
  organizations,
} from '../../db/schema/organizations.js';
import type { DatabaseService } from '../../platform/database/database.service.js';
import { OutboxService } from '../../platform/database/outbox.service.js';
import { AppError } from '../../platform/errors/app-error.js';
import type { TenantMembership, TenantStore } from '../../platform/tenancy/tenant-context.service.js';
import type {
  InvitationAcceptance,
  OrganizationDataStore,
  OrganizationInvitation,
  OrganizationMember,
  OrganizationRecord,
} from './organization.service.js';

@Injectable()
export class OrganizationRepository implements OrganizationDataStore, TenantStore {
  constructor(
    @Inject('DATABASE_SERVICE') private readonly database: DatabaseService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  async createOrganization(input: {
    organizationId: string;
    ownerMembershipId: string;
    userId: string;
    name: string;
    slug: string;
  }): Promise<OrganizationRecord> {
    await this.database.transaction(async (transaction) => {
      await transaction.insert(organizations).values({
        id: input.organizationId,
        name: input.name,
        slug: input.slug,
        createdBy: input.userId,
      });
      await transaction.insert(organizationMemberships).values({
        id: input.ownerMembershipId,
        organizationId: input.organizationId,
        userId: input.userId,
        role: 'owner',
      });
      await transaction.insert(auditLogs).values({
        id: randomUUID(),
        organizationId: input.organizationId,
        actorUserId: input.userId,
        actorMembershipId: input.ownerMembershipId,
        action: 'organization.created',
        resourceType: 'organization',
        resourceId: input.organizationId,
        metadata: { name: input.name, slug: input.slug },
      });
      await this.outbox.publishAfterCommit(transaction, {
        type: 'organization.created',
        aggregateType: 'organization',
        aggregateId: input.organizationId,
        organizationId: input.organizationId,
        payload: { ownerUserId: input.userId },
      });
    });
    return { id: input.organizationId, name: input.name, slug: input.slug, status: 'active' };
  }

  async listOrganizations(userId: string): Promise<OrganizationSummary[]> {
    const rows = await this.database.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        status: organizations.status,
        role: organizationMemberships.role,
      })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .where(and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.status, 'active')))
      .orderBy(organizations.name);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status as OrganizationRecord['status'],
      role: row.role as OrganizationRole,
    }));
  }

  async findOrganization(organizationId: string): Promise<OrganizationRecord | undefined> {
    const [row] = await this.database.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        status: organizations.status,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    return row ? { ...row, status: row.status as OrganizationRecord['status'] } : undefined;
  }

  async updateOrganization(
    organizationId: string,
    actorMembershipId: string,
    input: UpdateOrganizationRequest,
  ): Promise<OrganizationRecord> {
    const [updated] = await this.database.transaction(async (transaction) => {
      const rows = await transaction
        .update(organizations)
        .set({ name: input.name.trim(), updatedAt: new Date() })
        .where(eq(organizations.id, organizationId))
        .returning({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          status: organizations.status,
        });
      await this.insertAudit(
        transaction,
        organizationId,
        actorMembershipId,
        'organization.updated',
        'organization',
        organizationId,
        {
          name: input.name.trim(),
        },
      );
      return rows;
    });
    if (!updated) throw new AppError('ORGANIZATION_NOT_FOUND', 'Organization not found.', 404);
    return { ...updated, status: updated.status as OrganizationRecord['status'] };
  }

  async archiveOrganization(organizationId: string, actorMembershipId: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction
        .update(organizations)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(eq(organizations.id, organizationId));
      await this.insertAudit(
        transaction,
        organizationId,
        actorMembershipId,
        'organization.archived',
        'organization',
        organizationId,
      );
    });
  }

  async listMembers(organizationId: string): Promise<OrganizationMember[]> {
    const rows = await this.database.db
      .select({
        id: organizationMemberships.id,
        userId: organizationMemberships.userId,
        displayName: users.displayName,
        role: organizationMemberships.role,
        status: organizationMemberships.status,
        joinedAt: organizationMemberships.joinedAt,
      })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(eq(organizationMemberships.organizationId, organizationId))
      .orderBy(organizationMemberships.joinedAt);
    return rows.map((row) => ({
      ...row,
      role: row.role as OrganizationRole,
      status: row.status as OrganizationMember['status'],
    }));
  }

  async findMembership(organizationId: string, membershipId: string): Promise<OrganizationMember | undefined> {
    const [row] = await this.database.db
      .select({
        id: organizationMemberships.id,
        userId: organizationMemberships.userId,
        displayName: users.displayName,
        role: organizationMemberships.role,
        status: organizationMemberships.status,
        joinedAt: organizationMemberships.joinedAt,
      })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(
        and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.id, membershipId)),
      )
      .limit(1);
    return row
      ? { ...row, role: row.role as OrganizationRole, status: row.status as OrganizationMember['status'] }
      : undefined;
  }

  async countOwners(organizationId: string): Promise<number> {
    const result = await this.database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM organization_memberships
       WHERE organization_id=$1 AND role='owner' AND status='active'`,
      [organizationId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async changeRole(
    organizationId: string,
    membershipId: string,
    role: OrganizationRole,
    actorMembershipId: string,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction
        .update(organizationMemberships)
        .set({ role })
        .where(
          and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.id, membershipId)),
        );
      await this.insertAudit(
        transaction,
        organizationId,
        actorMembershipId,
        'organization.member_role_changed',
        'membership',
        membershipId,
        {
          role,
        },
      );
    });
  }

  async disableMembership(organizationId: string, membershipId: string, actorMembershipId: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction
        .update(organizationMemberships)
        .set({ status: 'disabled', disabledAt: new Date() })
        .where(
          and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.id, membershipId)),
        );
      await this.insertAudit(
        transaction,
        organizationId,
        actorMembershipId,
        'organization.member_disabled',
        'membership',
        membershipId,
      );
    });
  }

  async transferOwnership(organizationId: string, fromMembershipId: string, toMembershipId: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction
        .update(organizationMemberships)
        .set({ role: 'owner' })
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.id, toMembershipId),
          ),
        );
      await transaction
        .update(organizationMemberships)
        .set({ role: 'admin' })
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.id, fromMembershipId),
          ),
        );
      await this.insertAudit(
        transaction,
        organizationId,
        fromMembershipId,
        'organization.ownership_transferred',
        'membership',
        toMembershipId,
        {
          previousOwnerMembershipId: fromMembershipId,
        },
      );
    });
  }

  async leaveOrganization(organizationId: string, membershipId: string): Promise<void> {
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const members = await client.query<{ id: string; role: OrganizationRole; status: string }>(
        `SELECT id,role,status FROM organization_memberships
         WHERE organization_id=$1 AND (id=$2 OR (role='owner' AND status='active')) FOR UPDATE`,
        [organizationId, membershipId],
      );
      const leaving = members.rows.find((member) => member.id === membershipId);
      if (leaving?.status !== 'active') {
        await client.query('ROLLBACK');
        throw new AppError('ORGANIZATION_MEMBER_NOT_FOUND', 'Active organization membership not found.', 404);
      }
      const ownerCount = members.rows.filter((member) => member.role === 'owner' && member.status === 'active').length;
      if (leaving.role === 'owner' && ownerCount <= 1) {
        await client.query('ROLLBACK');
        throw new AppError('ORGANIZATION_LAST_OWNER', 'The last owner must transfer ownership before leaving.', 409);
      }
      const now = new Date();
      await client.query(
        "UPDATE organization_memberships SET status='left', disabled_at=$3 WHERE organization_id=$1 AND id=$2",
        [organizationId, membershipId, now],
      );
      await client.query(
        `INSERT INTO audit_logs (id,organization_id,actor_membership_id,action,resource_type,resource_id,metadata)
         VALUES ($1,$2,$3,'organization.member_left','membership',$3,'{}'::jsonb)`,
        [randomUUID(), organizationId, membershipId],
      );
      await client.query('COMMIT');
    } catch (error) {
      if (!(error instanceof AppError)) await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createInvitation(input: {
    id: string;
    organizationId: string;
    kind: 'email' | 'phone';
    target: string;
    role: Exclude<OrganizationRole, 'owner'>;
    tokenDigest: string;
    invitedByMembershipId: string;
    expiresAt: Date;
  }): Promise<void> {
    const existing = await this.database.db
      .select({ id: organizationMemberships.id })
      .from(organizationMemberships)
      .innerJoin(userIdentities, eq(userIdentities.userId, organizationMemberships.userId))
      .where(
        and(
          eq(organizationMemberships.organizationId, input.organizationId),
          eq(organizationMemberships.status, 'active'),
          eq(userIdentities.kind, input.kind),
          eq(userIdentities.normalizedValue, input.target),
        ),
      )
      .limit(1);
    if (existing[0])
      throw new AppError('ORGANIZATION_ALREADY_MEMBER', 'This account is already an organization member.', 409);

    await this.database.transaction(async (transaction) => {
      await transaction
        .update(organizationInvitations)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(organizationInvitations.organizationId, input.organizationId),
            eq(organizationInvitations.kind, input.kind),
            eq(organizationInvitations.target, input.target),
            isNull(organizationInvitations.acceptedAt),
            isNull(organizationInvitations.revokedAt),
          ),
        );
      await transaction.insert(organizationInvitations).values({
        id: input.id,
        organizationId: input.organizationId,
        kind: input.kind,
        target: input.target,
        role: input.role,
        tokenDigest: input.tokenDigest,
        invitedByMembershipId: input.invitedByMembershipId,
        expiresAt: input.expiresAt,
      });
      await this.insertAudit(
        transaction,
        input.organizationId,
        input.invitedByMembershipId,
        'organization.invitation_created',
        'invitation',
        input.id,
        {
          kind: input.kind,
          role: input.role,
        },
      );
      await this.outbox.publishAfterCommit(transaction, {
        type: 'organization.invitation.created',
        aggregateType: 'organization_invitation',
        aggregateId: input.id,
        organizationId: input.organizationId,
        payload: { kind: input.kind, role: input.role },
      });
    });
  }

  async listInvitations(organizationId: string): Promise<OrganizationInvitation[]> {
    const rows = await this.database.db
      .select({
        id: organizationInvitations.id,
        kind: organizationInvitations.kind,
        target: organizationInvitations.target,
        role: organizationInvitations.role,
        expiresAt: organizationInvitations.expiresAt,
        acceptedAt: organizationInvitations.acceptedAt,
        revokedAt: organizationInvitations.revokedAt,
        createdAt: organizationInvitations.createdAt,
      })
      .from(organizationInvitations)
      .where(eq(organizationInvitations.organizationId, organizationId))
      .orderBy(desc(organizationInvitations.createdAt));
    return rows.map((row) => ({
      ...row,
      kind: row.kind as OrganizationInvitation['kind'],
      role: row.role as OrganizationInvitation['role'],
    }));
  }

  async revokeInvitation(organizationId: string, invitationId: string, actorMembershipId: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const updated = await transaction
        .update(organizationInvitations)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(organizationInvitations.organizationId, organizationId), eq(organizationInvitations.id, invitationId)),
        )
        .returning({ id: organizationInvitations.id });
      if (!updated[0]) throw new AppError('INVITATION_NOT_FOUND', 'Invitation not found.', 404);
      await this.insertAudit(
        transaction,
        organizationId,
        actorMembershipId,
        'organization.invitation_revoked',
        'invitation',
        invitationId,
      );
    });
  }

  async acceptInvitation(tokenDigest: string, userId: string, now: Date): Promise<InvitationAcceptance> {
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{
        id: string;
        organization_id: string;
        kind: 'email' | 'phone';
        target: string;
        role: Exclude<OrganizationRole, 'owner'>;
        expires_at: Date;
        accepted_at: Date | null;
        revoked_at: Date | null;
        organization_status: string;
      }>(
        `SELECT i.*, o.status AS organization_status
           FROM organization_invitations i
           JOIN organizations o ON o.id=i.organization_id
          WHERE i.token_digest=$1
          FOR UPDATE OF i`,
        [tokenDigest],
      );
      const invitation = result.rows[0];
      if (!invitation) return await this.rollbackAcceptance(client, 'not_found');
      if (invitation.accepted_at) return await this.rollbackAcceptance(client, 'already_used');
      if (invitation.revoked_at) return await this.rollbackAcceptance(client, 'revoked');
      if (invitation.expires_at <= now) return await this.rollbackAcceptance(client, 'expired');
      if (invitation.organization_status !== 'active')
        return await this.rollbackAcceptance(client, 'organization_inactive');
      const identity = await client.query(
        `SELECT 1 FROM user_identities
          WHERE user_id=$1 AND kind=$2 AND normalized_value=$3 AND verified_at IS NOT NULL`,
        [userId, invitation.kind, invitation.target],
      );
      if (!identity.rows[0]) return await this.rollbackAcceptance(client, 'identity_mismatch');
      const membershipId = randomUUID();
      const membership = await client.query<{ id: string }>(
        `INSERT INTO organization_memberships (id, organization_id, user_id, role, status, disabled_at)
         VALUES ($1,$2,$3,$4,'active',NULL)
         ON CONFLICT (organization_id,user_id) DO UPDATE
           SET status='active', disabled_at=NULL,
               role=CASE WHEN organization_memberships.role='owner' THEN 'owner' ELSE EXCLUDED.role END
         RETURNING id`,
        [membershipId, invitation.organization_id, userId, invitation.role],
      );
      const acceptedMembershipId = membership.rows[0]?.id ?? membershipId;
      await client.query('UPDATE organization_invitations SET accepted_at=$2, accepted_by_user_id=$3 WHERE id=$1', [
        invitation.id,
        now,
        userId,
      ]);
      await client.query(
        `INSERT INTO audit_logs (id,organization_id,actor_user_id,actor_membership_id,action,resource_type,resource_id,metadata)
         VALUES ($1,$2,$3,$4,'organization.invitation_accepted','invitation',$5,'{}'::jsonb)`,
        [randomUUID(), invitation.organization_id, userId, acceptedMembershipId, invitation.id],
      );
      await client.query(
        `INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,organization_id,payload)
         VALUES ($1,'organization.invitation.accepted','organization_invitation',$2,$3,$4::jsonb)`,
        [
          randomUUID(),
          invitation.id,
          invitation.organization_id,
          JSON.stringify({ userId, membershipId: acceptedMembershipId }),
        ],
      );
      await client.query('COMMIT');
      return { status: 'accepted', organizationId: invitation.organization_id, membershipId: acceptedMembershipId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async currentOrganizationId(sessionId: string, userId: string): Promise<string | undefined> {
    const [row] = await this.database.db
      .select({ organizationId: sessions.currentOrganizationId })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
      .limit(1);
    return row?.organizationId ?? undefined;
  }

  async findActiveMembership(organizationId: string, userId: string): Promise<TenantMembership | undefined> {
    const [row] = await this.database.db
      .select({
        id: organizationMemberships.id,
        organizationId: organizationMemberships.organizationId,
        userId: organizationMemberships.userId,
        role: organizationMemberships.role,
      })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.status, 'active'),
          eq(organizations.status, 'active'),
        ),
      )
      .limit(1);
    return row ? { ...row, role: row.role as OrganizationRole } : undefined;
  }

  async setCurrentOrganization(sessionId: string, userId: string, organizationId: string): Promise<void> {
    await this.database.db
      .update(sessions)
      .set({ currentOrganizationId: organizationId })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
  }

  private async insertAudit(
    transaction: Parameters<Parameters<DatabaseService['transaction']>[0]>[0],
    organizationId: string,
    actorMembershipId: string,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await transaction.insert(auditLogs).values({
      id: randomUUID(),
      organizationId,
      actorMembershipId,
      action,
      resourceType,
      resourceId,
      metadata,
    });
  }

  private async rollbackAcceptance(
    client: { query(query: string): Promise<unknown> },
    status: Exclude<InvitationAcceptance['status'], 'accepted'>,
  ): Promise<InvitationAcceptance> {
    await client.query('ROLLBACK');
    return { status };
  }
}
