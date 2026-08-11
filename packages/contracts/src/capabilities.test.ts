import { describe, expect, it } from 'vitest';
import {
  createCapabilityRequestSchema,
  requestArtifactUploadSchema,
  updateCapabilityRequestSchema,
} from './capabilities.js';

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

  it('rejects an empty capability metadata update without injecting create defaults', () => {
    expect(updateCapabilityRequestSchema.safeParse({}).success).toBe(false);
    expect(updateCapabilityRequestSchema.parse({ description: '', tags: [] })).toEqual({ description: '', tags: [] });
  });

  it('accepts all six supported agents and rejects a seventh entry', () => {
    const request = {
      spaceId: '00000000-0000-4000-8000-000000000001',
      slug: 'portable-skill',
      name: 'Portable skill',
      compatibility: ['codex', 'claude-code', 'cursor', 'gemini-cli', 'workbuddy', 'qwenwork'],
    };
    expect(createCapabilityRequestSchema.safeParse(request).success).toBe(true);
    expect(
      createCapabilityRequestSchema.safeParse({ ...request, compatibility: [...request.compatibility, 'codex'] })
        .success,
    ).toBe(false);
  });
});
