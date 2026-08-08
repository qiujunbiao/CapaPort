import { createHmac, randomUUID } from 'node:crypto';
import type { MetricsQuery, ProductEvent } from '@capaport/contracts/operations';
import type { TenantContext } from '@capaport/contracts/organizations';
import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../../config/config.js';
import { APP_CONFIG } from '../../config/config.js';
import { AppError } from '../../platform/errors/app-error.js';

export interface AnalyticsDataStore {
  ingest(input: {
    id: string;
    organizationId: string;
    actorDigest: string;
    eventName: ProductEvent['eventName'];
    capabilityId?: string;
    data: Record<string, unknown>;
    occurredAt: Date;
    expiresAt: Date;
  }): Promise<void>;
  metrics(organizationId: string, from: Date, to: Date): Promise<unknown>;
}

@Injectable()
export class AnalyticsService {
  private readonly pepper: string;

  constructor(
    @Inject('ANALYTICS_DATA_STORE') private readonly repository: AnalyticsDataStore,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.pepper = config.auth.verificationPepper;
  }

  async ingest(tenant: TenantContext, userId: string, event: ProductEvent) {
    const { eventName, capabilityId, ...data } = event;
    try {
      await this.repository.ingest({
        id: randomUUID(),
        organizationId: tenant.organizationId,
        actorDigest: createHmac('sha256', this.pepper)
          .update(`product-event:${tenant.organizationId}:${userId}`)
          .digest('hex'),
        eventName,
        ...(capabilityId ? { capabilityId } : {}),
        data,
        occurredAt: new Date(),
        expiresAt: new Date(Date.now() + 400 * 86_400_000),
      });
    } catch (error) {
      if (this.isForeignKeyViolation(error)) {
        throw new AppError('ACCESS_DENIED', 'Analytics resource is unavailable.', 403);
      }
      throw error;
    }
    return { accepted: true as const };
  }

  metrics(tenant: TenantContext, query: MetricsQuery) {
    if (!['owner', 'admin', 'auditor'].includes(tenant.organizationRole)) {
      throw new AppError('ACCESS_DENIED', 'Analytics access is required.', 403);
    }
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 86_400_000);
    const to = query.to ? new Date(query.to) : new Date();
    if (from >= to || to.getTime() - from.getTime() > 366 * 86_400_000) {
      throw new AppError('ANALYTICS_RANGE_INVALID', 'Analytics range must be within 366 days.', 400);
    }
    return this.repository.metrics(tenant.organizationId, from, to);
  }

  private isForeignKeyViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23503';
  }
}
