import { describe, expect, it } from 'vitest';
import { createCapabilityRequestSchema, requestArtifactUploadSchema } from './capabilities.js';

describe('capability contracts', () => {
  it('normalizes metadata and requires explicit Agent compatibility', () => {
    const parsed = createCapabilityRequestSchema.parse({
      spaceId: '00000000-0000-4000-8000-000000000001',
      slug: 'RELEASE-HELPER',
      name: ' Release helper ',
      compatibility: ['codex'],
    });
    expect(parsed).toMatchObject({ slug: 'release-helper', name: 'Release helper', compatibility: ['codex'] });
  });

  it('only accepts bounded zip uploads with lowercase SHA-256 digests', () => {
    expect(
      requestArtifactUploadSchema.safeParse({
        spaceId: '00000000-0000-4000-8000-000000000001',
        fileName: 'package.zip',
        contentType: 'application/zip',
        sizeBytes: 100,
        sha256: 'a'.repeat(64),
      }).success,
    ).toBe(true);
    expect(
      requestArtifactUploadSchema.safeParse({
        spaceId: '00000000-0000-4000-8000-000000000001',
        fileName: 'package.tar',
        contentType: 'application/x-tar',
        sizeBytes: 100,
        sha256: 'a'.repeat(64),
      }).success,
    ).toBe(false);
  });
});
