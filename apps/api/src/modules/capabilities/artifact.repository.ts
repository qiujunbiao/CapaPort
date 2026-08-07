import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, lt } from 'drizzle-orm';
import { artifacts, artifactUploads } from '../../db/schema/capabilities.js';
import { auditLogs } from '../../db/schema/organizations.js';
import type { DatabaseService } from '../../platform/database/database.service.js';
import { AppError } from '../../platform/errors/app-error.js';
import type { ArtifactDataStore, ArtifactRecord, ArtifactUploadRecord } from './artifact.service.js';

@Injectable()
export class ArtifactRepository implements ArtifactDataStore {
  constructor(@Inject('DATABASE_SERVICE') private readonly database: DatabaseService) {}

  async createUpload(
    input: ArtifactUploadRecord & { originalName: string; contentType: 'application/zip' },
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.insert(artifactUploads).values({
        id: input.id,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        requestedByUserId: input.requestedByUserId,
        originalName: input.originalName,
        contentType: input.contentType,
        declaredSizeBytes: input.declaredSizeBytes,
        declaredSha256: input.declaredSha256,
        objectKey: input.objectKey,
        status: input.status,
        expiresAt: input.expiresAt,
      });
      await transaction.insert(auditLogs).values({
        id: randomUUID(),
        organizationId: input.organizationId,
        actorUserId: input.requestedByUserId,
        action: 'artifact.upload_requested',
        resourceType: 'artifact_upload',
        resourceId: input.id,
        metadata: { spaceId: input.spaceId, sizeBytes: input.declaredSizeBytes },
      });
    });
  }

  async findUpload(
    organizationId: string,
    uploadId: string,
    userId: string,
  ): Promise<ArtifactUploadRecord | undefined> {
    const [row] = await this.database.db
      .select()
      .from(artifactUploads)
      .where(
        and(
          eq(artifactUploads.organizationId, organizationId),
          eq(artifactUploads.id, uploadId),
          eq(artifactUploads.requestedByUserId, userId),
        ),
      )
      .limit(1);
    return row ? this.upload(row) : undefined;
  }

  async markFailed(organizationId: string, uploadId: string, failureCode: string): Promise<void> {
    await this.database.db
      .update(artifactUploads)
      .set({ status: 'failed', failureCode })
      .where(
        and(
          eq(artifactUploads.organizationId, organizationId),
          eq(artifactUploads.id, uploadId),
          eq(artifactUploads.status, 'pending'),
        ),
      );
  }

  async markExpired(organizationId: string, uploadId: string): Promise<void> {
    await this.database.db
      .update(artifactUploads)
      .set({ status: 'expired', failureCode: 'expired' })
      .where(
        and(
          eq(artifactUploads.organizationId, organizationId),
          eq(artifactUploads.id, uploadId),
          eq(artifactUploads.status, 'pending'),
        ),
      );
  }

  async confirmUpload(input: {
    organizationId: string;
    uploadId: string;
    artifactId: string;
    sha256: string;
    sizeBytes: number;
    objectKey: string;
  }): Promise<{ artifactId: string; deduplicated: boolean }> {
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const uploadResult = await client.query<{
        status: string;
        artifact_id: string | null;
        requested_by_user_id: string;
      }>(
        `SELECT status, artifact_id, requested_by_user_id FROM artifact_uploads
          WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [input.organizationId, input.uploadId],
      );
      const upload = uploadResult.rows[0];
      if (!upload) throw new AppError('ARTIFACT_UPLOAD_INVALID', 'Upload request is invalid.', 404);
      if (upload.status === 'confirmed' && upload.artifact_id) {
        await client.query('COMMIT');
        // Another confirmation won the row lock; the caller's freshly finalized
        // object was not referenced and must be removed as a duplicate.
        return { artifactId: upload.artifact_id, deduplicated: true };
      }
      if (upload.status !== 'pending')
        throw new AppError('ARTIFACT_UPLOAD_INVALID', 'Upload is no longer active.', 409);

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO artifacts (id,organization_id,sha256,size_bytes,object_key,status)
         VALUES ($1,$2,$3,$4,$5,'ready')
         ON CONFLICT (organization_id,sha256) DO NOTHING RETURNING id`,
        [input.artifactId, input.organizationId, input.sha256, input.sizeBytes, input.objectKey],
      );
      let artifactId = inserted.rows[0]?.id;
      let deduplicated = false;
      if (!artifactId) {
        const existing = await client.query<{ id: string; object_key: string }>(
          'SELECT id,object_key FROM artifacts WHERE organization_id=$1 AND sha256=$2',
          [input.organizationId, input.sha256],
        );
        const artifact = existing.rows[0];
        if (!artifact) throw new Error('Artifact deduplication invariant failed.');
        artifactId = artifact.id;
        deduplicated = artifact.object_key !== input.objectKey;
      }
      await client.query(
        `UPDATE artifact_uploads SET status='confirmed',artifact_id=$3,confirmed_at=now()
          WHERE organization_id=$1 AND id=$2`,
        [input.organizationId, input.uploadId, artifactId],
      );
      await client.query(
        `INSERT INTO audit_logs
           (id,organization_id,actor_user_id,action,resource_type,resource_id,metadata)
         VALUES ($1,$2,$3,'artifact.upload_confirmed','artifact',$4,$5::jsonb)`,
        [
          randomUUID(),
          input.organizationId,
          upload.requested_by_user_id,
          artifactId,
          JSON.stringify({ sha256: input.sha256, sizeBytes: input.sizeBytes, deduplicated }),
        ],
      );
      await client.query('COMMIT');
      return { artifactId, deduplicated };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findArtifact(organizationId: string, artifactId: string): Promise<ArtifactRecord | undefined> {
    const [row] = await this.database.db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.organizationId, organizationId), eq(artifacts.id, artifactId)))
      .limit(1);
    return row
      ? {
          id: row.id,
          organizationId: row.organizationId,
          sha256: row.sha256,
          sizeBytes: row.sizeBytes,
          objectKey: row.objectKey,
          status: row.status as ArtifactRecord['status'],
        }
      : undefined;
  }

  async listExpiredUploads(now: Date, limit: number): Promise<ArtifactUploadRecord[]> {
    const rows = await this.database.db
      .select()
      .from(artifactUploads)
      .where(and(eq(artifactUploads.status, 'pending'), lt(artifactUploads.expiresAt, now)))
      .orderBy(asc(artifactUploads.expiresAt))
      .limit(limit);
    return rows.map((row) => this.upload(row));
  }

  private upload(row: typeof artifactUploads.$inferSelect): ArtifactUploadRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      spaceId: row.spaceId,
      requestedByUserId: row.requestedByUserId,
      declaredSizeBytes: row.declaredSizeBytes,
      declaredSha256: row.declaredSha256,
      objectKey: row.objectKey,
      status: row.status as ArtifactUploadRecord['status'],
      ...(row.artifactId ? { artifactId: row.artifactId } : {}),
      expiresAt: row.expiresAt,
    };
  }
}
