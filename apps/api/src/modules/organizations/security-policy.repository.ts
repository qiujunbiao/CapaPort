import { randomUUID } from 'node:crypto';
import type { OrganizationSecurityPolicy } from '@agentdoor/contracts/organizations';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { auditLogs, organizationSecurityPolicies } from '../../db/schema/organizations.js';
import type { DatabaseService } from '../../platform/database/database.service.js';
import type { OrganizationSecurityPolicyStore } from './security-policy.service.js';

@Injectable()
export class SecurityPolicyRepository implements OrganizationSecurityPolicyStore {
  constructor(@Inject('DATABASE_SERVICE') private readonly database: DatabaseService) {}

  async find(organizationId: string): Promise<OrganizationSecurityPolicy | undefined> {
    const [row] = await this.database.db
      .select()
      .from(organizationSecurityPolicies)
      .where(eq(organizationSecurityPolicies.organizationId, organizationId))
      .limit(1);
    if (!row) return undefined;
    return this.toPolicy(row);
  }

  async upsert(
    organizationId: string,
    actorMembershipId: string,
    policy: OrganizationSecurityPolicy,
  ): Promise<OrganizationSecurityPolicy> {
    await this.database.transaction(async (transaction) => {
      await transaction
        .insert(organizationSecurityPolicies)
        .values({
          organizationId,
          ...policy,
          updatedByMembershipId: actorMembershipId,
        })
        .onConflictDoUpdate({
          target: organizationSecurityPolicies.organizationId,
          set: { ...policy, updatedByMembershipId: actorMembershipId, updatedAt: new Date() },
        });
      await transaction.insert(auditLogs).values({
        id: randomUUID(),
        organizationId,
        actorMembershipId,
        action: 'organization.security_policy_updated',
        resourceType: 'organization_security_policy',
        resourceId: organizationId,
        metadata: policy,
      });
    });
    return policy;
  }

  private toPolicy(row: typeof organizationSecurityPolicies.$inferSelect): OrganizationSecurityPolicy {
    return {
      blockedSeverities: row.blockedSeverities,
      confirmationSeverities: row.confirmationSeverities,
      blockedTerms: row.blockedTerms,
      allowedExecutablePaths: row.allowedExecutablePaths,
      allowedNetworkHosts: row.allowedNetworkHosts,
      executablePolicy: row.executablePolicy,
    };
  }
}
