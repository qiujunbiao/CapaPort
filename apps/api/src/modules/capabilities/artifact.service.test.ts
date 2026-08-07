import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../platform/errors/app-error.js';
import { ArtifactService } from './artifact.service.js';

const tenant = { organizationId: 'org-a', membershipId: 'member-a', organizationRole: 'member' as const };
const bytes = new TextEncoder().encode('canonical archive');
const digest = createHash('sha256').update(bytes).digest('hex');

describe('ArtifactService', () => {
  const spaces = { authorize: vi.fn().mockResolvedValue({}) };
  const storage = {
    createUploadUrl: vi.fn().mockResolvedValue('https://objects.example/upload'),
    statObject: vi.fn().mockResolvedValue({ sizeBytes: bytes.byteLength }),
    readObject: vi.fn().mockResolvedValue(bytes),
    writeVerifiedObject: vi.fn().mockResolvedValue(undefined),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  };
  const store = {
    createUpload: vi.fn().mockResolvedValue(undefined),
    findUpload: vi.fn(),
    markFailed: vi.fn().mockResolvedValue(undefined),
    confirmUpload: vi.fn(),
    findArtifact: vi.fn(),
    listExpiredUploads: vi.fn().mockResolvedValue([]),
    markExpired: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => vi.clearAllMocks());

  it('creates a short-lived upload plan whose storage key never contains the original name', async () => {
    const service = new ArtifactService(store, storage, spaces);
    const result = await service.requestUpload(tenant, 'user-a', {
      spaceId: '00000000-0000-4000-8000-000000000001',
      fileName: 'customer-secret-name.zip',
      contentType: 'application/zip',
      sizeBytes: bytes.byteLength,
      sha256: digest,
    });
    expect(result).toMatchObject({ method: 'PUT', expiresIn: 300 });
    expect(store.createUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        originalName: 'customer-secret-name.zip',
        objectKey: expect.stringMatching(/^uploads\/org-a\//),
      }),
    );
    expect(storage.createUploadUrl.mock.calls[0]?.[0]).not.toContain('customer-secret-name');
  });

  it('rejects a digest mismatch, deletes the object, and does not create an artifact', async () => {
    store.findUpload.mockResolvedValue({
      id: 'upload-a',
      organizationId: 'org-a',
      spaceId: 'space-a',
      requestedByUserId: 'user-a',
      declaredSizeBytes: bytes.byteLength,
      declaredSha256: '0'.repeat(64),
      objectKey: 'uploads/org-a/random',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new ArtifactService(store, storage, spaces);
    await expect(service.confirmUpload(tenant, 'user-a', 'upload-a')).rejects.toMatchObject({
      code: 'ARTIFACT_DIGEST_MISMATCH',
    });
    expect(storage.deleteObject).toHaveBeenCalledWith('uploads/org-a/random');
    expect(store.markFailed).toHaveBeenCalledWith('org-a', 'upload-a', 'digest_mismatch');
    expect(store.confirmUpload).not.toHaveBeenCalled();
  });

  it('deduplicates equal content inside one organization and removes the redundant object', async () => {
    store.findUpload.mockResolvedValue({
      id: 'upload-a',
      organizationId: 'org-a',
      spaceId: 'space-a',
      requestedByUserId: 'user-a',
      declaredSizeBytes: bytes.byteLength,
      declaredSha256: digest,
      objectKey: 'uploads/org-a/random',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
    });
    store.confirmUpload.mockResolvedValue({ artifactId: 'artifact-existing', deduplicated: true });
    const service = new ArtifactService(store, storage, spaces);
    await expect(service.confirmUpload(tenant, 'user-a', 'upload-a')).resolves.toMatchObject({
      artifactId: 'artifact-existing',
      deduplicated: true,
    });
    expect(storage.deleteObject).toHaveBeenCalledWith('uploads/org-a/random');
  });

  it('copies verified bytes to an immutable server-owned key before confirmation', async () => {
    store.findUpload.mockResolvedValue({
      id: 'upload-a',
      organizationId: 'org-a',
      spaceId: 'space-a',
      requestedByUserId: 'user-a',
      declaredSizeBytes: bytes.byteLength,
      declaredSha256: digest,
      objectKey: 'uploads/org-a/client-writable',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
    });
    store.confirmUpload.mockResolvedValue({ artifactId: 'artifact-a', deduplicated: false });
    const service = new ArtifactService(store, storage, spaces);

    await service.confirmUpload(tenant, 'user-a', 'upload-a');

    const verifiedKey = storage.writeVerifiedObject.mock.calls[0]?.[0];
    expect(verifiedKey).toMatch(/^artifacts\/org-a\/[0-9a-f-]+$/);
    expect(storage.writeVerifiedObject).toHaveBeenCalledWith(verifiedKey, bytes, 'application/zip');
    expect(store.confirmUpload).toHaveBeenCalledWith(expect.objectContaining({ objectKey: verifiedKey }));
    expect(storage.deleteObject).toHaveBeenCalledWith('uploads/org-a/client-writable');
  });

  it('rejects a stat/read size race before persisting an artifact', async () => {
    const changedBytes = new TextEncoder().encode('different length after HEAD');
    store.findUpload.mockResolvedValue({
      id: 'upload-race',
      organizationId: 'org-a',
      spaceId: 'space-a',
      requestedByUserId: 'user-a',
      declaredSizeBytes: bytes.byteLength,
      declaredSha256: createHash('sha256').update(changedBytes).digest('hex'),
      objectKey: 'uploads/org-a/race',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
    });
    storage.readObject.mockResolvedValueOnce(changedBytes);
    const service = new ArtifactService(store, storage, spaces);

    await expect(service.confirmUpload(tenant, 'user-a', 'upload-race')).rejects.toMatchObject({
      code: 'ARTIFACT_SIZE_MISMATCH',
    });
    expect(storage.writeVerifiedObject).not.toHaveBeenCalled();
    expect(store.confirmUpload).not.toHaveBeenCalled();
  });

  it('expires unconfirmed uploads and rejects confirmation after the deadline', async () => {
    store.findUpload.mockResolvedValue({
      id: 'upload-expired',
      organizationId: 'org-a',
      spaceId: 'space-a',
      requestedByUserId: 'user-a',
      declaredSizeBytes: bytes.byteLength,
      declaredSha256: digest,
      objectKey: 'uploads/org-a/expired',
      status: 'pending',
      expiresAt: new Date(Date.now() - 1),
    });
    const service = new ArtifactService(store, storage, spaces);
    await expect(service.confirmUpload(tenant, 'user-a', 'upload-expired')).rejects.toBeInstanceOf(AppError);
    expect(store.markExpired).toHaveBeenCalledWith('org-a', 'upload-expired');
    expect(storage.deleteObject).toHaveBeenCalledWith('uploads/org-a/expired');
  });

  it('sweeps expired orphan objects and leaves failed deletions eligible for retry', async () => {
    store.listExpiredUploads.mockResolvedValue([
      {
        id: 'expired-a',
        organizationId: 'org-a',
        objectKey: 'uploads/org-a/a',
      },
      {
        id: 'expired-b',
        organizationId: 'org-a',
        objectKey: 'uploads/org-a/b',
      },
    ]);
    storage.deleteObject.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('storage unavailable'));
    const service = new ArtifactService(store, storage, spaces);
    await expect(service.cleanupExpired()).resolves.toBe(1);
    expect(store.markExpired).toHaveBeenCalledTimes(1);
    expect(store.markExpired).toHaveBeenCalledWith('org-a', 'expired-a');
  });
});
