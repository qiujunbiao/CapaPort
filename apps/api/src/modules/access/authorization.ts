import type { OrganizationRole } from '@capaport/contracts/organizations';
import type { SpaceRole, SpaceType } from '@capaport/contracts/spaces';

export type AuthorizationAction =
  | 'space:view'
  | 'space:update'
  | 'space:archive'
  | 'space:manage-members'
  | 'space:update-review-policy'
  | 'content:view-published'
  | 'content:view-private'
  | 'content:create'
  | 'content:edit'
  | 'content:submit'
  | 'content:review'
  | 'content:install';

export type AuthorizationSubject = {
  userId: string;
  organizationId: string;
  organizationRole: OrganizationRole;
  organizationMembershipStatus: 'active' | 'disabled' | 'left';
  spaceMembershipRole?: SpaceRole;
  spaceMembershipStatus?: 'active' | 'disabled';
};

export type AuthorizationResource = {
  organizationId: string;
  type: SpaceType;
  ownerUserId?: string;
  status?: 'active' | 'archived';
};

export type AuthorizationDecision = { allowed: true } | { allowed: false; code: 'ACCESS_DENIED'; reason: string };

const deny = (reason: string): AuthorizationDecision => ({ allowed: false, code: 'ACCESS_DENIED', reason });

const personalOwnerActions = new Set<AuthorizationAction>([
  'space:view',
  'space:update',
  'content:view-published',
  'content:view-private',
  'content:create',
  'content:edit',
  'content:submit',
  'content:install',
]);

const organizationMemberActions = new Set<AuthorizationAction>([
  'space:view',
  'content:view-published',
  'content:install',
]);

const organizationGovernorActions = new Set<AuthorizationAction>([
  'space:view',
  'space:update',
  'space:archive',
  'space:manage-members',
  'space:update-review-policy',
  'content:view-published',
  'content:view-private',
  'content:review',
  'content:install',
]);

const roleActions: Record<SpaceRole, ReadonlySet<AuthorizationAction>> = {
  manager: new Set([
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
  ]),
  reviewer: new Set([
    'space:view',
    'content:view-published',
    'content:view-private',
    'content:review',
    'content:install',
  ]),
  contributor: new Set([
    'space:view',
    'content:view-published',
    'content:view-private',
    'content:create',
    'content:edit',
    'content:submit',
    'content:install',
  ]),
  viewer: new Set(['space:view', 'content:view-published', 'content:install']),
};

export function authorize(
  subject: AuthorizationSubject,
  action: AuthorizationAction,
  resource: AuthorizationResource,
): AuthorizationDecision {
  if (subject.organizationMembershipStatus !== 'active') return deny('Organization membership is inactive.');
  if (subject.organizationId !== resource.organizationId) return deny('Resource belongs to another organization.');
  if (resource.status === 'archived' && action !== 'space:view') return deny('Space is archived.');

  if (resource.type === 'personal') {
    return resource.ownerUserId === subject.userId && personalOwnerActions.has(action)
      ? { allowed: true }
      : deny('Personal spaces are private to their owner.');
  }

  const governor = subject.organizationRole === 'owner' || subject.organizationRole === 'admin';
  if (governor && organizationGovernorActions.has(action)) {
    if (resource.type === 'organization' && action === 'space:update-review-policy') {
      return deny('Organization review is always required.');
    }
    return { allowed: true };
  }

  if (resource.type === 'organization' && organizationMemberActions.has(action)) return { allowed: true };

  if (
    subject.spaceMembershipStatus === 'active' &&
    subject.spaceMembershipRole &&
    roleActions[subject.spaceMembershipRole].has(action)
  ) {
    if (resource.type === 'organization' && action === 'space:update-review-policy') {
      return deny('Organization review is always required.');
    }
    return { allowed: true };
  }

  return deny('The requested action is outside the assigned organization and space roles.');
}
