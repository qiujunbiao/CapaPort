// @vitest-environment node

import type { CapabilityVersionSummary } from '@capaport/contracts';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildLocalInstallPlan, calculatePackageDigest, selectInstallVersion } from './install-plan';

describe('desktop install plan verification', () => {
  it('verifies the canonical package digest before preparing local writes', async () => {
    const entries = {
      'capaport.yaml': new TextEncoder().encode(
        'metadata:\n  slug: secure-review\nspec:\n  compatibility:\n    agents: [codex]\n  components:\n    - type: skill\n      path: skills/secure-review\n',
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
      'capaport.yaml': new TextEncoder().encode(
        'metadata:\n  slug: secure-review\nspec:\n  compatibility:\n    agents: [codex]\n  components:\n    - type: skill\n      path: skills/secure-review\n',
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

  it('projects canonical components to Cursor MDC and Gemini TOML files', async () => {
    const cursorEntries = {
      'capaport.yaml': new TextEncoder().encode(
        'metadata:\n  slug: secure-review\nspec:\n  compatibility:\n    agents: [cursor]\n  components:\n    - type: context\n      path: context/secure-review.md\n',
      ),
      'context/secure-review.md': new TextEncoder().encode('# Secure review'),
    };
    const cursor = await buildLocalInstallPlan({
      archive: zipSync(cursorEntries),
      adapterId: 'cursor',
      rootPath: '[authorized-root]',
      packageDigest: await calculatePackageDigest(cursorEntries),
    });
    expect(cursor.writes[0]?.relativePath).toBe('rules/secure-review.mdc');

    const geminiEntries = {
      'capaport.yaml': new TextEncoder().encode(
        'metadata:\n  slug: secure-review\nspec:\n  compatibility:\n    agents: [gemini-cli]\n  components:\n    - type: prompt\n      path: prompts/secure-review.md\n',
      ),
      'prompts/secure-review.md': new TextEncoder().encode('Review {{args}} for security.'),
    };
    const gemini = await buildLocalInstallPlan({
      archive: zipSync(geminiEntries),
      adapterId: 'gemini-cli',
      rootPath: '[authorized-root]',
      packageDigest: await calculatePackageDigest(geminiEntries),
    });
    expect(gemini.writes[0]?.relativePath).toBe('commands/secure-review.toml');
    expect(atob(gemini.writes[0]?.contentBase64 ?? '')).toContain('prompt = "Review {{args}} for security."');
  });

  it('rejects installation when the manifest does not declare the selected agent', async () => {
    const entries = {
      'capaport.yaml': new TextEncoder().encode(
        'metadata:\n  slug: secure-review\nspec:\n  compatibility:\n    agents: [claude-code]\n  components:\n    - type: skill\n      path: skills/secure-review\n',
      ),
      'skills/secure-review/SKILL.md': new TextEncoder().encode('# Secure review'),
    };

    await expect(
      buildLocalInstallPlan({
        archive: zipSync(entries),
        adapterId: 'codex',
        rootPath: '[authorized-root]',
        packageDigest: await calculatePackageDigest(entries),
      }),
    ).rejects.toThrow('能力包未声明兼容 codex');
  });

  it.each(['workbuddy', 'qwenwork'])('projects %s Skill files without enabling Prompt', async (adapterId) => {
    const entries = {
      'capaport.yaml': new TextEncoder().encode(
        `metadata:\n  slug: secure-review\nspec:\n  compatibility:\n    agents: [${adapterId}]\n  components:\n    - type: skill\n      path: skills/secure-review\n`,
      ),
      'skills/secure-review/SKILL.md': new TextEncoder().encode('# Secure review'),
      'skills/secure-review/references/guide.md': new TextEncoder().encode('# Guide'),
    };
    const plan = await buildLocalInstallPlan({
      archive: zipSync(entries),
      adapterId,
      rootPath: '[authorized-root]',
      packageDigest: await calculatePackageDigest(entries),
    });
    expect(plan.writes.map((write) => write.relativePath)).toEqual([
      'skills/secure-review/references/guide.md',
      'skills/secure-review/SKILL.md',
    ]);

    const promptEntries = {
      'capaport.yaml': new TextEncoder().encode(
        `metadata:\n  slug: secure-review\nspec:\n  compatibility:\n    agents: [${adapterId}]\n  components:\n    - type: prompt\n      path: prompts/secure-review.md\n`,
      ),
      'prompts/secure-review.md': new TextEncoder().encode('Review securely.'),
    };
    await expect(
      buildLocalInstallPlan({
        archive: zipSync(promptEntries),
        adapterId,
        rootPath: '[authorized-root]',
        packageDigest: await calculatePackageDigest(promptEntries),
      }),
    ).rejects.toThrow('所选 Agent 不支持 prompt');
  });
});
