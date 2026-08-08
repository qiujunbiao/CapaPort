import { randomUUID } from 'node:crypto';
import type { PublicationListQuery, PublicationStatus, VersionStatus } from '@agentdoor/contracts/publications';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { DatabaseService } from '../../platform/database/database.service.js';
import { AppError } from '../../platform/errors/app-error.js';
import { sourceDraftStatusAfterReview, transitionPublication } from './publication.state.js';
import type {
  FrozenPublicationCandidate,
  PublicationDataStore,
  PublicationRecord,
  PublishedVersionRecord,
} from './publishing.service.js';

type PublicationRow = {
  id: string;
  organization_id: string;
  capability_id: string;
  source_space_id: string;
  target_space_id: string;
  source_revision_id: string | null;
  source_version_id: string | null;
  candidate_artifact_id: string;
  candidate_digest: string;
  candidate_manifest: unknown;
  candidate_scan_report: unknown;
  risk_acceptance: unknown | null;
  version: string;
  review_required: boolean;
  status: string;
  submitted_by_user_id: string;
  idempotency_key: string;
  published_version_id: string | null;
  created_at: Date;
  resolved_at: Date | null;
};

type VersionRow = {
  id: string;
  organization_id: string;
  capability_id: string;
  space_id: string;
  version: string;
  artifact_id: string;
  content_digest: string;
  manifest: unknown;
  status: string;
  published_at: Date;
};

@Injectable()
export class PublishingRepository implements PublicationDataStore {
  constructor(@Inject('DATABASE_SERVICE') private readonly database: DatabaseService) {}

  async findDraftCandidate(
    organizationId: string,
    capabilityId: string,
    draftId: string,
  ): Promise<FrozenPublicationCandidate | undefined> {
    const result = await this.database.pool.query<{
      capability_id: string;
      space_id: string;
      revision_id: string;
      artifact_id: string;
      content_digest: string;
      manifest: FrozenPublicationCandidate['manifest'];
      scan_report: FrozenPublicationCandidate['scanReport'];
      status: string;
      scan_status: string;
    }>(
      `SELECT d.capability_id,d.space_id,r.id AS revision_id,r.artifact_id,r.content_digest,
              r.manifest,r.scan_report,d.status,r.scan_status
         FROM capability_drafts d
         JOIN draft_revisions r ON r.id=d.current_revision_id
        WHERE d.organization_id=$1 AND d.capability_id=$2 AND d.id=$3`,
      [organizationId, capabilityId, draftId],
    );
    const row = result.rows[0];
    if (row?.status !== 'ready' || row.scan_status !== 'passed') return undefined;
    return {
      capabilityId: row.capability_id,
      sourceSpaceId: row.space_id,
      sourceRevisionId: row.revision_id,
      artifactId: row.artifact_id,
      contentDigest: row.content_digest,
      manifest: row.manifest,
      scanReport: row.scan_report,
    };
  }

  async findByIdempotency(
    organizationId: string,
    userId: string,
    idempotencyKey: string,
  ): Promise<PublicationRecord | undefined> {
    const result = await this.database.pool.query<PublicationRow>(
      `SELECT * FROM publications
        WHERE organization_id=$1 AND submitted_by_user_id=$2 AND idempotency_key=$3`,
      [organizationId, userId, idempotencyKey],
    );
    return result.rows[0] ? this.publication(result.rows[0]) : undefined;
  }

  async findVersionCandidate(
    organizationId: string,
    versionId: string,
  ): Promise<FrozenPublicationCandidate | undefined> {
    const result = await this.database.pool.query<{
      capability_id: string;
      space_id: string;
      artifact_id: string;
      content_digest: string;
      manifest: FrozenPublicationCandidate['manifest'];
      status: string;
      scan_report: FrozenPublicationCandidate['scanReport'] | null;
    }>(
      `SELECT v.capability_id,v.space_id,v.artifact_id,v.content_digest,v.manifest,v.status,
              p.candidate_scan_report AS scan_report
         FROM capability_versions v
         LEFT JOIN LATERAL (
           SELECT candidate_scan_report FROM publications
            WHERE published_version_id=v.id ORDER BY resolved_at DESC NULLS LAST LIMIT 1
         ) p ON true
        WHERE v.organization_id=$1 AND v.id=$2`,
      [organizationId, versionId],
    );
    const row = result.rows[0];
    if (!row || !['published', 'deprecated'].includes(row.status) || !row.scan_report) return undefined;
    return {
      capabilityId: row.capability_id,
      sourceSpaceId: row.space_id,
      sourceVersionId: versionId,
      artifactId: row.artifact_id,
      contentDigest: row.content_digest,
      manifest: row.manifest,
      scanReport: row.scan_report,
    };
  }

