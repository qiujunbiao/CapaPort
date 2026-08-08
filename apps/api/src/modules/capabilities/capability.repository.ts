import { randomUUID } from 'node:crypto';
import type { CapabilityManifest } from '@capaport/capability-kit';
import type { AgentId, CapabilitySearchQuery, UpdateCapabilityRequest } from '@capaport/contracts/capabilities';
import type { ScanReport } from '@capaport/security-scan';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { capabilities, capabilityDrafts, capabilityVersions, draftRevisions } from '../../db/schema/capabilities.js';
import { auditLogs } from '../../db/schema/organizations.js';
import type { DatabaseService } from '../../platform/database/database.service.js';
import { AppError } from '../../platform/errors/app-error.js';
import type {
  CapabilityDataStore,
  CapabilityDraftRecord,
  CapabilityRecord,
  CapabilityVersionRecord,
  DraftRevisionRecord,
} from './capability.service.js';

@Injectable()
export class CapabilityRepository implements CapabilityDataStore {
  constructor(@Inject('DATABASE_SERVICE') private readonly database: DatabaseService) {}

  async createCapability(input: {
    id: string;
    draftId: string;
    organizationId: string;
    userId: string;
    spaceId: string;
    slug: string;
    name: string;
    description: string;
    tags: string[];
    compatibility: AgentId[];
    forkedFromVersionId?: string;
  }): Promise<{ capability: CapabilityRecord; draft: CapabilityDraftRecord }> {
    const createdAt = new Date();
    await this.database.transaction(async (transaction) => {
      await transaction.insert(capabilities).values({
        id: input.id,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        slug: input.slug,
        name: input.name,
        description: input.description,
        tags: input.tags,
        compatibility: input.compatibility,
        ownerUserId: input.userId,
        ...(input.forkedFromVersionId ? { forkedFromVersionId: input.forkedFromVersionId } : {}),
        createdAt,
        updatedAt: createdAt,
      });
      await transaction.insert(capabilityDrafts).values({
        id: input.draftId,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        capabilityId: input.id,
        createdByUserId: input.userId,
        createdAt,
        updatedAt: createdAt,
      });
      await transaction.insert(auditLogs).values({
        id: randomUUID(),
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: 'capability.created',
        resourceType: 'capability',
        resourceId: input.id,
        metadata: { spaceId: input.spaceId, slug: input.slug, forked: Boolean(input.forkedFromVersionId) },
      });
    });
    return {
      capability: {
        id: input.id,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        slug: input.slug,
        name: input.name,
        description: input.description,
        tags: input.tags,
        compatibility: input.compatibility,
        ownerUserId: input.userId,
        status: 'active',
        hasPublishedVersion: false,
      },
      draft: {
        id: input.draftId,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        capabilityId: input.id,
        createdByUserId: input.userId,
        status: 'draft',
        createdAt,
        updatedAt: createdAt,
      },
    };
  }

