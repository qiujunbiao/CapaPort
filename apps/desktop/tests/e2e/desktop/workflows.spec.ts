import { expect, type Page, test } from '@playwright/test';

async function injectClients(page: Page, options: { conflict?: boolean } = {}) {
  await page.addInitScript(({ conflict }) => {
    const session = { accessToken: 'e2e-token', refreshToken: 'e2e-refresh', organizationId: 'org-a' };
    const listeners = new Set<() => void>();
    const store = {
      get: () => session,
      set: (next: typeof session) => {
        Object.assign(session, next);
        for (const listener of listeners) listener();
      },
      clear: () => undefined,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const publications: Array<Record<string, unknown>> = [];
    const capability = {
      id: '00000000-0000-4000-8000-000000000010',
      organizationId: 'org-a',
      spaceId: '00000000-0000-4000-8000-000000000020',
      slug: 'release-helper',
      name: '发布护航',
      description: '发布前检查、变更摘要与风险提示',
      tags: ['release'],
      compatibility: ['codex'],
      ownerUserId: 'user-a',
      status: 'active',
    };
    const cloud = {
      isOnline: () => true,
      login: async () => session,
      me: async () => ({ id: 'user-a', displayName: '林默', identities: [] }),
      organizations: async () => [{ id: 'org-a', name: '平台研发', slug: 'platform', role: 'owner', status: 'active' }],
      switchOrganization: async () => ({
        organizationId: 'org-a',
        membershipId: 'member-a',
        organizationRole: 'owner',
      }),
      spaces: async () => [
        {
          id: '00000000-0000-4000-8000-000000000020',
          organizationId: 'org-a',
          type: 'personal',
          name: '个人空间',
          slug: 'personal',
          reviewPolicy: 'direct',
          status: 'active',
        },
        {
          id: '00000000-0000-4000-8000-000000000021',
          organizationId: 'org-a',
          type: 'organization',
          name: '平台研发',
          slug: 'organization',
          reviewPolicy: 'required',
          status: 'active',
        },
      ],
      capabilities: async () => [capability],
      publications: async () => publications,
      installations: async () => [],
      updateCheck: async () => ({ action: 'none', currentVersionId: 'version-a' }),
      createInstallPlan: async () => ({
        capabilityId: capability.id,
        versionId: 'version-a',
        version: '1.0.0',
        digest: 'a'.repeat(64),
        adapter: 'codex',
        permissions: { filesystem: 'read-project', network: 'none' },
        download: { url: '', expiresIn: 60 },
      }),
      createCapabilityDraft: async () => ({ capabilityId: capability.id, draftId: 'draft-a' }),
      submitPublication: async () => {
        publications.push({
          id: 'publication-a',
          organizationId: 'org-a',
          capabilityId: capability.id,
          sourceSpaceId: capability.spaceId,
          targetSpaceId: '00000000-0000-4000-8000-000000000021',
          candidateDigest: 'f'.repeat(64),
          version: '1.0.0',
          status: 'in_review',
          submittedByUserId: 'user-a',
          createdAt: new Date().toISOString(),
        });
        return { publicationId: 'publication-a' };
      },
      reportInstallation: async () => undefined,
    };
    const local = {
      detectAgents: async () => [
        { adapterId: 'codex', displayName: 'Codex', scope: 'user', rootPath: '[authorized-root]' },
      ],
      inventoryAgent: async () => [
        {
          slug: 'release-helper',
          componentType: 'skill',
          relativePath: 'skills/release-helper',
          digest: 'b'.repeat(64),
        },
      ],
      scanLocalPackage: async () => ({ files: 3, bytes: 512, findings: [], blocked: false }),
      exportLocalPackage: async () => ({
        fileName: 'release-helper.zip',
        sizeBytes: 8,
        sha256: 'c'.repeat(64),
        archiveBase64: 'UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==',
      }),
      previewInstall: async (plan: { transactionId: string }) => ({
        transactionId: plan.transactionId,
        conflicts: conflict ? 1 : 0,
        changes: [
          { relativePath: 'rules/security.md', kind: conflict ? 'conflict' : 'create', afterDigest: 'd'.repeat(64) },
        ],
      }),
      applyInstall: async (plan: { transactionId: string }) => ({
        transactionId: plan.transactionId,
        changedFiles: 1,
        state: 'applied',
      }),
      rollbackInstall: async (transactionId: string) => ({ transactionId, changedFiles: 1, state: 'rolled_back' }),
      bindProjectDirectory: async () => 'bound',
      syncQueueStatus: async () => ({ pending: 0, failed: 0 }),
    };
    Object.defineProperty(window, '__AGENTDOOR_E2E__', { value: { cloud, local, sessionStore: store } });
  }, options);
}

test('discover → import → scan → submit for review', async ({ page }) => {
  await injectClients(page);
  await page.goto('/');
  await page.screenshot({ path: '/tmp/agentdoor-desktop-home.png', fullPage: true });
  await page.getByRole('button', { name: '本地发现' }).click();
  await page.getByRole('button', { name: '导入 release-helper' }).click();
  await expect(page.getByText('安全检查通过')).toBeVisible();
  await page.getByRole('button', { name: '创建云端草稿' }).click();
  await expect(page.getByRole('heading', { name: '发布中心' })).toBeVisible();
  await expect(page.getByText('审核中')).toBeVisible();
});

test('search → install preview → resolve local update conflict', async ({ page }) => {
  await injectClients(page, { conflict: true });
  await page.goto('/');
  await page.getByRole('button', { name: '能力库', exact: true }).click();
  await page.getByPlaceholder('搜索名称、标签或发布者').fill('发布');
  await page.getByRole('button', { name: '安装' }).click();
  await expect(page.getByText('rules/security.md')).toBeVisible();
  await page.screenshot({ path: '/tmp/agentdoor-install-conflict.png', fullPage: true });
  await page.getByLabel('保留本地版本').click();
  await page.getByRole('button', { name: '确认安装' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
});
