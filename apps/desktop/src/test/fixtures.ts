import { buildArchive } from '@capaport/capability-kit';
import type { CloudClient, LocalClient } from '../app/types';

function returnedDraftArchive(): Uint8Array {
  const encode = (content: string) => new TextEncoder().encode(content);
  return buildArchive([
    { path: 'README.md', content: encode('# 组织 A 能力') },
    {
      path: 'capaport.yaml',
      content: encode(`schemaVersion: capaport.io/v1alpha1
kind: CapabilityPackage
metadata:
  slug: release-helper
  name: 组织 A 能力
  description: 发布检查与变更摘要
  tags: [release]
spec:
  components:
    - type: skill
      path: skills/release-helper
  compatibility:
    agents: [codex]
  permissions:
    filesystem: read-project
    network: none
  entrypoints:
    default: skills/release-helper/SKILL.md
  dependencies: []
`),
    },
    { path: 'skills/release-helper/SKILL.md', content: encode('# Existing skill') },
  ]);
}

export function cloudFixture(
  options: {
    online?: boolean;
    loginError?: string;
    installed?: boolean;
    updateAvailable?: boolean;
    includeClaudeOnly?: boolean;
    changesRequested?: boolean;
  } = {},
): CloudClient {
  const online = options.online ?? true;
  let notificationReadAt: string | null = null;
  return {
    isOnline: () => online,
    logout: async () => undefined,
    login: async () => {
      if (options.loginError) throw new Error(options.loginError);
      return { accessToken: 'token', refreshToken: 'refresh', expiresIn: 900 };
    },
    startRecovery: async () => ({
      challengeId: '11111111-1111-4111-8111-111111111111',
      maskedTarget: 'p***@example.com',
    }),
    completeRecovery: async () => ({ recovered: true }),
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
      {
        id: 'space-org',
        organizationId: 'org-a',
        type: 'organization',
        name: '组织空间',
        slug: 'organization',
        reviewPolicy: 'required',
        status: 'active',
      },
    ],
    securityPolicy: async () => ({
      blockedSeverities: ['high', 'critical'],
      confirmationSeverities: ['medium'],
      blockedTerms: [],
      allowedExecutablePaths: [],
      allowedNetworkHosts: [],
      executablePolicy: 'confirm',
    }),
    updateSecurityPolicy: async (_session, _organizationId, policy) => policy,
    members: async () => [
      {
        id: 'member-a',
        userId: 'user-a',
        displayName: '林默',
        role: 'owner',
        status: 'active',
        joinedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'member-b',
        userId: 'user-b',
        displayName: '陈夏',
        role: 'member',
        status: 'active',
        joinedAt: '2026-01-02T00:00:00.000Z',
      },
    ],
    invitations: async () => [],
    invite: async () => undefined,
    revokeInvitation: async () => undefined,
    changeMemberRole: async () => undefined,
    removeMember: async () => undefined,
    createSpace: async (_session, organizationId, input) => ({
      id: 'space-new',
      organizationId,
      status: 'active',
      ...input,
    }),
    updateSpacePolicy: async () => undefined,
    archiveSpace: async () => undefined,
    spaceMembers: async () => [],
    addSpaceMember: async () => undefined,
    changeSpaceMemberRole: async () => undefined,
    removeSpaceMember: async () => undefined,
    recordAnalyticsEvent: async () => undefined,
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
        hasPublishedVersion: true,
      },
      ...(options.includeClaudeOnly
        ? [
            {
              id: 'cap-claude',
              organizationId,
              spaceId: 'space-a',
              slug: 'claude-only',
              name: 'Claude 专用能力',
              description: '只安装到 Claude Code',
              tags: ['claude'],
              compatibility: ['claude-code' as const],
              ownerUserId: 'user-a',
              status: 'active' as const,
              hasPublishedVersion: true,
            },
          ]
        : []),
    ],
    publications: async () =>
      options.changesRequested
        ? [
            {
              id: 'publication-returned',
              organizationId: 'org-a',
              capabilityId: 'cap-org-a',
              sourceSpaceId: 'space-a',
              sourceRevisionId: 'revision-returned',
              targetSpaceId: 'space-org',
              candidateDigest: 'c'.repeat(64),
              version: '1.0.0',
              status: 'changes_requested' as const,
              submittedByUserId: 'user-a',
              createdAt: '2026-08-08T00:00:00.000Z',
              resolvedAt: '2026-08-08T00:01:00.000Z',
            },
          ]
        : [],
    publicationDetails: async (_session, organizationId, publicationId) => ({
      id: publicationId,
      organizationId,
      capabilityId: 'cap-org-a',
      sourceSpaceId: 'space-a',
      sourceRevisionId: 'revision-a',
      targetSpaceId: 'space-org',
      candidateDigest: 'c'.repeat(64),
      version: '1.0.0',
      status: 'in_review',
      submittedByUserId: 'user-a',
      createdAt: '2026-08-08T00:00:00.000Z',
      reviews: [],
    }),
    scanReport: async () => ({ status: 'passed', findings: [] }),
    publicationDiff: async () => ({
      fromVersionId: 'version-old',
      candidateDigest: 'c'.repeat(64),
      added: ['skills/release-helper/SKILL.md'],
      modified: ['README.md'],
      removed: [],
      recommendedChange: 'minor',
    }),
    withdrawPublication: async () => undefined,
    reviewPublication: async (_session, organizationId, publicationId) => ({
      id: publicationId,
      organizationId,
      capabilityId: 'cap-org-a',
      sourceSpaceId: 'space-a',
      sourceRevisionId: 'revision-a',
      targetSpaceId: 'space-org',
      candidateDigest: 'c'.repeat(64),
      version: '1.0.0',
      status: 'published',
      submittedByUserId: 'user-a',
      publishedVersionId: 'version-a',
      createdAt: '2026-08-08T00:00:00.000Z',
      resolvedAt: '2026-08-08T00:01:00.000Z',
    }),
    updateCapability: async (_session, organizationId, capabilityId, input) => ({
      id: capabilityId,
      organizationId,
      spaceId: 'space-a',
      slug: 'release-helper',
      name: input.name ?? '组织 A 能力',
      description: input.description ?? '发布检查与变更摘要',
      tags: input.tags ?? ['release'],
      compatibility: input.compatibility ?? ['codex'],
      ownerUserId: 'user-a',
      status: 'active',
      hasPublishedVersion: true,
    }),
    versions: async (_session, organizationId, capabilityId) => [
      {
        id: 'version-a',
        organizationId,
        capabilityId,
        spaceId: 'space-org',
        version: '1.0.0',
        contentDigest: 'b'.repeat(64),
        status: 'published',
        publishedAt: '2026-08-08T00:00:00.000Z',
      },
    ],
    versionDiff: async () => ({
      fromVersionId: 'version-old',
      toVersionId: 'version-a',
      added: ['skills/release-helper/SKILL.md'],
      modified: ['README.md'],
      removed: [],
      recommendedChange: 'minor',
    }),
    transitionVersion: async () => undefined,
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
      productEvents: { 'capability.installed': 4 },
      publicationFunnel: { published: 3 },
      installationOutcomes: { installed: 4 },
      activeDevices: 3,
    }),
    sessions: async () => [
      {
        id: 'session-a',
        deviceName: 'CapaPort Desktop',
        current: true,
        createdAt: '2026-08-01T00:00:00.000Z',
        lastSeenAt: '2026-08-08T00:00:00.000Z',
      },
    ],
    revokeSession: async () => undefined,
    deadLetters: async () => [],
    retryDeadLetter: async () => undefined,
    exportOrganization: async () => ({ schemaVersion: 1 }),
    closeOrganization: async (_session, organizationId, confirmation) => ({
      id: organizationId,
      name: confirmation,
      slug: 'org-a',
      role: 'owner',
      status: 'closing',
    }),
    cancelOrganizationClosure: async (_session, organizationId) => ({
      id: organizationId,
      name: '组织 A',
      slug: 'org-a',
      role: 'owner',
      status: 'active',
    }),
    transferOwnership: async () => undefined,
    leaveOrganization: async () => undefined,
    exportAccount: async () => ({ schemaVersion: 1 }),
    requestAccountDeletion: async () => ({ deletionScheduledAt: '2026-09-07T00:00:00.000Z' }),
    cancelAccountDeletion: async () => ({ cancelled: true }),
    accountDeletionStatus: async () => ({ status: 'none' }),
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
    notifications: async () => ({
      notifications: [
        {
          id: 'notification-a',
          type: 'publication.approved',
          title: '发布已通过',
          body: '能力包已发布到组织空间。',
          data: {},
          readAt: notificationReadAt,
          createdAt: '2026-08-08T00:00:00.000Z',
        },
      ],
      unreadCount: notificationReadAt ? 0 : 1,
    }),
    markNotificationRead: async () => {
      notificationReadAt = '2026-08-08T00:01:00.000Z';
    },
    createInstallPlan: async () => ({
      capabilityId: 'cap-org-a',
      versionId: 'version-a',
      version: '1.0.0',
      digest: 'a'.repeat(64),
      adapter: 'codex',
      permissions: { filesystem: 'write-project', network: 'none' },
      download: { url: 'https://example.test/artifact.zip', expiresIn: 60 },
    }),
    createCapabilityDraft: async () => ({
      capabilityId: 'cap-a',
      draftId: 'draft-a',
      revisionId: 'revision-a',
      sequence: 1,
      riskFindingDigests: [],
    }),
    createCapabilityRevisionDraft: async () => ({ id: 'draft-b', capabilityId: 'cap-a', status: 'draft' }),
    saveCapabilityRevision: async () => ({
      revisionId: 'revision-b',
      sequence: 2,
      blocked: false,
      riskFindingDigests: [],
    }),
    capabilityDrafts: async () =>
      options.changesRequested
        ? [
            {
              id: 'draft-returned',
              capabilityId: 'cap-org-a',
              status: 'ready' as const,
              currentRevisionId: 'revision-returned',
            },
          ]
        : [],
    draftRevisions: async () =>
      options.changesRequested
        ? [
            {
              id: 'revision-returned',
              sequence: 1,
              contentDigest: 'c'.repeat(64),
              scanStatus: 'passed' as const,
              riskFindingDigests: [],
              createdAt: '2026-08-08T00:00:00.000Z',
            },
          ]
        : [],
    downloadDraftRevision: async () => returnedDraftArchive(),
    submitPublication: async () => ({ publicationId: 'publication-a' }),
    reportInstallation: async () => undefined,
    createProjectBinding: async (input) => ({
      id: 'binding-cloud-a',
      organizationId: input.organizationId,
      projectSpaceId: input.spaceId,
      deviceId: input.deviceId,
      localBindingId: input.localBindingId,
      agents: input.agents,
      status: 'active',
      createdAt: new Date(0).toISOString(),
    }),
    projectBindings: async () => [],
    syncProjectContext: async (input) => ({
      id: 'context-a',
      organizationId: input.organizationId,
      projectSpaceId: input.spaceId,
      bindingId: input.bindingId,
      deviceId: 'device-a',
      artifactId: 'artifact-a',
      digest: input.context.digest,
      selectionDigest: input.context.selectionDigest,
      fileCount: input.context.fileCount,
      totalBytes: input.context.totalBytes,
      agents: input.context.agents,
      scanEngineVersion: input.context.scanEngineVersion,
      createdAt: new Date(0).toISOString(),
    }),
  };
}

