import { createHash, randomUUID } from 'node:crypto';
import type { RequestArtifactUpload } from '@agentdoor/contracts/capabilities';
import type { TenantContext } from '@agentdoor/contracts/organizations';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../platform/errors/app-error.js';
import { StorageService } from '../../platform/storage/storage.service.js';
import { SpaceService } from '../access/space.service.js';

export type ArtifactUploadRecord = {
  id: string;
  organizationId: string;
  spaceId: string;
  requestedByUserId: string;
  declaredSizeBytes: number;
  declaredSha256: string;
  objectKey: string;
  status: 'pending' | 'confirmed' | 'failed' | 'expired';
  artifactId?: string;
  expiresAt: Date;
};

export type ArtifactRecord = {
  id: string;
  organizationId: string;
  sha256: string;
  sizeBytes: number;
  objectKey: string;
  status: 'ready' | 'quarantined';
};

export interface ArtifactDataStore {
  createUpload(input: ArtifactUploadRecord & { originalName: string; contentType: 'application/zip' }): Promise<void>;
  findUpload(organizationId: string, uploadId: string, userId: string): Promise<ArtifactUploadRecord | undefined>;
  markFailed(organizationId: string, uploadId: string, failureCode: string): Promise<void>;
  markExpired(organizationId: string, uploadId: string): Promise<void>;
  confirmUpload(input: {
    organizationId: string;
    uploadId: string;
    artifactId: string;
    sha256: string;
    sizeBytes: number;
    objectKey: string;
  }): Promise<{ artifactId: string; deduplicated: boolean }>;
  findArtifact(organizationId: string, artifactId: string): Promise<ArtifactRecord | undefined>;
  listExpiredUploads(now: Date, limit: number): Promise<ArtifactUploadRecord[]>;
}

export interface ArtifactObjectStore {
  createUploadUrl(objectKey: string, contentType: 'application/zip', expiresIn: number): Promise<string>;
  uploadHeaders?(): Record<string, string>;
  statObject(objectKey: string): Promise<{ sizeBytes: number }>;
  readObject(objectKey: string): Promise<Uint8Array>;
  writeVerifiedObject(objectKey: string, bytes: Uint8Array, contentType: 'application/zip'): Promise<void>;
  deleteObject(objectKey: string): Promise<void>;
  createDownloadUrl?(objectKey: string, expiresIn: number): Promise<string>;
}

@Injectable()
export class ArtifactService {
  constructor(
    @Inject('ARTIFACT_DATA_STORE') private readonly repository: ArtifactDataStore,
    @Inject(StorageService) private readonly storage: ArtifactObjectStore,
    @Inject(SpaceService) private readonly spaces: Pick<SpaceService, 'authorize'>,
  ) {}

  async requestUpload(tenant: TenantContext, userId: string, input: RequestArtifactUpload) {
    await this.spaces.authorize(tenant, userId, input.spaceId, 'content:create');
    const uploadId = randomUUID();
    const objectKey = `uploads/${tenant.organizationId}/${randomUUID()}`;
    const expiresIn = 300;
    const expiresAt = new Date(Date.now() + expiresIn * 1_000);
    await this.repository.createUpload({
      id: uploadId,
      organizationId: tenant.organizationId,
      spaceId: input.spaceId,
      requestedByUserId: userId,
      originalName: input.fileName,
      contentType: input.contentType,
      declaredSizeBytes: input.sizeBytes,
      declaredSha256: input.sha256,
      objectKey,
      status: 'pending',
      expiresAt,
    });
    const url = await this.storage.createUploadUrl(objectKey, input.contentType, expiresIn);
    return {
      uploadId,
      method: 'PUT' as const,
      url,
      headers: { 'content-type': 'application/zip' as const, ...this.storage.uploadHeaders?.() },
      expiresIn,
    };
  }

