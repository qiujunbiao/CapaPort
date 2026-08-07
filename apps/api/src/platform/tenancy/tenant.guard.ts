import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../modules/identity/auth.guard.js';
import { AppError } from '../errors/app-error.js';
import { TenantContextService } from './tenant-context.service.js';

export type TenantRequest = AuthenticatedRequest & {
  params?: { organizationId?: string };
  headers: AuthenticatedRequest['headers'] & { 'x-organization-id'?: string | string[] };
  tenant?: Awaited<ReturnType<TenantContextService['resolve']>>;
};

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(@Inject(TenantContextService) private readonly tenants: TenantContextService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const auth = request.auth;
    if (!auth) throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
    const routeOrganizationId = request.params?.organizationId;
    const headerValue = request.headers['x-organization-id'];
    const headerOrganizationId = typeof headerValue === 'string' ? headerValue : undefined;
    if (routeOrganizationId && headerOrganizationId && routeOrganizationId !== headerOrganizationId) {
      throw new AppError('TENANT_MISMATCH', 'The selected organization does not match the requested resource.', 403);
    }
    request.tenant = await this.tenants.resolve(
      auth.userId,
      auth.sessionId,
      routeOrganizationId ?? headerOrganizationId,
    );
    return true;
  }
}
