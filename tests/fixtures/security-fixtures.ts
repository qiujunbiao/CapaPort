import type { OrganizationRole } from '../../packages/contracts/src/organizations.js';
import type { SpaceRole, SpaceType } from '../../packages/contracts/src/spaces.js';

export const organizations = ['org-a', 'org-b'] as const;
export const organizationRoles = ['owner', 'admin', 'auditor', 'member'] as const satisfies readonly OrganizationRole[];
export const spaceRoles = ['manager', 'reviewer', 'contributor', 'viewer'] as const satisfies readonly SpaceRole[];
export const spaceTypes = ['personal', 'team', 'project', 'organization'] as const satisfies readonly SpaceType[];

export const users = {
  owner: { id: 'user-owner', organizationId: 'org-a', role: 'owner' },
  admin: { id: 'user-admin', organizationId: 'org-a', role: 'admin' },
  auditor: { id: 'user-auditor', organizationId: 'org-a', role: 'auditor' },
  member: { id: 'user-member', organizationId: 'org-a', role: 'member' },
  foreign: { id: 'user-foreign', organizationId: 'org-b', role: 'owner' },
} as const;

export const spaces = spaceTypes.map((type) => ({
  id: `space-${type}`,
  organizationId: 'org-a',
  type,
  ownerUserId: type === 'personal' ? users.member.id : undefined,
  status: 'active' as const,
}));

export const resources = [
  'capability',
  'draft',
  'version-published',
  'version-private',
  'version-withdrawn',
  'artifact',
  'publication',
  'installation',
  'project-context',
  'audit',
].map((kind) => ({ id: `${kind}-a`, kind, organizationId: 'org-a' as const }));

export const devices = [
  { id: 'device-a-macos', organizationId: 'org-a', userId: users.member.id, platform: 'macos' },
  { id: 'device-a-windows', organizationId: 'org-a', userId: users.member.id, platform: 'windows' },
  { id: 'device-b-linux', organizationId: 'org-b', userId: users.foreign.id, platform: 'linux' },
  { id: 'device-b-windows', organizationId: 'org-b', userId: users.foreign.id, platform: 'windows' },
] as const;

export const resourceEndpoints = [
  '/capabilities/:id',
  '/capabilities/:id/drafts',
  '/publications/:id',
  '/artifacts/:id',
  '/devices/:id',
  '/installations/:id/update-check',
  '/projects/:spaceId/contexts/:id',
  '/audit/:id',
] as const;