  async updateCapability(
    organizationId: string,
    capabilityId: string,
    actorUserId: string,
    input: UpdateCapabilityRequest,
  ): Promise<CapabilityRecord> {
    const set: Partial<typeof capabilities.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) set.name = input.name;
    if (input.description !== undefined) set.description = input.description;
    if (input.tags !== undefined) set.tags = [...new Set(input.tags)];
    if (input.compatibility !== undefined) set.compatibility = [...new Set(input.compatibility)];
    await this.database.transaction(async (transaction) => {
      const updated = await transaction
        .update(capabilities)
        .set(set)
        .where(and(eq(capabilities.organizationId, organizationId), eq(capabilities.id, capabilityId)))
        .returning({ id: capabilities.id });
      if (!updated[0]) this.denied();
      await transaction.insert(auditLogs).values({
        id: randomUUID(),
        organizationId,
        actorUserId,
        action: 'capability.metadata_updated',
        resourceType: 'capability',
        resourceId: capabilityId,
        metadata: { fields: Object.keys(input).sort() },
      });
    });
    const capability = await this.findCapability(organizationId, capabilityId);
    if (!capability) this.denied();
    return capability;
  }

  async findCapability(organizationId: string, capabilityId: string): Promise<CapabilityRecord | undefined> {
    const rows = await this.selectCapabilities(
      and(eq(capabilities.organizationId, organizationId), eq(capabilities.id, capabilityId)),
      1,
    );
    return rows[0];
  }

  async createDraft(input: {
    id: string;
    organizationId: string;
    spaceId: string;
    capabilityId: string;
    userId: string;
  }): Promise<CapabilityDraftRecord> {
    const createdAt = new Date();
    await this.database.transaction(async (transaction) => {
      await transaction.insert(capabilityDrafts).values({
        id: input.id,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        capabilityId: input.capabilityId,
        createdByUserId: input.userId,
        createdAt,
        updatedAt: createdAt,
      });
      await transaction.insert(auditLogs).values({
        id: randomUUID(),
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: 'capability.draft_created',
        resourceType: 'capability_draft',
        resourceId: input.id,
        metadata: { capabilityId: input.capabilityId, spaceId: input.spaceId },
      });
    });
    return {
      id: input.id,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      capabilityId: input.capabilityId,
      createdByUserId: input.userId,
      status: 'draft',
      createdAt,
      updatedAt: createdAt,
    };
  }

  async searchCapabilities(
    organizationId: string,
    accessibleSpaceIds: string[],
    query: CapabilitySearchQuery,
  ): Promise<CapabilityRecord[]> {
    if (accessibleSpaceIds.length === 0) return [];
    const filters = [eq(capabilities.organizationId, organizationId), eq(capabilities.status, 'active')];
    const visibleFilter = or(
      inArray(capabilities.spaceId, accessibleSpaceIds),
      sql`EXISTS (
        SELECT 1 FROM capability_versions visible_version
         WHERE visible_version.capability_id=${capabilities.id}
           AND visible_version.organization_id=${organizationId}
           AND visible_version.space_id IN (${sql.join(
             accessibleSpaceIds.map((id) => sql`${id}`),
             sql`, `,
           )})
           AND visible_version.status IN ('published','deprecated')
      )`,
    );
    if (visibleFilter) filters.push(visibleFilter);
    if (query.query) {
      const escapedQuery = query.query
        .replaceAll('\\', String.raw`\\`)
        .replaceAll('%', String.raw`\%`)
        .replaceAll('_', String.raw`\_`);
      const pattern = `%${escapedQuery}%`;
      const nameFilter = or(
        ilike(capabilities.name, pattern),
        ilike(capabilities.slug, pattern),
        ilike(capabilities.description, pattern),
      );
      if (nameFilter) filters.push(nameFilter);
    }
    if (query.tag) filters.push(sql`${capabilities.tags} ? ${query.tag}`);
    if (query.agent) filters.push(sql`${capabilities.compatibility} ? ${query.agent}`);
    return this.selectCapabilities(and(...filters), query.limit);
  }

  async findDraft(
    organizationId: string,
    capabilityId: string,
    draftId: string,
  ): Promise<CapabilityDraftRecord | undefined> {
    const [row] = await this.database.db
      .select()
      .from(capabilityDrafts)
      .where(
        and(
          eq(capabilityDrafts.organizationId, organizationId),
          eq(capabilityDrafts.capabilityId, capabilityId),
          eq(capabilityDrafts.id, draftId),
        ),
      )
      .limit(1);
    return row ? this.draft(row) : undefined;
  }

  async createRevision(input: {
    id: string;
    organizationId: string;
    spaceId: string;
    capabilityId: string;
    draftId: string;
    artifactId: string;
    contentDigest: string;
    manifest: CapabilityManifest;
    scanStatus: 'passed' | 'blocked';
    scanReport: ScanReport;
    draftStatus: 'ready' | 'blocked';
    userId: string;
  }): Promise<DraftRevisionRecord> {
    const client = await this.database.pool.connect();
    const createdAt = new Date();
    try {
      await client.query('BEGIN');
      const draftResult = await client.query<{ status: string }>(
        `SELECT status FROM capability_drafts
          WHERE id=$1 AND capability_id=$2 AND organization_id=$3 AND space_id=$4 FOR UPDATE`,
        [input.draftId, input.capabilityId, input.organizationId, input.spaceId],
      );
      const draft = draftResult.rows[0];
      if (!draft) this.denied();
      if (draft.status === 'submitted')
        throw new AppError('CAPABILITY_DRAFT_FROZEN', 'Submitted drafts cannot be edited.', 409);
      const sequenceResult = await client.query<{ sequence: number }>(
        'SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM draft_revisions WHERE draft_id=$1',
        [input.draftId],
      );
      const sequence = Number(sequenceResult.rows[0]?.sequence ?? 1);
      await client.query(
        `INSERT INTO draft_revisions
           (id,organization_id,space_id,draft_id,sequence,artifact_id,content_digest,manifest,scan_status,scan_report,created_by_user_id,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12)`,
        [
          input.id,
          input.organizationId,
          input.spaceId,
          input.draftId,
          sequence,
          input.artifactId,
          input.contentDigest,
          JSON.stringify(input.manifest),
          input.scanStatus,
          JSON.stringify(input.scanReport),
          input.userId,
          createdAt,
        ],
      );
      await client.query('UPDATE capability_drafts SET status=$2,current_revision_id=$3,updated_at=$4 WHERE id=$1', [
        input.draftId,
        input.draftStatus,
        input.id,
        createdAt,
      ]);
      await client.query(
        `INSERT INTO audit_logs
           (id,organization_id,actor_user_id,action,resource_type,resource_id,metadata)
         VALUES ($1,$2,$3,'capability.draft_revision_created','draft_revision',$4,$5::jsonb)`,
        [
          randomUUID(),
          input.organizationId,
          input.userId,
          input.id,
          JSON.stringify({
            capabilityId: input.capabilityId,
            draftId: input.draftId,
            sequence,
            scanStatus: input.scanStatus,
            contentDigest: input.contentDigest,
          }),
        ],
      );
      await client.query(
        `INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,organization_id,payload)
         VALUES ($1,$2,'capability_draft',$3,$4,$5::jsonb)`,
        [
          randomUUID(),
          input.scanStatus === 'blocked' ? 'capability.scan.blocked' : 'capability.draft.ready',
          input.draftId,
          input.organizationId,
          JSON.stringify({ capabilityId: input.capabilityId, revisionId: input.id, sequence }),
        ],
      );
      await client.query('COMMIT');
      return {
        id: input.id,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        draftId: input.draftId,
        sequence,
        artifactId: input.artifactId,
        contentDigest: input.contentDigest,
        manifest: input.manifest,
        scanStatus: input.scanStatus,
        scanReport: input.scanReport,
        createdByUserId: input.userId,
        createdAt,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listDrafts(organizationId: string, capabilityId: string): Promise<CapabilityDraftRecord[]> {
    const rows = await this.database.db
      .select()
      .from(capabilityDrafts)
      .where(and(eq(capabilityDrafts.organizationId, organizationId), eq(capabilityDrafts.capabilityId, capabilityId)))
      .orderBy(desc(capabilityDrafts.updatedAt));
    return rows.map((row) => this.draft(row));
  }

  async listRevisions(organizationId: string, capabilityId: string, draftId: string): Promise<DraftRevisionRecord[]> {
    const rows = await this.database.db
      .select({ revision: draftRevisions })
      .from(draftRevisions)
      .innerJoin(capabilityDrafts, eq(capabilityDrafts.id, draftRevisions.draftId))
      .where(
        and(
          eq(draftRevisions.organizationId, organizationId),
          eq(draftRevisions.draftId, draftId),
          eq(capabilityDrafts.capabilityId, capabilityId),
        ),
      )
      .orderBy(desc(draftRevisions.sequence));
    return rows.map(({ revision }) => this.revision(revision));
  }

  async findRevision(
    organizationId: string,
    capabilityId: string,
    draftId: string,
    revisionId: string,
  ): Promise<DraftRevisionRecord | undefined> {
    const [row] = await this.database.db
      .select({ revision: draftRevisions })
      .from(draftRevisions)
      .innerJoin(capabilityDrafts, eq(capabilityDrafts.id, draftRevisions.draftId))
      .where(
        and(
          eq(draftRevisions.organizationId, organizationId),
          eq(draftRevisions.id, revisionId),
          eq(draftRevisions.draftId, draftId),
          eq(capabilityDrafts.capabilityId, capabilityId),
        ),
      )
      .limit(1);
    return row ? this.revision(row.revision) : undefined;
  }

  async findVersion(organizationId: string, versionId: string): Promise<CapabilityVersionRecord | undefined> {
    const [row] = await this.database.db
      .select({
        id: capabilityVersions.id,
        organizationId: capabilityVersions.organizationId,
        spaceId: capabilityVersions.spaceId,
        capabilityId: capabilityVersions.capabilityId,
        status: capabilityVersions.status,
      })
      .from(capabilityVersions)
      .where(and(eq(capabilityVersions.organizationId, organizationId), eq(capabilityVersions.id, versionId)))
      .limit(1);
    return row ? { ...row, status: row.status as CapabilityVersionRecord['status'] } : undefined;
  }

  private async selectCapabilities(condition: ReturnType<typeof and>, limit: number): Promise<CapabilityRecord[]> {
    const rows = await this.database.db
      .select({
        id: capabilities.id,
        organizationId: capabilities.organizationId,
        spaceId: capabilities.spaceId,
        slug: capabilities.slug,
        name: capabilities.name,
        description: capabilities.description,
        tags: capabilities.tags,
        compatibility: capabilities.compatibility,
        ownerUserId: capabilities.ownerUserId,
        status: capabilities.status,
        publishedSpaceIds: sql<string[]>`ARRAY(
          SELECT DISTINCT v.space_id::text FROM capability_versions v
           WHERE v.capability_id=${sql.raw('"capabilities"."id"')}
             AND v.organization_id=${sql.raw('"capabilities"."organization_id"')}
             AND v.status IN ('published','deprecated')
          ORDER BY v.space_id::text
        )`,
      })
      .from(capabilities)
      .where(condition)
      .orderBy(desc(capabilities.updatedAt), capabilities.name)
      .limit(limit);
    return rows.map((row) => ({
      ...row,
      hasPublishedVersion: row.publishedSpaceIds.length > 0,
      compatibility: row.compatibility as AgentId[],
      status: row.status as CapabilityRecord['status'],
    }));
  }

  private draft(row: typeof capabilityDrafts.$inferSelect): CapabilityDraftRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      spaceId: row.spaceId,
      capabilityId: row.capabilityId,
      createdByUserId: row.createdByUserId,
      status: row.status as CapabilityDraftRecord['status'],
      ...(row.currentRevisionId ? { currentRevisionId: row.currentRevisionId } : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private revision(row: typeof draftRevisions.$inferSelect): DraftRevisionRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      spaceId: row.spaceId,
      draftId: row.draftId,
      sequence: row.sequence,
      artifactId: row.artifactId,
      contentDigest: row.contentDigest,
      manifest: row.manifest as CapabilityManifest,
      scanStatus: row.scanStatus as DraftRevisionRecord['scanStatus'],
      scanReport: row.scanReport as ScanReport,
      createdByUserId: row.createdByUserId,
      createdAt: row.createdAt,
    };
  }

  private denied(): never {
    throw new AppError('ACCESS_DENIED', 'You do not have access to this capability.', 403);
  }
}
