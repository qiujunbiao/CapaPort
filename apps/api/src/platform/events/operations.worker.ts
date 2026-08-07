import { randomUUID } from 'node:crypto';
import { type Job, Queue, Worker } from 'bullmq';
import nodemailer from 'nodemailer';
import type { Pool, PoolClient } from 'pg';
import type { AppConfig } from '../../config/config.js';
import { notificationForEvent } from '../../modules/notifications/notification.template.js';
import { platformMetrics } from '../telemetry/metrics-registry.js';
import { platformLogger } from '../telemetry/structured-logger.js';

type OutboxRow = {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  organization_id: string | null;
  payload: Record<string, unknown>;
  published_at: Date | null;
};

const queueName = 'agentdoor-outbox';

function safeErrorCode(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    const code = error.code.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
    if (code) return code;
  }
  if (error instanceof Error) {
    const message = error.message.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
    if (message) return message;
    return error.name.slice(0, 80);
  }
  return fallback;
}

export class OperationsWorker {
  private readonly queue: Queue<{ eventId: string }>;
  private readonly worker: Worker<{ eventId: string }>;
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;

  constructor(
    private readonly pool: Pool,
    private readonly config: AppConfig,
  ) {
    const redisUrl = new URL(config.redisUrl);
    const connection = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      db: Number(redisUrl.pathname.slice(1) || 0),
      maxRetriesPerRequest: null,
      ...(redisUrl.username ? { username: decodeURIComponent(redisUrl.username) } : {}),
      ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
    };
    this.queue = new Queue(queueName, { connection });
    this.transport = nodemailer.createTransport({
      host: config.notification.smtpHost,
      port: config.notification.smtpPort,
      secure: false,
    });
    this.worker = new Worker(queueName, (job) => this.process(job), {
      connection,
      concurrency: 5,
    });
    this.worker.on('error', (error) => {
      platformMetrics.increment('agentdoor_worker_errors_total', { operation: 'notification' });
      platformLogger.error('worker.notification.error', { code: safeErrorCode(error, 'WorkerError') });
    });
  }

  async enqueuePending(): Promise<number> {
    const events = await this.pool.query<{ id: string }>(
      `SELECT id FROM outbox_events
        WHERE published_at IS NULL AND failed_at IS NULL AND available_at <= now()
        ORDER BY created_at LIMIT 100`,
    );
    for (const event of events.rows) {
      await this.queue.add(
        'dispatch',
        { eventId: event.id },
        {
          jobId: event.id,
          attempts: 5,
          backoff: { type: 'exponential', delay: 1_000 },
          removeOnComplete: { age: 86_400, count: 10_000 },
          removeOnFail: { age: 604_800, count: 10_000 },
        },
      );
    }
    return events.rowCount ?? 0;
  }

  async cleanupRetention(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM product_events WHERE expires_at < now()');
      await client.query('DELETE FROM notifications WHERE expires_at < now()');
      await client.query(
        `DELETE FROM outbox_events WHERE published_at < now() - interval '400 days'
          AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.source_event_id=outbox_events.id)`,
      );
      await client.query("SET LOCAL agentdoor.audit_retention = 'on'");
      await client.query('DELETE FROM audit_logs WHERE expires_at < now()');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
  }

  private async process(job: Job<{ eventId: string }>): Promise<void> {
    const jobLogger = platformLogger.child({
      jobId: job.id,
      eventId: job.data.eventId,
      correlationId: job.data.eventId,
    });
    const result = await this.pool.query<OutboxRow>('SELECT * FROM outbox_events WHERE id=$1', [job.data.eventId]);
    const event = result.rows[0];
    if (!event || event.published_at) return;
    try {
      jobLogger.info('worker.outbox.started', { eventType: event.event_type });
      const recipients = await this.resolveRecipients(event);
      await this.prepareNotifications(event, recipients);
      await this.deliver(event.id);
      await this.pool.query(
        'UPDATE outbox_events SET published_at=now(),last_error=NULL WHERE id=$1 AND published_at IS NULL',
        [event.id],
      );
      platformMetrics.increment('agentdoor_worker_jobs_total', { status: 'completed', type: event.event_type });
      jobLogger.info('worker.outbox.completed', { eventType: event.event_type, recipientCount: recipients.length });
    } catch (error) {
      platformMetrics.increment('agentdoor_worker_jobs_total', { status: 'failed', type: event.event_type });
      jobLogger.error('worker.outbox.failed', { eventType: event.event_type, error });
      const failure = await this.pool.query<{ attempts: number }>(
        `UPDATE outbox_events SET attempts=attempts+1,last_error=$2,
           available_at=now() + make_interval(secs => LEAST(300,power(2,attempts)::int)),
           failed_at=CASE WHEN attempts+1 >= 5 THEN now() ELSE failed_at END
         WHERE id=$1 RETURNING attempts`,
        [event.id, safeErrorCode(error, 'WorkerError')],
      );
      if ((failure.rows[0]?.attempts ?? 0) >= 5) return;
      throw error;
    }
  }

  private async resolveRecipients(event: OutboxRow): Promise<string[]> {
    if (!event.organization_id) return [];
    if (event.aggregate_type === 'publication') {
      if (event.event_type === 'publication.submitted') {
        const result = await this.pool.query<{ user_id: string }>(
          `SELECT DISTINCT user_id FROM (
             SELECT om.user_id FROM publications p
             JOIN organization_memberships om ON om.organization_id=p.organization_id
              AND om.status='active' AND om.role IN ('owner','admin')
             WHERE p.id=$1 AND p.organization_id=$2 AND om.user_id<>p.submitted_by_user_id
             UNION
             SELECT sm.user_id FROM publications p
             JOIN space_memberships sm ON sm.space_id=p.target_space_id
              AND sm.organization_id=p.organization_id AND sm.status='active' AND sm.role='reviewer'
             WHERE p.id=$1 AND p.organization_id=$2 AND sm.user_id<>p.submitted_by_user_id
           ) recipients`,
          [event.aggregate_id, event.organization_id],
        );
        return result.rows.map((row) => row.user_id);
      }
      const result = await this.pool.query<{ submitted_by_user_id: string }>(
        'SELECT submitted_by_user_id FROM publications WHERE id=$1 AND organization_id=$2',
        [event.aggregate_id, event.organization_id],
      );
      return result.rows.map((row) => row.submitted_by_user_id);
    }
    if (event.aggregate_type === 'capability_version') {
      const result = await this.pool.query<{ user_id: string }>(
        `SELECT DISTINCT i.user_id FROM installations i
          WHERE i.organization_id=$1 AND i.version_id=$2 AND i.status='installed'`,
        [event.organization_id, event.aggregate_id],
      );
      return result.rows.map((row) => row.user_id);
    }
    if (event.aggregate_type === 'device') {
      const result = await this.pool.query<{ user_id: string }>(
        'SELECT user_id FROM devices WHERE organization_id=$1 AND id=$2',
        [event.organization_id, event.aggregate_id],
      );
      return result.rows.map((row) => row.user_id);
    }
    if (event.aggregate_type === 'installation') {
      const result = await this.pool.query<{ user_id: string }>(
        'SELECT user_id FROM installations WHERE organization_id=$1 AND id=$2',
        [event.organization_id, event.aggregate_id],
      );
      return result.rows.map((row) => row.user_id);
    }
    return [];
  }

  private async prepareNotifications(event: OutboxRow, recipients: string[]): Promise<void> {
    if (!event.organization_id || recipients.length === 0) return;
    const template = notificationForEvent({
      eventType: event.event_type,
      aggregateId: event.aggregate_id,
      payload: event.payload,
    });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const userId of [...new Set(recipients)]) {
        const notificationId = await this.upsertNotification(client, event, userId, template);
        const identity = await client.query<{ kind: string }>(
          `SELECT kind FROM user_identities
            WHERE user_id=$1 AND verified_at IS NOT NULL
            ORDER BY CASE kind WHEN 'email' THEN 0 ELSE 1 END,created_at LIMIT 1`,
          [userId],
        );
        const kind = identity.rows[0]?.kind;
        if (kind === 'email' || kind === 'phone') {
          await client.query(
            `INSERT INTO notification_deliveries
              (id,organization_id,notification_id,source_event_id,user_id,channel,status)
             VALUES ($1,$2,$3,$4,$5,$6,'pending')
             ON CONFLICT (source_event_id,user_id,channel) DO NOTHING`,
            [randomUUID(), event.organization_id, notificationId, event.id, userId, kind === 'email' ? 'email' : 'sms'],
          );
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertNotification(
    client: PoolClient,
    event: OutboxRow,
    userId: string,
    template: ReturnType<typeof notificationForEvent>,
  ): Promise<string> {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO notifications
        (id,organization_id,user_id,source_event_id,type,title,body,data,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now()+interval '180 days')
       ON CONFLICT (source_event_id,user_id) DO NOTHING RETURNING id`,
      [
        randomUUID(),
        event.organization_id,
        userId,
        event.id,
        template.type,
        template.title,
        template.body,
        JSON.stringify(template.data),
      ],
    );
    if (inserted.rows[0]) return inserted.rows[0].id;
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM notifications WHERE source_event_id=$1 AND user_id=$2',
      [event.id, userId],
    );
    const notificationId = existing.rows[0]?.id;
    if (!notificationId) throw new Error('NotificationRecordMissing');
    return notificationId;
  }

  private async deliver(sourceEventId: string): Promise<void> {
    const deliveries = await this.pool.query<{
      id: string;
      user_id: string;
      channel: 'email' | 'sms';
      attempts: number;
      title: string;
      body: string;
      target: string | null;
    }>(
      `SELECT d.id,d.user_id,d.channel,d.attempts,n.title,n.body,identity.normalized_value AS target
         FROM notification_deliveries d
         JOIN notifications n ON n.id=d.notification_id
         LEFT JOIN LATERAL (
           SELECT normalized_value FROM user_identities ui
            WHERE ui.user_id=d.user_id AND ui.verified_at IS NOT NULL
              AND ((d.channel='email' AND ui.kind='email') OR (d.channel='sms' AND ui.kind='phone'))
            ORDER BY ui.created_at LIMIT 1
         ) identity ON true
        WHERE d.source_event_id=$1 AND d.status IN ('pending','failed') AND d.attempts < 5`,
      [sourceEventId],
    );
    for (const delivery of deliveries.rows) {
      if (!delivery.target) continue;
      try {
        const destination =
          delivery.channel === 'email' ? delivery.target : `sms.${delivery.target.replace(/\D/g, '')}@agentdoor.local`;
        await this.transport.sendMail({
          from: this.config.notification.smtpFrom,
          to: destination,
          messageId: `<${sourceEventId}.${delivery.user_id}@agentdoor.local>`,
          subject: delivery.title,
          text: delivery.body,
        });
        await this.pool.query(
          `UPDATE notification_deliveries
            SET status='delivered',attempts=attempts+1,delivered_at=now(),updated_at=now(),error_code=NULL
            WHERE id=$1 AND status<>'delivered'`,
          [delivery.id],
        );
      } catch (error) {
        await this.pool.query(
          `UPDATE notification_deliveries SET attempts=attempts+1,
             status=CASE WHEN attempts+1 >= 5 THEN 'dead_letter' ELSE 'failed' END,
             error_code=$2,updated_at=now() WHERE id=$1`,
          [delivery.id, safeErrorCode(error, 'DeliveryError')],
        );
        throw new Error('NotificationDeliveryFailed');
      }
    }
  }
}
