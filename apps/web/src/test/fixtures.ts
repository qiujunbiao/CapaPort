import type { OrganizationRole, PublicationSummary } from '@agentdoor/contracts';
import type { WebClient } from '../app/types';

export function webFixture(options: { role?: OrganizationRole; publications?: PublicationSummary[] } = {}): WebClient {
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
  return {
    login: async () => ({ accessToken: 'token', refreshToken: 'refresh', expiresIn: 900 }),
    register: async () => ({ challengeId: 'challenge-a', maskedTarget: 'n***@example.com' }),
    verify: async () => ({ verified: true }),
    logout: async () => undefined,
    me: async () => ({ id: 'user-a', displayName: '林默', identities: [] }),
    organizations: async () => [{ id: 'org-a', name: '平台研发', slug: 'platform', role, status: 'active' }],
    createOrganization: async (input) => ({ id: 'org-new', ...input, role: 'owner', status: 'active' }),
    switchOrganization: async () => undefined,
    acceptInvitation: async () => ({ status: 'accepted', organizationId: 'org-a' }),
    updateOrganization: async () => undefined,
    members: async () => [
      {
        id: 'member-a',
        userId: 'user-a',
        displayName: '林默',
        role,
        status: 'active',
        joinedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    invitations: async () => [],
    invite: async () => undefined,
    revokeInvitation: async () => undefined,
    changeMemberRole: async () => undefined,
    removeMember: async () => undefined,
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
    ],
    createSpace: async (input) => ({ id: 'space-new', organizationId: 'org-a', status: 'active', ...input }),
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
    ],
    transitionVersion: async () => undefined,
    publications: async () => publications,
    publication: async (id) => {
      const publication = publications.find((item) => item.id === id) ?? publications[0];
      if (!publication) throw new Error('Publication fixture is missing.');
      return { ...publication, reviews: [] };
    },
    scanReport: async () => ({ status: 'passed', findings: [] }),
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
    deadLetters: async () => [],
  };
}
