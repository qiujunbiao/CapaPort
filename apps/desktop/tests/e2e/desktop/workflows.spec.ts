import { expect, type Page, test } from '@playwright/test';

async function injectClients(page: Page, options: { conflict?: boolean; pendingPublication?: boolean } = {}) {
  await page.addInitScript(({ conflict, pendingPublication }) => {
    const session = { accessToken: 'e2e-token', refreshToken: 'e2e-refresh', organizationId: 'org-a' };
    let organizationName = '平台研发';
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
    const spaces = [
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
    ];
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
      hasPublishedVersion: !pendingPublication,
    };
    const cloud = {
      isOnline: () => true,
      logout: async () => undefined,
      login: async () => session,
      me: async () => ({ id: 'user-a', displayName: '林默', identities: [] }),
      organizations: async () => [
        { id: 'org-a', name: organizationName, slug: 'platform', role: 'owner', status: 'active' },
      ],
      updateOrganization: async (_session: unknown, _organizationId: string, input: { name: string }) => {
        organizationName = input.name;
      },
      switchOrganization: async () => ({
        organizationId: 'org-a',
        membershipId: 'member-a',
        organizationRole: 'owner',
      }),
      spaces: async () => spaces,
      createSpace: async (
        _session: unknown,
        _organizationId: string,
        input: { type: 'team' | 'project'; name: string; reviewPolicy: 'direct' | 'required' },
      ) => {
        const space = {
          id: '00000000-0000-4000-8000-000000000023',
          organizationId: 'org-a',
          ...input,
          slug: 'space-generated',
          status: 'active',
        };
        spaces.push(space);
        return space;
      },
      securityPolicy: async () => ({
        blockedSeverities: ['high', 'critical'],
        confirmationSeverities: ['medium'],
        blockedTerms: [],
        allowedExecutablePaths: [],
        allowedNetworkHosts: [],
        executablePolicy: 'confirm',
      }),
      updateSecurityPolicy: async (_session: unknown, _organizationId: string, policy: Record<string, unknown>) =>
        policy,
      members: async () => [
        {
          id: 'member-a',
          userId: 'user-a',
          displayName: '林默',
          role: 'owner',
          status: 'active',
          joinedAt: new Date().toISOString(),
        },
      ],
      invitations: async () => [],
      metrics: async () => ({
        range: { from: new Date(0).toISOString(), to: new Date().toISOString() },
        productEvents: {},
        publicationFunnel: {},
        installationOutcomes: {},
        activeDevices: 1,
      }),
      sessions: async () => [],
      deadLetters: async () => [],
      audit: async () => ({ entries: [] }),
      accountDeletionStatus: async () => ({ status: 'none' }),
      recordAnalyticsEvent: async () => undefined,
      capabilities: async () => [capability],
      publications: async () => publications,
      publicationDetails: async (_session: unknown, _organizationId: string, publicationId: string) => {
        const publication = publications.find((item) => item.id === publicationId);
        if (!publication) throw new Error('Publication not found');
        return { ...publication, reviews: [] };
      },
      scanReport: async () => ({ status: 'passed', findings: [] }),
      publicationDiff: async () => ({
        fromVersionId: 'version-old',
        candidateDigest: 'f'.repeat(64),
        added: ['skills/release-helper/SKILL.md'],
        modified: ['README.md'],
        removed: [],
        recommendedChange: 'minor',
      }),
      reviewPublication: async (
        _session: unknown,
        _organizationId: string,
        publicationId: string,
        decision: string,
      ) => {
        const publication = publications.find((item) => item.id === publicationId);
        if (!publication) throw new Error('Publication not found');
        publication.status =
          decision === 'approve' ? 'published' : decision === 'reject' ? 'rejected' : 'changes_requested';
        if (decision === 'approve') capability.hasPublishedVersion = true;
        return publication;
      },
      ...(pendingPublication
        ? {
            versions: async () =>
              capability.hasPublishedVersion
                ? [
                    {
                      id: 'version-a',
                      organizationId: 'org-a',
                      capabilityId: capability.id,
                      spaceId: '00000000-0000-4000-8000-000000000021',
                      version: '1.0.0',
                      contentDigest: 'a'.repeat(64),
                      status: 'published',
                      publishedAt: new Date().toISOString(),
                    },
                  ]
                : [],
          }
        : {}),
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
      createCapabilityDraft: async () => ({
        capabilityId: capability.id,
        draftId: 'draft-a',
        revisionId: 'revision-a',
        riskFindingDigests: [],
      }),
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
      discoverLocalSkills: async () => ({
        skills: [
          {
            adapterId: 'codex',
            displayName: 'Codex',
            scope: 'user',
            sourceKind: 'shared',
            linked: false,
            sourcePath: '[authorized-root]/skills/release-helper',
            slug: 'release-helper',
            digest: 'b'.repeat(64),
          },
        ],
        issues: [],
      }),
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
      enqueueWrite: async () => undefined,
      claimReadyWrites: async () => [],
      completeWrite: async () => undefined,
      rescheduleWrite: async () => undefined,
      retryFailedWrites: async () => undefined,
    };
    Object.defineProperty(window, '__CAPAPORT_E2E__', { value: { cloud, local, sessionStore: store } });
  }, options);
}

