// @vitest-environment node

import type { CapabilityVersionSummary } from '@agentdoor/contracts';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildLocalInstallPlan, calculatePackageDigest, selectInstallVersion } from './install-plan';

describe('desktop install plan verification', () => {
  it('verifies the canonical package digest before preparing local writes', async () => {
    const entries = {
      'agentdoor.yaml': new TextEncoder().encode(
        'metadata:\n  slug: secure-review\nspec:\n  components:\n    - type: skill\n      path: skills/secure-review\n',
      ),
      'skills/secure-review/SKILL.md': new TextEncoder().encode('# Secure review'),
    };
    const archive = zipSync(entries);
    const digest = await calculatePackageDigest(entries);
    const plan = await buildLocalInstallPlan({
      archive,
      adapterId: 'codex',
      rootPath: '[authorized-root]',
      packageDigest: digest,
    });
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]?.relativePath).toBe('skills/secure-review/SKILL.md');
    await expect(
      buildLocalInstallPlan({
        archive,
        adapterId: 'codex',
        rootPath: '[authorized-root]',
        packageDigest: '0'.repeat(64),
      }),
    ).rejects.toThrow('能力包摘要验证失败');
  });

  it('uses the persisted install-lock digest for clean updates and leaves new files without an expectation', async () => {
    const entries = {
      'agentdoor.yaml': new TextEncoder().encode(
        'metadata:\n  slug: secure-review\nspec:\n  components:\n    - type: skill\n      path: skills/secure-review\n',
      ),
      'skills/secure-review/SKILL.md': new TextEncoder().encode('# Secure review v2'),
      'skills/secure-review/reference.md': new TextEncoder().encode('# Reference'),
    };
    const plan = await buildLocalInstallPlan({
      archive: zipSync(entries),
      adapterId: 'codex',
      rootPath: '[authorized-root]',
      packageDigest: await calculatePackageDigest(entries),
      installedFiles: [
        {
          relativePath: 'skills/secure-review/SKILL.md',
          afterDigest: 'a'.repeat(64),
        },
      ],
    });

    expect(plan.writes.find((write) => write.relativePath.endsWith('SKILL.md'))?.expectedDigest).toBe('a'.repeat(64));
    expect(plan.writes.find((write) => write.relativePath.endsWith('reference.md'))?.expectedDigest).toBeUndefined();
  });

  it('uses semantic ordering and honors an update-check version id', () => {
    const versions = [
      { id: 'v2', version: '2.0.0', status: 'published' },
      { id: 'v10', version: '10.0.0', status: 'published' },
      { id: 'draft', version: '99.0.0', status: 'draft' },
    ] as CapabilityVersionSummary[];

    expect(selectInstallVersion(versions)?.id).toBe('v10');
    expect(selectInstallVersion(versions, 'v2')?.id).toBe('v2');
  });
});