  async submit(input: Parameters<PublicationDataStore['submit']>[0]): Promise<PublicationRecord> {
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const replay = await this.findByIdempotencyLocked(
        client,
        input.organizationId,
        input.userId,
        input.idempotencyKey,
      );
      if (replay) {
        await client.query('COMMIT');
        return this.publication(replay);
      }
      await this.lockAndValidateCandidate(client, input);
      const createdAt = new Date();
      await client.query(
        `INSERT INTO publications
          (id,organization_id,capability_id,source_space_id,target_space_id,source_revision_id,source_version_id,
           candidate_artifact_id,candidate_digest,candidate_manifest,candidate_scan_report,risk_acceptance,version,review_required,status,
           submitted_by_user_id,idempotency_key,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18)`,
        [
          input.publicationId,
          input.organizationId,
          input.candidate.capabilityId,
          input.candidate.sourceSpaceId,
          input.targetSpaceId,
          input.candidate.sourceRevisionId ?? null,
          input.candidate.sourceVersionId ?? null,
          input.candidate.artifactId,
          input.candidate.contentDigest,
          JSON.stringify(input.candidate.manifest),
          JSON.stringify(input.candidate.scanReport),
          input.riskAcceptance ? JSON.stringify(input.riskAcceptance) : null,
          input.version,
          input.reviewRequired,
          input.reviewRequired ? 'in_review' : 'published',
          input.userId,
          input.idempotencyKey,
          createdAt,
        ],
      );
      let publishedVersionId: string | undefined;
      if (!input.reviewRequired) {
        await this.insertVersion(client, {
          versionId: input.versionId,
          organizationId: input.organizationId,
          targetSpaceId: input.targetSpaceId,
          capabilityId: input.candidate.capabilityId,
          version: input.version,
          artifactId: input.candidate.artifactId,
          digest: input.candidate.contentDigest,
          manifest: input.candidate.manifest,
          publishedAt: createdAt,
        });
        publishedVersionId = input.versionId;
        await client.query('UPDATE publications SET published_version_id=$2,resolved_at=$3 WHERE id=$1', [
          input.publicationId,
          input.versionId,
          createdAt,
        ]);
      }
      if (input.candidate.sourceRevisionId) {
        await client.query(
          `UPDATE capability_drafts SET status='submitted',updated_at=$2 WHERE current_revision_id=$1`,
          [input.candidate.sourceRevisionId, createdAt],
        );
      }
      await this.recordEvents(client, {
        organizationId: input.organizationId,
        actorUserId: input.userId,
        publicationId: input.publicationId,
        action: input.reviewRequired ? 'publication.submitted' : 'publication.direct_published',
        eventType: input.reviewRequired ? 'publication.submitted' : 'capability.version.published',
        metadata: {
          capabilityId: input.candidate.capabilityId,
          sourceSpaceId: input.candidate.sourceSpaceId,
          targetSpaceId: input.targetSpaceId,
          candidateDigest: input.candidate.contentDigest,
          version: input.version,
          reviewRequired: input.reviewRequired,
          riskAcceptance: input.riskAcceptance,
          publishedVersionId,
        },
      });
      const result = await client.query<PublicationRow>('SELECT * FROM publications WHERE id=$1', [
        input.publicationId,
      ]);
      await client.query('COMMIT');
      return this.publication(this.requirePublicationRow(result.rows[0]));
    } catch (error) {
      await client.query('ROLLBACK');
      if (this.constraint(error) === 'publications_submitter_idempotency_uidx') {
        const replay = await this.database.pool.query<PublicationRow>(
          `SELECT * FROM publications WHERE organization_id=$1 AND submitted_by_user_id=$2 AND idempotency_key=$3`,
          [input.organizationId, input.userId, input.idempotencyKey],
        );
        if (replay.rows[0]) return this.publication(replay.rows[0]);
      }
      this.mapWriteError(error);
    } finally {
      client.release();
    }
  }

  async findPublication(organizationId: string, publicationId: string): Promise<PublicationRecord | undefined> {
    const result = await this.database.pool.query<PublicationRow>(
      'SELECT * FROM publications WHERE organization_id=$1 AND id=$2',
      [organizationId, publicationId],
    );
    return result.rows[0] ? this.publication(result.rows[0]) : undefined;
  }

  async listPublications(organizationId: string, query: PublicationListQuery): Promise<PublicationRecord[]> {
    const values: unknown[] = [organizationId];
    const clauses = ['organization_id=$1'];
    if (query.status) {
      values.push(query.status);
      clauses.push(`status=$${values.length}`);
    }
    if (query.targetSpaceId) {
      values.push(query.targetSpaceId);
      clauses.push(`target_space_id=$${values.length}`);
    }
    values.push(query.limit);
    const result = await this.database.pool.query<PublicationRow>(
      `SELECT * FROM publications WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT $${values.length}`,
      values,
    );
    return result.rows.map((row) => this.publication(row));
  }

  async review(input: Parameters<PublicationDataStore['review']>[0]): Promise<PublicationRecord> {
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<PublicationRow>(
        'SELECT * FROM publications WHERE organization_id=$1 AND id=$2 FOR UPDATE',
        [input.organizationId, input.publicationId],
      );
      const row = result.rows[0];
      if (!row) this.denied();
      if (row.status === 'published' && input.decision === 'approve') {
        await client.query('COMMIT');
        return this.publication(row);
      }
      if (row.status !== 'in_review') {
        throw new AppError('PUBLICATION_TRANSITION_INVALID', 'Publication is no longer awaiting review.', 409);
      }
      if (row.submitted_by_user_id === input.reviewerUserId) {
        throw new AppError('PUBLICATION_SELF_REVIEW', 'Submitters cannot review their own publication.', 403);
      }
      if (row.candidate_digest !== input.expectedDigest) {
        throw new AppError('PUBLICATION_CANDIDATE_CHANGED', 'The frozen publication candidate changed.', 409);
      }
      const next = transitionPublication(row.status as PublicationStatus, input.decision);
      const resolvedAt = new Date();
      await client.query(
        `INSERT INTO publication_reviews
          (id,organization_id,publication_id,reviewer_user_id,decision,reason,candidate_digest,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          input.reviewId,
          input.organizationId,
          input.publicationId,
          input.reviewerUserId,
          input.decision,
          input.reason,
          row.candidate_digest,
          resolvedAt,
        ],
      );
      let publishedVersionId: string | undefined;
      if (input.decision === 'approve') {
        await this.insertVersion(client, {
          versionId: input.versionId,
          organizationId: row.organization_id,
          targetSpaceId: row.target_space_id,
          capabilityId: row.capability_id,
          version: row.version,
          artifactId: row.candidate_artifact_id,
          digest: row.candidate_digest,
          manifest: row.candidate_manifest,
          publishedAt: resolvedAt,
        });
        publishedVersionId = input.versionId;
      }
      await client.query(`UPDATE publications SET status=$2,resolved_at=$3,published_version_id=$4 WHERE id=$1`, [
        input.publicationId,
        next,
        resolvedAt,
        publishedVersionId ?? null,
      ]);
      const sourceDraftStatus = sourceDraftStatusAfterReview(input.decision);
      if (sourceDraftStatus && row.source_revision_id) {
        await client.query(
          `UPDATE capability_drafts
              SET status=$2,updated_at=$3
            WHERE organization_id=$1 AND current_revision_id=$4 AND status='submitted'`,
          [input.organizationId, sourceDraftStatus, resolvedAt, row.source_revision_id],
        );
      }
      await this.recordEvents(client, {
        organizationId: input.organizationId,
        actorUserId: input.reviewerUserId,
        publicationId: input.publicationId,
        action: `publication.${input.decision}`,
        eventType: input.decision === 'approve' ? 'capability.version.published' : `publication.${next}`,
        metadata: {
          capabilityId: row.capability_id,
          candidateDigest: row.candidate_digest,
          decision: input.decision,
          reason: input.reason,
          publishedVersionId,
        },
      });
      const updated = await client.query<PublicationRow>('SELECT * FROM publications WHERE id=$1', [
        input.publicationId,
      ]);
      await client.query('COMMIT');
      return this.publication(this.requirePublicationRow(updated.rows[0]));
    } catch (error) {
      await client.query('ROLLBACK');
      this.mapWriteError(error);
    } finally {
      client.release();
    }
  }

  async withdraw(input: Parameters<PublicationDataStore['withdraw']>[0]): Promise<PublicationRecord> {
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<PublicationRow>(
        'SELECT * FROM publications WHERE organization_id=$1 AND id=$2 FOR UPDATE',
        [input.organizationId, input.publicationId],
      );
      const row = result.rows[0];
      if (!row) this.denied();
      const next = transitionPublication(row.status as PublicationStatus, 'withdraw');
      const resolvedAt = new Date();
      await client.query('UPDATE publications SET status=$2,resolved_at=$3 WHERE id=$1', [row.id, next, resolvedAt]);
      if (row.published_version_id) {
        await client.query(
          `UPDATE capability_versions SET status='withdrawn'
            WHERE id=$1 AND organization_id=$2 AND status IN ('published','deprecated')`,
          [row.published_version_id, input.organizationId],
        );
      }
      await this.recordEvents(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        publicationId: row.id,
        action: 'publication.withdrawn',
        eventType: 'publication.withdrawn',
        metadata: { capabilityId: row.capability_id, publishedVersionId: row.published_version_id },
      });
      const updated = await client.query<PublicationRow>('SELECT * FROM publications WHERE id=$1', [row.id]);
      await client.query('COMMIT');
      return this.publication(this.requirePublicationRow(updated.rows[0]));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listVersions(organizationId: string, capabilityId: string): Promise<PublishedVersionRecord[]> {
    const result = await this.database.pool.query<VersionRow>(
      `SELECT * FROM capability_versions WHERE organization_id=$1 AND capability_id=$2
        ORDER BY published_at DESC`,
      [organizationId, capabilityId],
    );
    return result.rows.map((row) => this.version(row));
  }

  async findVersion(organizationId: string, versionId: string): Promise<PublishedVersionRecord | undefined> {
    const result = await this.database.pool.query<VersionRow>(
      'SELECT * FROM capability_versions WHERE organization_id=$1 AND id=$2',
      [organizationId, versionId],
    );
    return result.rows[0] ? this.version(result.rows[0]) : undefined;
  }

  async transitionVersion(
    input: Parameters<PublicationDataStore['transitionVersion']>[0],
  ): Promise<PublishedVersionRecord> {
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<VersionRow>(
        'SELECT * FROM capability_versions WHERE organization_id=$1 AND id=$2 FOR UPDATE',
        [input.organizationId, input.versionId],
      );
      const row = locked.rows[0];
      if (!row) this.denied();
      if (row.status !== input.from) throw new AppError('VERSION_TRANSITION_CONFLICT', 'Version status changed.', 409);
      await client.query('UPDATE capability_versions SET status=$2 WHERE id=$1', [input.versionId, input.to]);
      await this.recordEvents(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        publicationId: input.versionId,
        action: `capability.version.${input.to}`,
        eventType: `capability.version.${input.to}`,
        metadata: { capabilityId: row.capability_id, from: input.from, to: input.to },
        resourceType: 'capability_version',
      });
      const updated = await client.query<VersionRow>('SELECT * FROM capability_versions WHERE id=$1', [
        input.versionId,
      ]);
      await client.query('COMMIT');
      return this.version(this.requireVersionRow(updated.rows[0]));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockAndValidateCandidate(client: PoolClient, input: Parameters<PublicationDataStore['submit']>[0]) {
    if (input.candidate.sourceRevisionId) {
      const locked = await client.query<{
        current_revision_id: string | null;
        status: string;
        content_digest: string;
        scan_status: string;
      }>(
        `SELECT d.current_revision_id,d.status,r.content_digest,r.scan_status
           FROM capability_drafts d JOIN draft_revisions r ON r.id=d.current_revision_id
          WHERE d.organization_id=$1 AND d.capability_id=$2 AND d.current_revision_id=$3 FOR UPDATE OF d`,
        [input.organizationId, input.candidate.capabilityId, input.candidate.sourceRevisionId],
      );
      const row = locked.rows[0];
      if (
        row?.status !== 'ready' ||
        row.scan_status !== 'passed' ||
        row.content_digest !== input.candidate.contentDigest
      ) {
        throw new AppError('PUBLICATION_CANDIDATE_STALE', 'Create a new ready revision before submitting.', 409);
      }
      return;
    }
    const locked = await client.query<{ status: string; content_digest: string }>(
      `SELECT status,content_digest FROM capability_versions
        WHERE organization_id=$1 AND id=$2 AND capability_id=$3 FOR SHARE`,
      [input.organizationId, input.candidate.sourceVersionId, input.candidate.capabilityId],
    );
    const row = locked.rows[0];
    if (
      !row ||
      !['published', 'deprecated'].includes(row.status) ||
      row.content_digest !== input.candidate.contentDigest
    ) {
      throw new AppError('PUBLICATION_SOURCE_INVALID', 'The source version is unavailable.', 409);
    }
  }

  private insertVersion(
    client: PoolClient,
    input: {
      versionId: string;
      organizationId: string;
      targetSpaceId: string;
      capabilityId: string;
      version: string;
      artifactId: string;
      digest: string;
      manifest: unknown;
      publishedAt: Date;
    },
  ) {
    return client.query(
      `INSERT INTO capability_versions
        (id,organization_id,space_id,capability_id,version,artifact_id,content_digest,manifest,status,published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'published',$9)`,
      [
        input.versionId,
        input.organizationId,
        input.targetSpaceId,
        input.capabilityId,
        input.version,
        input.artifactId,
        input.digest,
        JSON.stringify(input.manifest),
        input.publishedAt,
      ],
    );
  }

  private findByIdempotencyLocked(client: PoolClient, organizationId: string, userId: string, key: string) {
    return client
      .query<PublicationRow>(
        `SELECT * FROM publications WHERE organization_id=$1 AND submitted_by_user_id=$2 AND idempotency_key=$3 FOR UPDATE`,
        [organizationId, userId, key],
      )
      .then((result) => result.rows[0]);
  }

  private async recordEvents(
    client: PoolClient,
    input: {
      organizationId: string;
      actorUserId: string;
      publicationId: string;
      action: string;
      eventType: string;
      metadata: Record<string, unknown>;
      resourceType?: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
        (id,organization_id,actor_user_id,action,resource_type,resource_id,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        randomUUID(),
        input.organizationId,
        input.actorUserId,
        input.action,
        input.resourceType ?? 'publication',
        input.publicationId,
        JSON.stringify(input.metadata),
      ],
    );
    await client.query(
      `INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,organization_id,payload)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        randomUUID(),
        input.eventType,
        input.resourceType ?? 'publication',
        input.publicationId,
        input.organizationId,
        JSON.stringify(input.metadata),
      ],
    );
  }

  private publication(row: PublicationRow): PublicationRecord {
    return {
      id: row.id,
      organizationId: row.organization_id,
      capabilityId: row.capability_id,
      sourceSpaceId: row.source_space_id,
      targetSpaceId: row.target_space_id,
      ...(row.source_revision_id ? { sourceRevisionId: row.source_revision_id } : {}),
      ...(row.source_version_id ? { sourceVersionId: row.source_version_id } : {}),
      candidateArtifactId: row.candidate_artifact_id,
      candidateDigest: row.candidate_digest,
      candidateManifest: row.candidate_manifest as PublicationRecord['candidateManifest'],
      candidateScanReport: row.candidate_scan_report as PublicationRecord['candidateScanReport'],
      ...(row.risk_acceptance
        ? { riskAcceptance: row.risk_acceptance as NonNullable<PublicationRecord['riskAcceptance']> }
        : {}),
      version: row.version,
      reviewRequired: row.review_required,
      status: row.status as PublicationStatus,
      submittedByUserId: row.submitted_by_user_id,
      idempotencyKey: row.idempotency_key,
      ...(row.published_version_id ? { publishedVersionId: row.published_version_id } : {}),
      createdAt: row.created_at,
      ...(row.resolved_at ? { resolvedAt: row.resolved_at } : {}),
    };
  }

  private version(row: VersionRow): PublishedVersionRecord {
    return {
      id: row.id,
      organizationId: row.organization_id,
      capabilityId: row.capability_id,
      spaceId: row.space_id,
      version: row.version,
      artifactId: row.artifact_id,
      contentDigest: row.content_digest,
      manifest: row.manifest as PublishedVersionRecord['manifest'],
      status: row.status as VersionStatus,
      publishedAt: row.published_at,
    };
  }

  private requirePublicationRow(row: PublicationRow | undefined): PublicationRow {
    if (!row) throw new AppError('PUBLICATION_WRITE_FAILED', 'Publication transaction produced no record.', 500);
    return row;
  }

  private requireVersionRow(row: VersionRow | undefined): VersionRow {
    if (!row) throw new AppError('VERSION_WRITE_FAILED', 'Version transaction produced no record.', 500);
    return row;
  }

  private mapWriteError(error: unknown): never {
    const constraint = this.constraint(error);
    if (constraint === 'capability_versions_capability_space_version_uidx') {
      throw new AppError('CAPABILITY_VERSION_EXISTS', 'This version already exists in the target space.', 409);
    }
    if (constraint === 'publication_reviews_publication_reviewer_uidx') {
      throw new AppError('PUBLICATION_ALREADY_REVIEWED', 'This reviewer already resolved the publication.', 409);
    }
    throw error;
  }

  private constraint(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || !('constraint' in error)) return undefined;
    return typeof error.constraint === 'string' ? error.constraint : undefined;
  }

  private denied(): never {
    throw new AppError('ACCESS_DENIED', 'You do not have access to this publication.', 403);
  }
}