test('discover → import → scan → submit for review', async ({ page }) => {
  await injectClients(page, { pendingPublication: true });
  await page.goto('/');
  await page.screenshot({ path: '/tmp/capaport-desktop-home.png', fullPage: true });
  await page.getByRole('button', { name: '本地发现' }).click();
  await page.getByRole('button', { name: '导入 release-helper' }).click();
  await expect(page.getByText('安全检查通过')).toBeVisible();
  await page.getByRole('button', { name: '创建云端草稿' }).click();
  await expect(page.getByRole('heading', { name: '发布中心' })).toBeVisible();
  await expect(page.getByRole('button', { name: /发布护航.*审核中/ })).toBeVisible();
  await page.screenshot({ path: '/tmp/capaport-review-with-item.png' });
  await page.getByRole('button', { name: /发布护航/ }).click();
  await expect(page.getByText('安全扫描')).toBeVisible();
  await page.getByLabel('审核理由').fill('管理员确认发布');
  await page.getByRole('button', { name: '通过审核' }).click();
  await expect(page.getByText('已发布')).toBeVisible();
  await page.getByRole('button', { name: '能力库' }).click();
  await expect(page.getByText('发布护航')).toBeVisible();
  await page.getByRole('button', { name: '安装', exact: true }).click();
  await expect(page.getByRole('heading', { name: '安装 / 更新预览' })).toBeVisible();
  await expect(page.getByText('该能力还没有可安装版本')).not.toBeVisible();
});

test('keeps application chrome fixed and constrains workspace scrolling to the vertical axis', async ({ page }) => {
  await injectClients(page);
  await page.goto('/');
  await page.getByRole('button', { name: '创作', exact: true }).click();

  const workspace = page.locator('.workspace-main');
  const before = await workspace.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowX: styles.overflowX,
      overflowY: styles.overflowY,
      overscrollBehavior: styles.overscrollBehavior,
    };
  });
  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);
  expect(before).toMatchObject({ overflowX: 'hidden', overflowY: 'auto', overscrollBehavior: 'none' });

  await workspace.evaluate((element) => element.scrollTo({ left: 1000, top: element.scrollHeight }));
  const after = await workspace.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }));
  expect(after.top).toBeGreaterThan(0);
  expect(after.left).toBe(0);
  expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual({ x: 0, y: 0 });
  await page.screenshot({ path: '/tmp/capaport-scroll-fixed.png' });
});

test('shows organization identifiers and lets an owner rename the organization', async ({ page }) => {
  await injectClients(page);
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();

  await expect(page.getByLabel('组织标识')).toHaveValue('platform');
  await expect(page.getByLabel('内部组织 ID')).toHaveValue('org-a');
  await page.getByLabel('组织名称').fill('海岸香蕉团队');
  await page.getByRole('button', { name: '保存组织名称' }).click();

  await expect(page.getByRole('status').filter({ hasText: '组织名称已更新' })).toBeVisible();
  await expect(page.getByLabel('当前组织')).toContainText('海岸香蕉团队');
  await page.screenshot({ path: '/tmp/capaport-organization-settings.png' });
});

test('creates a space from its display name without asking for a technical identifier', async ({ page }) => {
  await injectClients(page);
  await page.goto('/');
  await page.getByRole('button', { name: '空间与策略', exact: true }).click();

  await expect(page.getByLabel('英文标识')).toHaveCount(0);
  await page.getByLabel('空间名称').fill('产品交付团队');
  await page.getByRole('button', { name: '创建空间' }).click();

  await expect(page.getByRole('button', { name: /产品交付团队/ })).toBeVisible();
  await page.screenshot({ path: '/tmp/capaport-space-create-without-slug.png', fullPage: true });
});

