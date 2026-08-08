import type { OrganizationRole } from '@capaport/contracts/organizations';
import { AppError } from '../../platform/errors/app-error.js';

export function canChangeMemberRole(
  actorRole: OrganizationRole,
  targetRole: OrganizationRole,
  desiredRole: OrganizationRole,
): boolean {
  if (targetRole === 'owner' || desiredRole === 'owner') return false;
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') return targetRole !== 'admin';
  return false;
}

export function canRemoveMember(actorRole: OrganizationRole, targetRole: OrganizationRole): boolean {
  if (targetRole === 'owner') return false;
  if (actorRole === 'owner') return true;
  return actorRole === 'admin' && targetRole !== 'admin';
}

export function requireAnotherOwner(memberRole: OrganizationRole, ownerCount: number): void {
  if (memberRole === 'owner' && ownerCount <= 1) {
    throw new AppError('ORGANIZATION_LAST_OWNER', 'The last owner must transfer ownership before leaving.', 409);
  }
}

export function canManageOrganization(role: OrganizationRole): boolean {
  return role === 'owner' || role === 'admin';
}
