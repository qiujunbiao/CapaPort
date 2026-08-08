import type { NotificationQuery } from '@capaport/contracts/operations';
import type { TenantContext } from '@capaport/contracts/organizations';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../platform/errors/app-error.js';

export type NotificationRecord = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt?: Date;
  createdAt: Date;
};

export interface NotificationDataStore {
  list(
    organizationId: string,
    userId: string,
    query: NotificationQuery,
  ): Promise<{ notifications: NotificationRecord[]; unreadCount: number; nextCursor?: string }>;
  markRead(organizationId: string, userId: string, notificationId: string): Promise<NotificationRecord | undefined>;
  deadLetters(organizationId: string, limit: number): Promise<unknown[]>;
  retryDeadLetter(organizationId: string, kind: 'operation' | 'outbox' | 'delivery', id: string): Promise<boolean>;
}

@Injectable()
export class NotificationService {
  constructor(@Inject('NOTIFICATION_DATA_STORE') private readonly repository: NotificationDataStore) {}

  list(tenant: TenantContext, userId: string, query: NotificationQuery) {
    return this.repository.list(tenant.organizationId, userId, query);
  }

  async markRead(tenant: TenantContext, userId: string, notificationId: string) {
    const notification = await this.repository.markRead(tenant.organizationId, userId, notificationId);
    if (!notification) throw new AppError('ACCESS_DENIED', 'Notification is unavailable.', 403);
    return notification;
  }

  deadLetters(tenant: TenantContext, limit: number) {
    if (!['owner', 'admin', 'auditor'].includes(tenant.organizationRole)) {
      throw new AppError('ACCESS_DENIED', 'Dead-letter visibility is restricted.', 403);
    }
    return this.repository.deadLetters(tenant.organizationId, limit);
  }

  async retryDeadLetter(
    tenant: TenantContext,
    kind: 'operation' | 'outbox' | 'delivery',
    id: string,
  ): Promise<{ accepted: true }> {
    if (!['owner', 'admin'].includes(tenant.organizationRole)) {
      throw new AppError('ACCESS_DENIED', 'Only organization administrators can retry failed jobs.', 403);
    }
    if (!(await this.repository.retryDeadLetter(tenant.organizationId, kind, id))) {
      throw new AppError('ACCESS_DENIED', 'The failed job is unavailable.', 403);
    }
    return { accepted: true };
  }
}
