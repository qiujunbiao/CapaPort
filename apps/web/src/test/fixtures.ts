import type { OrganizationRole, PublicationSummary } from '@capaport/contracts';
import type { SpaceMember, WebClient } from '../app/types';

export function webFixture(
  options: { role?: OrganizationRole; publications?: PublicationSummary[]; includeTeamSpace?: boolean } = {},
): WebClient {
  const role = options.role ?? 'owner';
  const publications = options.publications ?? [
    {
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
    },
  ];
  let teamMembers: SpaceMember[] = [
    {
      id: 'space-member-a',
      userId: 'user-a',
      displayName: '林默',
      role: 'manager' as const,
      status: 'active' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  let notificationReadAt: string | null = null;
  let capability = {
    id: 'cap-a',
    organizationId: 'org-a',
    spaceId: 'space-org',
    slug: 'release-helper',
    name: '发布护航',
    description: '发布检查与风险提示',
    tags: ['release'],
    compatibility: ['codex', 'claude-code'] as Array<'codex' | 'claude-code' | 'cursor' | 'gemini-cli'>,
    ownerUserId: 'user-a',
    status: 'active' as const,
  };
  return {
    login: async () => ({ accessToken: 'token', refreshToken: 'refresh', expiresIn: 900 }),
    register: async () => ({ challengeId: 'challenge-a', maskedTarget: 'n***@example.com' }),
    verify: async () => ({ verified: true }),
    startRecovery: async () => ({
      challengeId: '11111111-1111-4111-8111-111111111111',
      maskedTarget: 'p***@example.com',
    }),
    completeRecovery: async () => ({ recovered: true }),
    logout: async () => undefined,
    me: async () => ({ id: 'user-a', displayName: '林默', identities: [] }),
    organizations: async () => [{ id: 'org-a', name: '平台研发', slug: 'platform', role, status: 'active' }],
    createOrganization: async (input) => ({ id: 'org-new', ...input, role: 'owner', status: 'active' }),
    switchOrganization: async () => undefined,
    acceptInvitation: async () => ({ status: 'accepted', organizationId: 'org-a' }),
    updateOrganization: async () => undefined,
    exportOrganization: async () => ({ schemaVersion: 1 }),
    closeOrganization: async () => ({
      id: 'org-a',
      name: '平台研发',
      slug: 'platform',
      role,
      status: 'closing',
      deletionScheduledAt: '2026-09-07T00:00:00.000Z',
    }),
    cancelOrganizationClosure: async () => ({
      id: 'org-a',
      name: '平台研发',
      slug: 'platform',
      role,
      status: 'active',
    }),
    transferOwnership: async () => undefined,
    leaveOrganization: async () => undefined,
    exportAccount: async () => ({ schemaVersion: 1 }),
    requestAccountDeletion: async () => ({ deletionScheduledAt: '2026-09-07T00:00:00.000Z' }),
    cancelAccountDeletion: async () => ({ cancelled: true }),
    accountDeletionStatus: async () => ({ status: 'none' }),
    members: async () => [
      {
        id: 'member-a',
        userId: 'user-a',
        displayName: '林默',
        role,
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
    securityPolicy: async () => ({
      blockedSeverities: ['high', 'critical'],
      confirmationSeverities: ['medium'],
      blockedTerms: [],
      allowedExecutablePaths: [],
      allowedNetworkHosts: [],
      executablePolicy: 'confirm',
    }),
    updateSecurityPolicy: async (_organizationId, policy) => policy,
    spaces: async () => [
      {
        id: 'space-org',
        organizationId: 'org-a',
        type: 'organization',
        name: '组织空间',
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
      ...(options.includeTeamSpace
        ? [
            {
              id: 'space-team',
              organizationId: 'org-a',
              type: 'team' as const,
              name: '研发团队',
              slug: 'engineering',
              reviewPolicy: 'required' as const,
              status: 'active' as const,
              role: 'manager' as const,
            },
          ]
        : []),
    ],
    createSpace: async (input) => ({ id: 'space-new', organizationId: 'org-a', status: 'active', ...input }),
    updateSpacePolicy: async () => undefined,
    archiveSpace: async () => undefined,
    spaceMembers: async () => teamMembers,
    addSpaceMember: async (_spaceId, userId, role) => {
      teamMembers = [
        ...teamMembers,
        {
          id: 'space-member-b',
          userId,
          displayName: '陈夏',
          role,
          status: 'active',
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ];
    },
    changeSpaceMemberRole: async (_spaceId, membershipId, role) => {
      teamMembers = teamMembers.map((member) => (member.id === membershipId ? { ...member, role } : member));
    },
    removeSpaceMember: async (_spaceId, membershipId) => {
      teamMembers = teamMembers.filter((member) => member.id !== membershipId);
    },
    capabilities: async () => [capability],
    updateCapability: async (_capabilityId, input) => {
      capability = {
        ...capability,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.compatibility !== undefined ? { compatibility: input.compatibility } : {}),
      };
      return capability;
    },
    versions: async () => [
      {
        id: 'version-a',
        organizationId: 'org-a',
        capabilityId: 'cap-a',
        spaceId: 'space-org',
        version: '1.0.0',
        contentDigest: 'b'.repeat(64),
        status: 'published',
        publishedAt: '2026-08-08T00:00:00.000Z',
      },
      {
        id: 'version-old',
        organizationId: 'org-a',
        capabilityId: 'cap-a',
        spaceId: 'space-org',
        version: '0.9.0',
        contentDigest: 'a'.repeat(64),
        status: 'deprecated',
        publishedAt: '2026-08-01T00:00:00.000Z',
      },
    ],
    versionDiff: async () => ({
      fromVersionId: 'version-old',
      toVersionId: 'version-a',
      added: ['prompts/release-helper.md'],
      modified: ['skills/release-helper/SKILL.md'],
      removed: [],
      recommendedChange: 'minor',
    }),
    transitionVersion: async () => undefined,
    publications: async () => publications,
    publication: async (id) => {
      const publication = publications.find((item) => item.id === id) ?? publications[0];
      if (!publication) throw new Error('Publication fixture is missing.');
      return { ...publication, reviews: [] };
    },
    scanReport: async () => ({
      status: 'blocked',
      findings: [
        {
          ruleId: 'SEC_ORG_TERM',
          severity: 'high',
          path: 'skills/release/SKILL.md',
          message: 'Content matches an organization-restricted term.',
          blocking: true,
        },
      ],
    }),
    publicationDiff: async () => ({
      fromVersionId: 'version-old',
      candidateDigest: 'a'.repeat(64),
      added: ['skills/new.md'],
      modified: ['README.md'],
      removed: [],
      recommendedChange: 'minor',
    }),
    review: async () => undefined,
    withdrawPublication: async () => undefined,
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
      publicationFunnel: { in_review: 1, published: 3 },
      installationOutcomes: { installed: 4, failed: 1 },
      activeDevices: 3,
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
    deadLetters: async () => [],
    retryDeadLetter: async () => undefined,
  };
}
