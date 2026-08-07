import { describe, expect, it, vi } from 'vitest';
import {
  type AuthorizationAction,
  type AuthorizationSubject,
  authorize,
} from '../../apps/api/src/modules/access/authorization.js';
import { SpaceService } from '../../apps/api/src/modules/access/space.service.js';
import {
  organizationRoles,
  resourceEndpoints,
  resources,
  spaceRoles,
  spaces,
  users,
} from '../fixtures/security-fixtures.js';

const actions: AuthorizationAction[] = [
  'space:view',
  'space:update',
  'space:archive',
  'space:manage-members',
  'space:update-review-policy',
  'content:view-published',
  'content:view-private',
  'content:create',
  'content:edit',
  'content:submit',
  'content:review',
  'content:install',
];

describe('full tenant resource matrix', () => {
  it('covers every organization role, space role, space type, lifecycle fixture, and resource endpoint', () => {
    expect(organizationRoles).toHaveLength(4);
    expect(spaceRoles).toHaveLength(4);
    expect(spaces.map((space) => space.type).sort()).toEqual(['organization', 'personal', 'project', 'team']);
    expect(resources.map((resource) => resource.kind)).toEqual(
      expect.arrayContaining(['version-published', 'version-private', 'version-withdrawn', 'project-context']),
    );
    expect(resourceEndpoints).toHaveLength(8);
  });

  it('denies every action before role evaluation when the resource belongs to another organization', () => {
    for (const organizationRole of organizationRoles) {
      for (const spaceMembershipRole of spaceRoles) {
        const subject: AuthorizationSubject = {
          userId: users.foreign.id,
          organizationId: 'org-b',
          organizationRole,
          organizationMembershipStatus: 'active',
          spaceMembershipRole,
          spaceMembershipStatus: 'active',
        };
        for (const space of spaces) {
          for (const action of actions) {
            expect(
              authorize(subject, action, space),
              `${organizationRole}/${spaceMembershipRole}/${space.type}/${action}`,
            ).toMatchObject({ allowed: false, code: 'ACCESS_DENIED' });
          }
        }
      }
    }
  });

  it('returns the same public denial for guessed, personal, and foreign space IDs', async () => {
    const store = { findSpaceAccess: vi.fn().mockResolvedValue(undefined) };
    const service = new SpaceService(store as never);
    const tenant = { organizationId: 'org-a', membershipId: 'member-a', organizationRole: 'owner' as const };
    const denials: Array<{ code?: string; message?: string; status?: number }> = [];
    for (const spaceId of ['missing', 'personal-b', 'foreign-org-space']) {
      try {
        await service.authorize(tenant, users.owner.id, spaceId, 'space:view');
      } catch (error) {
        denials.push(error as { code?: string; message?: string; status?: number });
      }
    }
    expect(denials).toHaveLength(3);
    expect(
      new Set(denials.map(({ code, message, status }) => JSON.stringify({ code, message, status }))),
    ).toHaveProperty('size', 1);
    expect(store.findSpaceAccess).toHaveBeenCalledTimes(3);
    expect(store.findSpaceAccess.mock.calls.every(([organizationId]) => organizationId === 'org-a')).toBe(true);
  });
});
