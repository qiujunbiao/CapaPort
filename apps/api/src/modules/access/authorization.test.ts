import { describe, expect, it } from 'vitest';
import { type AuthorizationAction, type AuthorizationSubject, authorize } from './authorization.js';

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

const baseSubject: AuthorizationSubject = {
  userId: 'user-a',
  organizationId: 'org-a',
  organizationRole: 'member',
  organizationMembershipStatus: 'active',
};

const resource = { organizationId: 'org-a', type: 'team' as const };

describe('space authorization matrix', () => {
  it.each([
    ['manager', actions],
    ['reviewer', ['space:view', 'content:view-published', 'content:view-private', 'content:review', 'content:install']],
    [
      'contributor',
      [
        'space:view',
        'content:view-published',
        'content:view-private',
        'content:create',
        'content:edit',
        'content:submit',
        'content:install',
      ],
    ],
    ['viewer', ['space:view', 'content:view-published', 'content:install']],
  ] as const)('grants only the %s role actions', (role, allowed) => {
    for (const action of actions) {
      expect(
        authorize({ ...baseSubject, spaceMembershipRole: role, spaceMembershipStatus: 'active' }, action, resource)
          .allowed,
        action,
      ).toBe(allowed.includes(action as never));
    }
  });

  it.each(['owner', 'admin'] as const)('allows organization %s to govern non-personal spaces', (organizationRole) => {
    const subject = { ...baseSubject, organizationRole };
    for (const action of [
      'space:view',
      'space:update',
      'space:archive',
      'space:manage-members',
      'space:update-review-policy',
      'content:view-private',
      'content:review',
    ] as const) {
      expect(authorize(subject, action, resource).allowed, action).toBe(true);
    }
  });

  it('keeps personal spaces private even from organization owners and admins', () => {
    const personal = { organizationId: 'org-a', type: 'personal' as const, ownerUserId: 'user-b' };
    for (const organizationRole of ['owner', 'admin'] as const) {
      for (const action of actions) {
        expect(authorize({ ...baseSubject, organizationRole }, action, personal).allowed, action).toBe(false);
      }
    }
    expect(authorize(baseSubject, 'content:view-private', { ...personal, ownerUserId: 'user-a' }).allowed).toBe(true);
  });

  it('grants every active organization member published access to the organization space', () => {
    const organizationSpace = { organizationId: 'org-a', type: 'organization' as const };
    for (const organizationRole of ['owner', 'admin', 'auditor', 'member'] as const) {
      const subject = { ...baseSubject, organizationRole };
      expect(authorize(subject, 'space:view', organizationSpace).allowed).toBe(true);
      expect(authorize(subject, 'content:view-published', organizationSpace).allowed).toBe(true);
      expect(authorize(subject, 'content:install', organizationSpace).allowed).toBe(true);
    }
  });

  it('denies foreign tenants and disabled memberships before role evaluation', () => {
    expect(authorize(baseSubject, 'space:view', { ...resource, organizationId: 'org-b' })).toMatchObject({
      allowed: false,
      code: 'ACCESS_DENIED',
    });
    expect(
      authorize({ ...baseSubject, organizationMembershipStatus: 'disabled' }, 'space:view', resource),
    ).toMatchObject({ allowed: false, code: 'ACCESS_DENIED' });
    expect(
      authorize(
        { ...baseSubject, spaceMembershipRole: 'manager', spaceMembershipStatus: 'disabled' },
        'space:update',
        resource,
      ),
    ).toMatchObject({ allowed: false, code: 'ACCESS_DENIED' });
  });
});
