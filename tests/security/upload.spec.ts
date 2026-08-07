import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactService } from '../../apps/api/src/modules/capabilities/artifact.service.js';

const tenant = { organizationId: 'org-a', membershipId: 'member-a', organizationRole: 'member' as const };

function fixture(content: Uint8Array, declaredSize = content.byteLength) {
  const store = {
    findUpload: vi.fn().mockResolvedValue({
      id: 'upload-a',
      organizationId: 'org-a',
      spaceId: 'space-a',
      requestedByUserId: 'user-a',
      declaredSizeBytes: declaredSize,
      declaredSha256: createHash('sha256').update(content).digest('hex'),
      objectKey: 'uploads/org-a/client-writable',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
    }),
    markFailed: vi.fn(),
    confirmUpload: vi.fn().mockResolvedValue({ artifactId: 'artifact-a', deduplicated: false }),
  };
  const storage = {
    statObject: vi.fn().mockResolvedValue({ sizeBytes: declaredSize }),
    readObject: vi.fn().mockResolvedValue(content),
    writeVerifiedObject: vi.fn(),
    deleteObject: vi.fn(),
  };
  return {
    store,
    storage,
    service: new ArtifactService(store as never, storage as never, { authorize: vi.fn() } as never),
  };
}

describe('upload digest and immutability gate', () => {
  it('does not trust a matching HEAD when the subsequent object body has changed size', async () => {
    const original = new TextEncoder().encode('original');
    const changed = new TextEncoder().encode('changed after head request');
    const { service, storage, store } = fixture(changed, original.byteLength);
    await expect(service.confirmUpload(tenant, 'user-a', 'upload-a')).rejects.toMatchObject({
      code: 'ARTIFACT_SIZE_MISMATCH',
    });
    expect(storage.writeVerifiedObject).not.toHaveBeenCalled();
    expect(store.confirmUpload).not.toHaveBeenCalled();
  });

  it('finalizes verified bytes under a server-owned random artifact key', async () => {
    const content = new TextEncoder().encode('verified canonical package');
    const { service, storage, store } = fixture(content);
    await service.confirmUpload(tenant, 'user-a', 'upload-a');
    const key = storage.writeVerifiedObject.mock.calls[0]?.[0];
    expect(key).toMatch(/^artifacts\/org-a\/[0-9a-f-]+$/);
    expect(key).not.toBe('uploads/org-a/client-writable');
    expect(store.confirmUpload).toHaveBeenCalledWith(expect.objectContaining({ objectKey: key }));
    expect(storage.deleteObject).toHaveBeenCalledWith('uploads/org-a/client-writable');
  });
});
