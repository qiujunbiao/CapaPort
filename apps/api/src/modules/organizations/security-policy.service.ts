import type { OrganizationSecurityPolicy, TenantContext } from '@capaport/contracts/organizations';
import { Inject, Injectable } from '@nestjs/common';
import { defaultScanPolicy, type ScanPolicy } from '@capaport/security-scan';
import { AppError } from '../../platform/errors/app-error.js';

export const defaultOrganizationSecurityPolicy: OrganizationSecurityPolicy = {
  blockedSeverities: ['high', 'critical'],
  confirmationSeverities: ['medium'],
  blockedTerms: [],
  allowedExecutablePaths: [],
  allowedNetworkHosts: [],
  executablePolicy: 'confirm',
};

export interface OrganizationSecurityPolicyStore {
  find(organizationId: string): Promise<OrganizationSecurityPolicy | undefined>;
  upsert(
    organizationId: string,
    actorMembershipId: string,
    policy: OrganizationSecurityPolicy,
  ): Promise<OrganizationSecurityPolicy>;
}

@Injectable()
export class SecurityPolicyService {
  constructor(@Inject('ORGANIZATION_SECURITY_POLICY_STORE') private readonly store: OrganizationSecurityPolicyStore) {}

  async get(context: TenantContext): Promise<OrganizationSecurityPolicy> {
    return (await this.store.find(context.organizationId)) ?? defaultOrganizationSecurityPolicy;
  }

  async policyForOrganization(organizationId: string): Promise<OrganizationSecurityPolicy> {
    return (await this.store.find(organizationId)) ?? defaultOrganizationSecurityPolicy;
  }

  async scanPolicyForOrganization(organizationId: string): Promise<ScanPolicy> {
    return { ...defaultScanPolicy, ...(await this.policyForOrganization(organizationId)) };
  }

  async update(context: TenantContext, policy: OrganizationSecurityPolicy): Promise<OrganizationSecurityPolicy> {
    if (context.organizationRole !== 'owner' && context.organizationRole !== 'admin') {
      throw new AppError('ACCESS_DENIED', 'Organization administration access is required.', 403);
    }
    return this.store.upsert(context.organizationId, context.membershipId, policy);
  }
}
