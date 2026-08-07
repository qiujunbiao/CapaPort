// @vitest-environment node

import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildLocalInstallPlan, calculatePackageDigest } from './install-plan';

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
});
