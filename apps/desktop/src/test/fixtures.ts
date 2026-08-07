import type { CloudClient, LocalClient } from '../app/types';

export function cloudFixture(
  options: { online?: boolean; loginError?: string; installed?: boolean; updateAvailable?: boolean } = {},
): CloudClient {
  const online = options.online ?? true;
  return {
    isOnline: () => online,
    login: async () => {
      if (options.loginError) throw new Error(options.loginError);
      return { accessToken: 'token', refreshToken: 'refresh', expiresIn: 900 };
    },
    me: async () => ({ id: 'user-a', displayName: '林默', identities: [] }),
    organizations: async () => [
      { id: 'org-a', name: '组织 A', slug: 'org-a', role: 'owner', status: 'active' },
      { id: 'org-b', name: '组织 B', slug: 'org-b', role: 'member', status: 'active' },
    ],
    switchOrganization: async (_session, organizationId) => ({
      organizationId,
      membershipId: `member-${organizationId}`,
      organizationRole: 'member',
    }),
    spaces: async () => [
      {
        id: 'space-a',
        organizationId: 'org-a',
        type: 'personal',
        name: '个人空间',
        slug: 'personal',
        reviewPolicy: 'direct',
        status: 'active',
      },
    ],
    capabilities: async (_session, organizationId) => [
      {
        id: `cap-${organizationId}`,
        organizationId,
        spaceId: 'space-a',
        slug: 'release-helper',
        name: organizationId === 'org-a' ? '组织 A 能力' : '组织 B 能力',
        description: '发布检查与变更摘要',
        tags: ['release'],
        compatibility: ['codex'],
        ownerUserId: 'user-a',
        status: 'active',
      },
    ],
    publications: async () => [],
    installations: async () =>
      options.installed
        ? [
            {
              id: 'installation-a',
              deviceId: 'device-a',
              capabilityId: 'cap-org-a',
              versionId: 'version-a',
              agent: 'codex',
              status: 'installed',
              updatedAt: new Date(0).toISOString(),
            },
          ]
        : [],
    updateCheck: async () =>
      options.updateAvailable
        ? {
            action: 'update',
            currentVersionId: 'version-a',
            availableVersionId: 'version-b',
            availableVersion: '1.1.0',
          }
        : { action: 'none', currentVersionId: 'version-a' },
    createInstallPlan: async () => ({
      capabilityId: 'cap-org-a',
      versionId: 'version-a',
      version: '1.0.0',
      digest: 'a'.repeat(64),
      adapter: 'codex',
      permissions: { filesystem: 'write-project', network: 'none' },
      download: { url: 'https://example.test/artifact.zip', expiresIn: 60 },
    }),
    createCapabilityDraft: async () => ({ capabilityId: 'cap-a', draftId: 'draft-a' }),
    submitPublication: async () => ({ publicationId: 'publication-a' }),
    reportInstallation: async () => undefined,
  };
}

export function localFixture(
  options: { blockedScan?: boolean; installConflict?: boolean; pendingRetries?: number } = {},
): LocalClient {
  return {
    detectAgents: async () => [
      { adapterId: 'codex', displayName: 'Codex', scope: 'user', rootPath: '[authorized-root]' },
    ],
    inventoryAgent: async () => [
      { slug: 'release-helper', componentType: 'skill', relativePath: 'skills/release-helper', digest: 'b'.repeat(64) },
    ],
    scanLocalPackage: async () => ({
      files: 3,
      bytes: 420,
      findings: options.blockedScan ? [{ rule: 'potential-secret', severity: 'high', relativePath: '.env' }] : [],
      blocked: Boolean(options.blockedScan),
    }),
    exportLocalPackage: async ({ slug }) => ({
      fileName: `${slug}.zip`,
      sizeBytes: 8,
      sha256: 'd'.repeat(64),
      archiveBase64: 'UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==',
    }),
    previewInstall: async (plan) => ({
      transactionId: plan.transactionId,
      conflicts: options.installConflict ? 1 : 0,
      changes: [
        {
          relativePath: 'rules/security.md',
          kind: options.installConflict ? 'conflict' : 'create',
          afterDigest: 'c'.repeat(64),
        },
      ],
    }),
    applyInstall: async (plan) => ({ transactionId: plan.transactionId, changedFiles: 1, state: 'applied' }),
    rollbackInstall: async (transactionId) => ({ transactionId, changedFiles: 1, state: 'rolled_back' }),
    bindProjectDirectory: async () => 'bound',
    syncQueueStatus: async () => ({ pending: options.pendingRetries ?? 0, failed: 0 }),
  };
}
