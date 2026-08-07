import type { AuditQuery } from '@agentdoor/contracts/operations';
import type { TenantContext } from '@agentdoor/contracts/organizations';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../platform/errors/app-error.js';
import { redactAuditMetadata } from './audit.policy.js';

export type AuditRecord = {
  id: string;
  actorUserId?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export interface AuditDataStore {
  list(organizationId: string, query: AuditQuery): Promise<{ entries: AuditRecord[]; nextCursor?: string }>;
}

@Injectable()
export class AuditService {
  constructor(@Inject('AUDIT_DATA_STORE') private readonly repository: AuditDataStore) {}

  async list(tenant: TenantContext, query: AuditQuery) {
    if (!['owner', 'admin', 'auditor'].includes(tenant.organizationRole)) {
      throw new AppError('ACCESS_DENIED', 'Audit access is required.', 403);
    }
    const result = await this.repository.list(tenant.organizationId, query);
    return {
      ...result,
      entries: result.entries.map((entry) => ({
        ...entry,
        metadata: redactAuditMetadata(entry.metadata) as Record<string, unknown>,
      })),
    };
  }
}