  async confirmUpload(tenant: TenantContext, userId: string, uploadId: string) {
    const upload = await this.repository.findUpload(tenant.organizationId, uploadId, userId);
    if (!upload) throw new AppError('ARTIFACT_UPLOAD_INVALID', 'Upload request is invalid.', 404);
    if (upload.status === 'confirmed' && upload.artifactId) {
      return {
        artifactId: upload.artifactId,
        sha256: upload.declaredSha256,
        sizeBytes: upload.declaredSizeBytes,
        deduplicated: false,
      };
    }
    if (upload.status !== 'pending')
      throw new AppError('ARTIFACT_UPLOAD_INVALID', 'Upload request is no longer active.', 409);
    await this.spaces.authorize(tenant, userId, upload.spaceId, 'content:create');
    if (upload.expiresAt <= new Date()) {
      if (await this.deleteQuietly(upload.objectKey)) {
        await this.repository.markExpired(tenant.organizationId, upload.id);
      }
      throw new AppError('ARTIFACT_UPLOAD_EXPIRED', 'Upload authorization has expired.', 410);
    }

    let sizeBytes: number;
    try {
      sizeBytes = (await this.storage.statObject(upload.objectKey)).sizeBytes;
    } catch {
      throw new AppError('ARTIFACT_NOT_UPLOADED', 'Upload the artifact before confirming it.', 409);
    }
    if (sizeBytes !== upload.declaredSizeBytes) {
      await this.rejectUpload(upload, 'size_mismatch');
      throw new AppError('ARTIFACT_SIZE_MISMATCH', 'Uploaded artifact size does not match the declaration.', 409);
    }
    const bytes = await this.storage.readObject(upload.objectKey);
    if (bytes.byteLength !== upload.declaredSizeBytes) {
      await this.rejectUpload(upload, 'size_mismatch');
      throw new AppError('ARTIFACT_SIZE_MISMATCH', 'Uploaded artifact size does not match the declaration.', 409);
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== upload.declaredSha256) {
      await this.rejectUpload(upload, 'digest_mismatch');
      throw new AppError('ARTIFACT_DIGEST_MISMATCH', 'Uploaded artifact digest does not match the declaration.', 409);
    }

    const verifiedObjectKey = `artifacts/${tenant.organizationId}/${randomUUID()}`;
    try {
      await this.storage.writeVerifiedObject(verifiedObjectKey, bytes, 'application/zip');
    } catch {
      throw new AppError('ARTIFACT_STORAGE_FAILED', 'The verified artifact could not be finalized.', 503);
    }
    let result: { artifactId: string; deduplicated: boolean };
    try {
      result = await this.repository.confirmUpload({
        organizationId: tenant.organizationId,
        uploadId: upload.id,
        artifactId: randomUUID(),
        sha256,
        sizeBytes,
        objectKey: verifiedObjectKey,
      });
    } catch (error) {
      await this.deleteQuietly(verifiedObjectKey);
      throw error;
    }
    if (result.deduplicated) await this.deleteQuietly(verifiedObjectKey);
    await this.deleteQuietly(upload.objectKey);
    return { artifactId: result.artifactId, sha256, sizeBytes, deduplicated: result.deduplicated };
  }

  async readArtifact(
    organizationId: string,
    artifactId: string,
  ): Promise<{ artifact: ArtifactRecord; bytes: Uint8Array }> {
    const artifact = await this.repository.findArtifact(organizationId, artifactId);
    if (artifact?.status !== 'ready') throw new AppError('ARTIFACT_INVALID', 'Artifact is unavailable.', 404);
    return { artifact, bytes: await this.storage.readObject(artifact.objectKey) };
  }

  async createDownload(organizationId: string, artifactId: string, expiresIn = 120) {
    const artifact = await this.repository.findArtifact(organizationId, artifactId);
    if (artifact?.status !== 'ready' || !this.storage.createDownloadUrl) {
      throw new AppError('ARTIFACT_INVALID', 'Artifact is unavailable.', 404);
    }
    return { url: await this.storage.createDownloadUrl(artifact.objectKey, expiresIn), expiresIn };
  }

  async cleanupExpired(now = new Date(), limit = 100): Promise<number> {
    const uploads = await this.repository.listExpiredUploads(now, limit);
    let cleaned = 0;
    for (const upload of uploads) {
      if (await this.deleteQuietly(upload.objectKey)) {
        await this.repository.markExpired(upload.organizationId, upload.id);
        cleaned += 1;
      }
    }
    return cleaned;
  }

  private async rejectUpload(upload: ArtifactUploadRecord, failureCode: string): Promise<void> {
    if (await this.deleteQuietly(upload.objectKey)) {
      await this.repository.markFailed(upload.organizationId, upload.id, failureCode);
    }
  }

  private async deleteQuietly(objectKey: string): Promise<boolean> {
    try {
      await this.storage.deleteObject(objectKey);
      return true;
    } catch {
      // Cleanup is retried by the orphan sweeper; the API response remains redacted.
      return false;
    }
  }
}