test('search → install preview → resolve local update conflict', async ({ page }) => {
  await injectClients(page, { conflict: true });
  await page.goto('/');
  await page.getByRole('button', { name: '能力库', exact: true }).click();
  await page.getByPlaceholder('搜索名称、标识或标签').fill('发布');
  await page.getByRole('button', { name: '安装' }).click();
  await expect(page.getByText('rules/security.md')).toBeVisible();
  await page.screenshot({ path: '/tmp/capaport-install-conflict.png', fullPage: true });
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
  await page.screenshot({ path: '/tmp/capaport-project-context.png', fullPage: true });
  await page.getByRole('button', { name: '同步 1 个文件' }).click();
  await expect(page.getByText(/已同步 1 个显式选择的上下文文件/)).toBeVisible();
});

test('keeps every desktop page horizontally contained across supported window sizes', async ({ page }) => {
  await injectClients(page);
  await page.goto('/');

  const pages = [
    '首页',
    '能力库',
    '创作',
    '项目',
    '发布',
    '设置',
    '组织概览',
    '能力资产',
    '审核中心',
    '成员与邀请',
    '空间与策略',
    '安全中心',
    '审计日志',
    '采用分析',
    '组织设置',
  ];
  const layoutIssues: string[] = [];
  for (const width of [1440, 1280, 1180, 980]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of pages) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(1);
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page.locator('.workspace-main .page')).toBeVisible();
      const overflow = await page.evaluate(() => {
        const workspace = document.querySelector<HTMLElement>('.workspace-main');
        const railNav = document.querySelector<HTMLElement>('.side-rail nav');
        const rail = document.querySelector<HTMLElement>('.side-rail');
        if (!workspace || !railNav || !rail) return ['missing-layout-root'];
        const workspaceRect = workspace.getBoundingClientRect();
        const railRect = rail.getBoundingClientRect();
        const issues: string[] = [];
        if (workspace.scrollWidth > workspace.clientWidth + 1) issues.push('workspace-scrolls-x');
        if (railNav.scrollWidth > railNav.clientWidth + 1) issues.push('navigation-scrolls-x');
        for (const child of rail.querySelectorAll<HTMLElement>('.side-rail__brand *')) {
          const style = getComputedStyle(child);
          if (style.display === 'none') continue;
          const rect = child.getBoundingClientRect();
          if (rect.width && (rect.right > railRect.right + 1 || rect.left < railRect.left - 1)) {
            issues.push(`${child.className || child.tagName}:outside-side-rail`);
          }
        }
        for (const container of document.querySelectorAll<HTMLElement>(
          '.workspace-main .panel, .workspace-main .publishing-stages, .workspace-main .metric-strip',
        )) {
          const containerRect = container.getBoundingClientRect();
          if (containerRect.right > workspaceRect.right + 1 || containerRect.left < workspaceRect.left - 1) {
            issues.push(`${container.className}:outside-workspace`);
          }
          for (const child of container.querySelectorAll<HTMLElement>(':scope > *, :scope > * > *')) {
            const style = getComputedStyle(child);
            if (style.display === 'none' || style.position === 'absolute' || style.position === 'fixed') continue;
            const rect = child.getBoundingClientRect();
            if (rect.width && (rect.right > containerRect.right + 1 || rect.left < containerRect.left - 1)) {
              issues.push(
                `${child.textContent?.trim() || child.className || child.tagName}:outside-${container.className}(${Math.round(rect.left)}-${Math.round(rect.right)} vs ${Math.round(containerRect.left)}-${Math.round(containerRect.right)})`,
              );
            }
          }
        }
        return [...new Set(issues)];
      });
      layoutIssues.push(...overflow.map((issue) => `${name} at ${width}px: ${issue}`));
      if (width === 1440 && name === '审核中心') {
        await page.screenshot({ path: '/tmp/capaport-governance-review.png' });
      }
      if (width === 1280 && name === '审核中心') {
        await page.screenshot({ path: '/tmp/capaport-governance-review-default.png' });
      }
      if (width === 1440 && name === '安全中心') {
        await page.screenshot({ path: '/tmp/capaport-governance-security.png' });
      }
      if (width === 1440 && name === '审计日志') {
        await page.screenshot({ path: '/tmp/capaport-governance-audit.png' });
      }
      if (width === 1440 && name === '组织设置') {
        await page.screenshot({ path: '/tmp/capaport-governance-settings.png' });
      }
      if (width === 980 && name === '空间与策略') {
        await page.screenshot({ path: '/tmp/capaport-governance-spaces-compact.png' });
      }
    }
  }
  expect(layoutIssues).toEqual([]);
});
