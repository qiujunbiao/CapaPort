import type { OrganizationRole, TenantContext } from '@agentdoor/contracts/organizations';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../errors/app-error.js';

export type TenantMembership = {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
};

export interface TenantStore {
  currentOrganizationId(sessionId: string, userId: string): Promise<string | undefined>;
  findActiveMembership(organizationId: string, userId: string): Promise<TenantMembership | undefined>;
  setCurrentOrganization(sessionId: string, userId: string, organizationId: string): Promise<void>;
}

@Injectable()
export class TenantContextService {
  constructor(@Inject('TENANT_STORE') private readonly store: TenantStore) {}

  async resolve(userId: string, sessionId: string, requestedOrganizationId?: string): Promise<TenantContext> {
    const organizationId = requestedOrganizationId ?? (await this.store.currentOrganizationId(sessionId, userId));
    if (!organizationId) throw new AppError('TENANT_REQUIRED', 'Select an organization before continuing.', 400);
    const membership = await this.store.findActiveMembership(organizationId, userId);
    if (!membership) throw new AppError('TENANT_ACCESS_DENIED', 'You do not have access to this organization.', 403);
    return {
      organizationId: membership.organizationId,
      membershipId: membership.id,
      organizationRole: membership.role,
    };
  }

  async switch(userId: string, sessionId: string, organizationId: string): Promise<TenantContext> {
    const context = await this.resolve(userId, sessionId, organizationId);
    await this.store.setCurrentOrganization(sessionId, userId, organizationId);
    return context;
  }
}
