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
    const projectBindings: Array<Record<string, unknown>> = [];
    const localProjectBindings: Array<Record<string, unknown>> = [];
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
          id: '00000000-0000-4000-8000-000000000022',
          organizationId: 'org-a',
          type: 'project',
          name: '支付平台',
          slug: 'payments',
          reviewPolicy: 'required',
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
      devices: async () => [],
      registerDevice: async (_session: unknown, _organizationId: string, supportedAgents: string[]) => ({
        id: '00000000-0000-4000-8000-000000000030',
        name: 'E2E Mac',
        platform: 'macos',
        appVersion: '0.1.0',
        supportedAgents,
        status: 'active',
      }),
      createProjectBinding: async (input: Record<string, unknown>) => {
        const binding = {
          id: '00000000-0000-4000-8000-000000000031',
          organizationId: input.organizationId,
          projectSpaceId: input.spaceId,
          deviceId: input.deviceId,
          localBindingId: input.localBindingId,
          agents: input.agents,
          status: 'active',
          createdAt: new Date().toISOString(),
        };
        projectBindings.push(binding);
        return binding;
      },
      projectBindings: async () => projectBindings,
      removeProjectBinding: async () => undefined,
      syncProjectContext: async (input: {
        organizationId: string;
        spaceId: string;
        bindingId: string;
        context: Record<string, unknown>;
      }) => ({
        id: 'context-a',
        organizationId: input.organizationId,
        projectSpaceId: input.spaceId,
        bindingId: input.bindingId,
        deviceId: 'device-a',
        artifactId: 'artifact-a',
        ...input.context,
        createdAt: new Date().toISOString(),
      }),
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
      bindProjectDirectory: async (input: { spaceId: string; path: string; agents: string[] }) => {
        const binding = {
          localBindingId: '11111111-1111-4111-8111-111111111111',
          spaceId: input.spaceId,
          localPath: input.path,
          agents: input.agents,
          status: 'active',
          createdAt: '0001',
        };
        localProjectBindings.push(binding);
        return binding;
      },
      listProjectBindings: async () => localProjectBindings,
      removeProjectBinding: async () => undefined,
      inventoryProjectContext: async (localBindingId: string) => ({
        localBindingId,
        status: 'active',
        entries: [
          { relativePath: 'README.md', sizeBytes: 40, eligible: true },
          { relativePath: 'docs/policy.yaml', sizeBytes: 60, eligible: true },
          { relativePath: 'src/index.ts', sizeBytes: 100, eligible: false, ignoreReason: 'source-code' },
        ],
        eligibleFiles: 2,
        eligibleBytes: 100,
        ignored: [{ reason: 'source-code', count: 1 }],
      }),
      exportProjectContext: async (input: { selectedPaths: string[]; agents: string[] }) => ({
        digest: 'e'.repeat(64),
        selectionDigest: 'f'.repeat(64),
        fileCount: input.selectedPaths.length,
        totalBytes: 100,
        agents: input.agents,
        scanEngineVersion: 'project-context-1.0.0',
        scannedAt: new Date().toISOString(),
        archiveBase64: 'UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==',
      }),
      projectContextPlan: async () => ({ writes: [] }),
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
  await page.getByRole('button', { name: '完成' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('bind multiple project directories → explicitly select → secure sync', async ({ page }) => {
  await injectClients(page);
  await page.goto('/');
  await page.getByRole('button', { name: '项目', exact: true }).click();
  await expect(page.getByRole('heading', { name: '项目空间' })).toBeVisible();
  await page.getByRole('button', { name: '绑定另一个目录' }).click();
  await page.getByLabel('项目目录').fill('/private/work/payments');
  await page.getByLabel('Claude Code').check();
  await page.getByRole('button', { name: '确认绑定' }).click();
  await expect(page.getByTitle('/private/work/payments')).toBeVisible();
  await page.getByRole('button', { name: '选择同步' }).click();
  await expect(page.getByText('src/index.ts')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /src\/index\.ts/ })).toBeDisabled();
  await page.getByRole('checkbox', { name: /docs\/policy\.yaml/ }).uncheck();
  await page.screenshot({ path: '/tmp/agentdoor-project-context.png', fullPage: true });
  await page.getByRole('button', { name: '同步 1 个文件' }).click();
  await expect(page.getByText(/已同步 1 个显式选择的上下文文件/)).toBeVisible();
});
