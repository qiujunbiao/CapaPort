import { type CanActivate, type ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../../platform/errors/app-error.js';
import type { TenantRequest } from '../../platform/tenancy/tenant.guard.js';
import type { AuthorizationAction } from './authorization.js';
import { type AuthorizedSpaceContext, SpaceService } from './space.service.js';

const SPACE_ACTION = 'capaport:space-action';

export const RequireSpaceAction = (action: AuthorizationAction) => SetMetadata(SPACE_ACTION, action);

export type SpaceRequest = TenantRequest & {
  params?: { organizationId?: string; spaceId?: string };
  spaceAccess?: AuthorizedSpaceContext;
};

@Injectable()
export class SpaceAccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SpaceService) private readonly spaces: SpaceService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.getAllAndOverride<AuthorizationAction>(SPACE_ACTION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!action) throw new AppError('ACCESS_POLICY_MISSING', 'Space authorization policy is missing.', 500);
    const request = context.switchToHttp().getRequest<SpaceRequest>();
    const userId = request.auth?.userId;
    const tenant = request.tenant;
    const spaceId = request.params?.spaceId;
    if (!userId) throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
    if (!tenant) throw new AppError('TENANT_REQUIRED', 'Select an organization before continuing.', 400);
    if (!spaceId) throw new AppError('VALIDATION_ERROR', 'Space identifier is required.', 400);
    request.spaceAccess = await this.spaces.authorize(tenant, userId, spaceId, action);
    return true;
  }
}
