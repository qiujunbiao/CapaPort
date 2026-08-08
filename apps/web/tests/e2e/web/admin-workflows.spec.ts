import { expect, type Page, test } from '@playwright/test';

async function injectConsole(page: Page) {
  await page.addInitScript(() => {
    const session = { accessToken: 'token', refreshToken: 'refresh', organizationId: 'org-a' };
    const listeners = new Set<() => void>();
    const sessionStore = {
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
    const spaces = [
      {
        id: 'space-org',
        organizationId: 'org-a',
        type: 'organization',
        name: '平台组织空间',
        slug: 'organization',
        reviewPolicy: 'required',
        status: 'active',
      },
      {
        id: 'space-personal',
        organizationId: 'org-a',
        type: 'personal',
        name: '个人空间',
        slug: 'personal',
        reviewPolicy: 'direct',
        status: 'active',
        ownerUserId: 'user-a',
      },
    ];
    const invitations: Array<Record<string, unknown>> = [];
    const publication = {
      id: 'publication-a',
      organizationId: 'org-a',
      capabilityId: 'cap-a',
      sourceSpaceId: 'space-personal',
      targetSpaceId: 'space-org',
      candidateDigest: 'a'.repeat(64),
      version: '1.0.0',
      status: 'in_review',
      submittedByUserId: 'user-b',
      createdAt: '2026-08-08T00:00:00.000Z',
    };
    const version = {
      id: 'version-a',
      organizationId: 'org-a',
      capabilityId: 'cap-a',
      spaceId: 'space-org',
      version: '1.0.0',
      contentDigest: 'b'.repeat(64),
      status: 'published',
      publishedAt: '2026-08-08T00:00:00.000Z',
    };
    const client = {
      login: async () => session,
      register: async () => ({ challengeId: 'c', maskedTarget: 'a***' }),
      verify: async () => ({ verified: true }),
      logout: async () => undefined,
      me: async () => ({ id: 'user-a', displayName: '林默', identities: [] }),
      organizations: async () => [{ id: 'org-a', name: '平台研发', slug: 'platform', role: 'owner', status: 'active' }],
      createOrganization: async () => ({ id: 'org-a' }),
      switchOrganization: async () => undefined,
      acceptInvitation: async () => ({ status: 'accepted', organizationId: 'org-a' }),
      updateOrganization: async () => undefined,
      members: async () => [
        {
          id: 'member-a',
          userId: 'user-a',
          displayName: '林默',
          role: 'owner',
          status: 'active',
          joinedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      invitations: async () => invitations,
      invite: async (_organizationId: string, input: Record<string, unknown>) => {
        invitations.push({
          id: `invite-${invitations.length}`,
          ...input,
          expiresAt: '2026-08-15T00:00:00.000Z',
          acceptedAt: null,
          revokedAt: null,
          createdAt: '2026-08-08T00:00:00.000Z',
        });
      },
      revokeInvitation: async () => undefined,
      changeMemberRole: async () => undefined,
      removeMember: async () => undefined,
      spaces: async () => spaces,
      createSpace: async (input: Record<string, unknown>) => {
        const created = { id: `space-${spaces.length}`, organizationId: 'org-a', status: 'active', ...input };
        spaces.push(created as (typeof spaces)[number]);
        return created;
      },
      updateSpacePolicy: async () => undefined,
      archiveSpace: async () => undefined,
      capabilities: async () => [
        {
          id: 'cap-a',
          organizationId: 'org-a',
          spaceId: 'space-org',
          slug: 'release-helper',
          name: '发布护航',
          description: '发布检查与风险提示',
          tags: ['release'],
          compatibility: ['codex', 'claude-code'],
          ownerUserId: 'user-a',
          status: 'active',
        },
      ],
      versions: async () => [version],
      transitionVersion: async (_capabilityId: string, _versionId: string, action: string) => {
        version.status = action === 'withdraw' ? 'withdrawn' : action === 'archive' ? 'archived' : 'deprecated';
      },
      publications: async () => [publication],
      publication: async () => ({ ...publication, reviews: [] }),
      scanReport: async () => ({ status: 'passed', findings: [] }),
      publicationDiff: async () => ({
        againstVersionId: null,
        added: ['skills/release/SKILL.md'],
        modified: [],
        removed: [],
        recommendedChange: 'minor',
      }),
      review: async (_id: string, decision: string) => {
        publication.status =
          decision === 'approve' ? 'published' : decision === 'request-changes' ? 'changes_requested' : 'rejected';
      },
      withdrawPublication: async () => {
        publication.status = 'withdrawn';
      },
      audit: async () => ({
        entries: [
          {
            id: 'audit-a',
            action: 'publication.approved',
            resourceType: 'publication',
            resourceId: 'publication-a',
            actorUserId: 'user-a',
            metadata: { decision: 'approve' },
            createdAt: '2026-08-08T00:00:00.000Z',
          },
        ],
      }),
      metrics: async () => ({
        range: { from: '2026-07-08T00:00:00.000Z', to: '2026-08-08T00:00:00.000Z' },
        productEvents: { 'capability.installed': 12 },
        publicationFunnel: { in_review: 1, published: 8 },
        installationOutcomes: { installed: 12, failed: 1 },
        activeDevices: 7,
      }),
      sessions: async () => [
        {
          id: 'session-a',
          deviceName: 'Chrome on macOS',
          current: true,
          createdAt: '2026-08-01T00:00:00.000Z',
          lastSeenAt: '2026-08-08T00:00:00.000Z',
        },
      ],
      revokeSession: async () => undefined,
      deadLetters: async () => [],
    };
    Object.defineProperty(window, '__CAPAPORT_WEB_E2E__', { value: { client, sessionStore } });
  });
}

test('admin invitation and space management', async ({ page }) => {
  await injectConsole(page);
  await page.goto('/');
  await page.screenshot({ path: '/tmp/capaport-web-dashboard.png', fullPage: true });
  await page.getByRole('button', { name: '成员与邀请' }).click();
  await page.getByLabel('邀请邮箱或手机号').fill('new@example.com');
  await page.getByLabel('组织角色').selectOption('auditor');
  await page.getByRole('button', { name: '发送邀请' }).click();
  await expect(page.getByRole('status')).toContainText('邀请已发送');
  await page.getByRole('button', { name: '空间与策略' }).click();
  await page.getByRole('button', { name: '新建空间' }).click();
  await page.getByLabel('空间名称').fill('Agent 平台组');
  await page.getByLabel('英文标识').fill('agent-platform');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Agent 平台组' })).toBeVisible();
});

test('organization review and version withdrawal', async ({ page }) => {
  await injectConsole(page);
  await page.goto('/');
  await page.getByRole('button', { name: '审核中心' }).click();
  await page.getByRole('button', { name: /发布护航/ }).click();
  await expect(page.getByText(/"status":"passed"/)).toBeVisible();
  await page.getByRole('button', { name: '批准发布' }).click();
  await expect(page.getByRole('heading', { name: '暂无待审核发布' })).toBeVisible();
  await page.getByRole('button', { name: '能力市场' }).click();
  await page.getByRole('button', { name: /发布护航/ }).click();
  await page.getByRole('button', { name: '撤回' }).click();
  await expect(page.getByText('withdrawn')).toBeVisible();
});

test('audit inspection, metrics dashboard, and responsive navigation', async ({ page }) => {
  await injectConsole(page);
  await page.goto('/');
  await page.getByRole('button', { name: '审计日志' }).click();
  await expect(page.getByText('publication.approved')).toBeVisible();
  await page.getByRole('button', { name: '采用分析' }).click();
  await expect(page.getByText('92%')).toBeVisible();
  await page.setViewportSize({ width: 720, height: 900 });
  await page.getByRole('button', { name: '打开导航' }).click();
  await expect(page.getByRole('navigation', { name: '管理后台导航' })).toBeVisible();
});
