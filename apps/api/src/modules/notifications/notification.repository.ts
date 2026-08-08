import type { NotificationQuery } from '@capaport/contracts/operations';
import { Inject, Injectable } from '@nestjs/common';
import type { DatabaseService } from '../../platform/database/database.service.js';
import type { NotificationDataStore, NotificationRecord } from './notification.service.js';

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: Date | null;
  created_at: Date;
};

@Injectable()
export class NotificationRepository implements NotificationDataStore {
  constructor(@Inject('DATABASE_SERVICE') private readonly database: DatabaseService) {}

  async list(organizationId: string, userId: string, query: NotificationQuery) {
    const values: unknown[] = [organizationId, userId];
    const clauses = ['organization_id=$1', 'user_id=$2', 'expires_at > now()'];
    if (query.unreadOnly) clauses.push('read_at IS NULL');
    if (query.cursor) {
      values.push(query.cursor);
      clauses.push(
        `(created_at,id) < (SELECT created_at,id FROM notifications WHERE organization_id=$1 AND user_id=$2 AND id=$${values.length})`,
      );
    }
    values.push(query.limit + 1);
    const [result, unread] = await Promise.all([
      this.database.pool.query<NotificationRow>(
        `SELECT id,type,title,body,data,read_at,created_at FROM notifications
          WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT $${values.length}`,
        values,
      ),
      this.database.pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM notifications WHERE organization_id=$1 AND user_id=$2 AND read_at IS NULL AND expires_at > now()',
        [organizationId, userId],
      ),
    ]);
    const hasMore = result.rows.length > query.limit;
    const notifications = result.rows.slice(0, query.limit).map((row) => this.record(row));
    const last = notifications.at(-1);
    return {
      notifications,
      unreadCount: Number(unread.rows[0]?.count ?? 0),
      ...(hasMore && last ? { nextCursor: last.id } : {}),
    };
  }

  async markRead(organizationId: string, userId: string, notificationId: string) {
    const result = await this.database.pool.query<NotificationRow>(
      `UPDATE notifications SET read_at=COALESCE(read_at,now())
        WHERE organization_id=$1 AND user_id=$2 AND id=$3 AND expires_at > now()
        RETURNING id,type,title,body,data,read_at,created_at`,
      [organizationId, userId, notificationId],
    );
    return result.rows[0] ? this.record(result.rows[0]) : undefined;
  }

  async deadLetters(organizationId: string, limit: number) {
    const [operations, events, deliveries] = await Promise.all([
      this.database.pool.query<{
        id: string;
        type: string;
        attempts: number;
        max_attempts: number;
        last_error: string | null;
        updated_at: Date;
      }>(
        `SELECT id,type,attempts,max_attempts,last_error,updated_at FROM operation_jobs
          WHERE (organization_id=$1 OR organization_id IS NULL) AND status='dead_letter'
          ORDER BY updated_at DESC LIMIT $2`,
        [organizationId, limit],
      ),
      this.database.pool.query<{
        id: string;
        event_type: string;
        aggregate_type: string;
        aggregate_id: string;
        attempts: number;
        last_error: string | null;
        failed_at: Date;
      }>(
        `SELECT id,event_type,aggregate_type,aggregate_id,attempts,last_error,failed_at
           FROM outbox_events WHERE organization_id=$1 AND failed_at IS NOT NULL
          ORDER BY failed_at DESC LIMIT $2`,
        [organizationId, limit],
      ),
      this.database.pool.query<{
        id: string;
        notification_id: string;
        channel: string;
        attempts: number;
        error_code: string | null;
        updated_at: Date;
      }>(
        `SELECT id,notification_id,channel,attempts,error_code,updated_at
           FROM notification_deliveries WHERE organization_id=$1 AND status='dead_letter'
          ORDER BY updated_at DESC LIMIT $2`,
        [organizationId, limit],
      ),
    ]);
    return [
      ...operations.rows.map((operation) => ({ kind: 'operation' as const, ...operation })),
      ...events.rows.map((event) => ({ kind: 'outbox' as const, ...event })),
      ...deliveries.rows.map((delivery) => ({ kind: 'delivery' as const, ...delivery })),
    ].slice(0, limit);
  }

  async retryDeadLetter(
    organizationId: string,
    kind: 'operation' | 'outbox' | 'delivery',
    id: string,
  ): Promise<boolean> {
    const statements = {
      operation: `UPDATE operation_jobs SET status='pending',attempts=0,last_error=NULL,available_at=now(),updated_at=now()
        WHERE (organization_id=$1 OR organization_id IS NULL) AND id=$2 AND status='dead_letter'`,
      outbox: `UPDATE outbox_events SET failed_at=NULL,attempts=0,last_error=NULL,available_at=now()
        WHERE organization_id=$1 AND id=$2 AND failed_at IS NOT NULL`,
      delivery: `UPDATE notification_deliveries SET status='failed',attempts=0,error_code=NULL,updated_at=now()
        WHERE organization_id=$1 AND id=$2 AND status='dead_letter'`,
    } as const;
    const result = await this.database.pool.query(statements[kind], [organizationId, id]);
    return (result.rowCount ?? 0) === 1;
  }

  private record(row: NotificationRow): NotificationRecord {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      data: row.data,
      ...(row.read_at ? { readAt: row.read_at } : {}),
      createdAt: row.created_at,
    };
  }
}