export function localFixture(
  options: { blockedScan?: boolean; installConflict?: boolean; pendingRetries?: number; failedRetries?: number } = {},
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
      findings: options.blockedScan
        ? [{ rule: 'potential-secret', severity: 'high', relativePath: '.env', evidenceDigest: 'a'.repeat(64) }]
        : [],
      blocked: Boolean(options.blockedScan),
      requiresConfirmation: false,
    }),
    readManagedFile: async () => ({
      contentBase64: btoa('# Local managed content'),
      digest: 'e'.repeat(64),
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
    loadInstallLock: async () => undefined,
    uninstall: async () => ({ transactionId: 'uninstall-a', changedFiles: 1, state: 'uninstalled' }),
    bindProjectDirectory: async (input) => ({
      localBindingId: '11111111-1111-4111-8111-111111111111',
      spaceId: input.spaceId,
      localPath: input.path,
      agents: input.agents ?? ['codex'],
      status: 'active',
      createdAt: '0001',
    }),
    listProjectBindings: async () => [],
    removeProjectBinding: async () => undefined,
    inventoryProjectContext: async (localBindingId) => ({
      localBindingId,
      status: 'active',
      entries: [{ relativePath: 'README.md', sizeBytes: 20, eligible: true }],
      eligibleFiles: 1,
      eligibleBytes: 20,
      ignored: [],
    }),
    exportProjectContext: async (input) => ({
      digest: 'e'.repeat(64),
      selectionDigest: 'f'.repeat(64),
      fileCount: input.selectedPaths.length,
      totalBytes: 20,
      agents: input.agents,
      scanEngineVersion: 'project-context-1.0.0',
      scannedAt: new Date().toISOString(),
      archiveBase64: 'UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==',
    }),
    projectContextPlan: async (input) => ({
      transactionId: 'project-tx',
      adapterId: input.adapterId,
      capabilitySlug: 'project-context',
      packageDigest: 'e'.repeat(64),
      rootPath: input.rootPath,
      writes: [],
    }),
    syncQueueStatus: async () => ({ pending: options.pendingRetries ?? 0, failed: options.failedRetries ?? 0 }),
    enqueueWrite: async () => undefined,
    claimReadyWrites: async () => [],
    completeWrite: async () => undefined,
    rescheduleWrite: async () => undefined,
    retryFailedWrites: async () => undefined,
  };
}
