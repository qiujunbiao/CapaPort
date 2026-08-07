import { describe, expect, it } from 'vitest';
import { createProjectBindingRequestSchema, registerProjectContextRequestSchema } from './projects.js';

describe('project contracts', () => {
  it('never accepts a local path as cloud binding metadata', () => {
    const result = createProjectBindingRequestSchema.safeParse({
      deviceId: crypto.randomUUID(),
      localBindingId: crypto.randomUUID(),
      agents: ['codex'],
      localPath: '/private/customer/source',
    });
    expect(result.success).toBe(false);
  });

  it('requires bounded, re-scanned context metadata', () => {
    expect(
      registerProjectContextRequestSchema.safeParse({
        bindingId: crypto.randomUUID(),
        artifactId: crypto.randomUUID(),
        digest: 'a'.repeat(64),
        selectionDigest: 'b'.repeat(64),
        fileCount: 2,
        totalBytes: 1200,
        agents: ['codex', 'claude-code'],
        scan: { status: 'passed', engineVersion: '1.0.0', scannedAt: new Date().toISOString() },
      }).success,
    ).toBe(true);
    expect(
      registerProjectContextRequestSchema.safeParse({
        bindingId: crypto.randomUUID(),
        artifactId: crypto.randomUUID(),
        digest: 'a'.repeat(64),
        selectionDigest: 'b'.repeat(64),
        fileCount: 1,
        totalBytes: 4_000_001,
        agents: ['codex'],
        scan: { status: 'passed', engineVersion: '1.0.0', scannedAt: new Date().toISOString() },
      }).success,
    ).toBe(false);
  });
});
