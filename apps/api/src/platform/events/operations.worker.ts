import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { type Job, Queue, Worker } from 'bullmq';
import nodemailer from 'nodemailer';
import type { Pool, PoolClient } from 'pg';
import type { AppConfig } from '../../config/config.js';
import { notificationForEvent } from '../../modules/notifications/notification.template.js';
import { createSmsProvider, type SmsProvider } from '../notifications/sms.provider.js';
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
const operationQueueName = 'agentdoor-operations';

export const OPERATION_JOB_TYPES = [
  'server_scan',
  'search_refresh',
  'version_update_notifications',
  'daily_aggregate',
  'audit_archive',
  'object_cleanup',
  'lifecycle_deletion',
] as const;
export type OperationJobType = (typeof OPERATION_JOB_TYPES)[number];
export type OperationJob = {
  id: string;
  organizationId?: string;
  type: OperationJobType;
  dedupKey: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
};
export interface OperationJobStateStore {
  claim(job: OperationJob): Promise<boolean>;
  complete(job: OperationJob): Promise<void>;
  fail(job: OperationJob, errorCode: string, deadLetter: boolean): Promise<void>;
}
export type OperationJobHandlers = Record<OperationJobType, (job: OperationJob) => Promise<void>>;

export class OperationJobRunner {
  constructor(
    private readonly store: OperationJobStateStore,
    private readonly handlers: OperationJobHandlers,
  ) {}

  async run(job: OperationJob): Promise<void> {
    if (!(await this.store.claim(job))) return;
    try {
      await this.handlers[job.type](job);
      await this.store.complete(job);
      platformMetrics.increment('agentdoor_operation_jobs_total', { status: 'completed', type: job.type });
    } catch (error) {
      const deadLetter = job.attempts + 1 >= job.maxAttempts;
      await this.store.fail(job, safeErrorCode(error, 'OperationError'), deadLetter);
      platformMetrics.increment('agentdoor_operation_jobs_total', {
        status: deadLetter ? 'dead_letter' : 'retrying',
        type: job.type,
      });
    }
  }
}

class PostgresOperationJobStore implements OperationJobStateStore {
  constructor(private readonly pool: Pool) {}

  async claim(job: OperationJob): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE operation_jobs SET status='running',started_at=now(),updated_at=now()
        WHERE id=$1 AND status='pending' AND available_at <= now()`,
      [job.id],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async complete(job: OperationJob): Promise<void> {
    await this.pool.query(
      `UPDATE operation_jobs SET status='completed',completed_at=now(),updated_at=now(),last_error=NULL
        WHERE id=$1 AND status='running'`,
      [job.id],
    );
  }

  async fail(job: OperationJob, errorCode: string, deadLetter: boolean): Promise<void> {
    await this.pool.query(
      `UPDATE operation_jobs SET status=$2,attempts=attempts+1,last_error=$3,updated_at=now(),
         available_at=now()+make_interval(secs => LEAST(900,power(2,attempts+1)::int))
       WHERE id=$1 AND status='running'`,
      [job.id, deadLetter ? 'dead_letter' : 'pending', errorCode],
    );
  }
}

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

export async function versionUpdateRecipients(pool: Pick<Pool, 'query'>, organizationId: string, versionId: string) {
  const result = await pool.query<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM (
       SELECT i.user_id FROM capability_versions published
        JOIN installations i ON i.organization_id=published.organization_id
          AND i.capability_id=published.capability_id AND i.status='installed' AND i.version_id<>published.id
        WHERE published.organization_id=$1 AND published.id=$2
       UNION
       SELECT p.submitted_by_user_id FROM publications p
        WHERE p.organization_id=$1 AND p.published_version_id=$2
     ) recipients`,
    [organizationId, versionId],
  );
  return result.rows.map((row) => row.user_id);
}

export async function replaceDailyAggregate(pool: Pick<Pool, 'query'>, day: string): Promise<void> {
  await pool.query(
    `INSERT INTO analytics_daily (organization_id,day,metrics,computed_at)
     SELECT o.id,$1::date,jsonb_build_object(
       'productEvents',(SELECT count(*) FROM product_events e WHERE e.organization_id=o.id AND e.occurred_at >= $1::date AND e.occurred_at < $1::date+1),
       'publications',(SELECT count(*) FROM publications p WHERE p.organization_id=o.id AND p.created_at >= $1::date AND p.created_at < $1::date+1),
       'installations',(SELECT count(*) FROM installation_analytics i WHERE i.organization_id=o.id AND i.occurred_at >= $1::date AND i.occurred_at < $1::date+1)
     ),now() FROM organizations o WHERE o.status='active'
     ON CONFLICT (organization_id,day) DO UPDATE SET metrics=EXCLUDED.metrics,computed_at=now()`,
    [day],
  );
}

export class OperationsWorker {
  private readonly queue: Queue<{ eventId: string }>;
  private readonly worker: Worker<{ eventId: string }>;
  private readonly operationQueue: Queue<OperationJob>;
  private readonly operationWorker: Worker<OperationJob>;
  private readonly operationRunner: OperationJobRunner;
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;
  private readonly sms: SmsProvider;
  private readonly storage: S3Client;

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
    this.operationQueue = new Queue(operationQueueName, { connection });
    this.transport = nodemailer.createTransport({
      host: config.notification.smtpHost,
      port: config.notification.smtpPort,
      secure: false,
    });
    this.sms = createSmsProvider(config);
    this.storage = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.s3.accessKey, secretAccessKey: config.s3.secretKey },
    });
    this.operationRunner = new OperationJobRunner(new PostgresOperationJobStore(pool), {
      server_scan: (job) => this.serverScan(job),
      search_refresh: (job) => this.refreshSearchDocument(job),
      version_update_notifications: (job) => this.deliverVersionUpdates(job),
      daily_aggregate: (job) => this.replaceDailyAggregates(job),
      audit_archive: (job) => this.archiveAuditLogs(job),
      object_cleanup: () => this.cleanupExpiredUploads(),
      lifecycle_deletion: (job) => this.performLifecycleDeletion(job),
    });
    this.worker = new Worker(queueName, (job) => this.process(job), {
      connection,
      concurrency: 5,
    });
    this.operationWorker = new Worker(operationQueueName, (job) => this.operationRunner.run(job.data), {
      connection,
      concurrency: 3,
    });
    this.worker.on('error', (error) => {
      platformMetrics.increment('agentdoor_worker_errors_total', { operation: 'notification' });
      platformLogger.error('worker.notification.error', { code: safeErrorCode(error, 'WorkerError') });
    });
    this.operationWorker.on('error', (error) => {
      platformMetrics.increment('agentdoor_worker_errors_total', { operation: 'durable_job' });
      platformLogger.error('worker.operation.error', { code: safeErrorCode(error, 'WorkerError') });
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
    await this.scheduleRecurringJobs();
    const operations = await this.enqueuePendingOperations();
    return (events.rowCount ?? 0) + operations;
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
    await this.operationWorker.close();
    await this.queue.close();
    await this.operationQueue.close();
    this.storage.destroy();
  }

  private async scheduleRecurringJobs(): Promise<void> {
    const now = new Date();
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
    const dayKey = day.toISOString().slice(0, 10);
    const hourKey = now.toISOString().slice(0, 13);
    await Promise.all([
      this.createOperationJob('daily_aggregate', `daily:${dayKey}`, { day: dayKey }),
      this.createOperationJob('audit_archive', `audit:${dayKey}`, { before: now.toISOString() }),
      this.createOperationJob('object_cleanup', `objects:${hourKey}`, {}),
    ]);
  }

  private async enqueuePendingOperations(): Promise<number> {
    await this.pool.query(
      `UPDATE operation_jobs SET status='pending',available_at=now(),updated_at=now(),last_error='WorkerLeaseExpired'
        WHERE status='running' AND started_at < now()-interval '15 minutes'`,
    );
    const result = await this.pool.query<{
      id: string;
      organization_id: string | null;
      type: OperationJobType;
      dedup_key: string;
      payload: Record<string, unknown>;
      attempts: number;
      max_attempts: number;
    }>(
      `SELECT id,organization_id,type,dedup_key,payload,attempts,max_attempts FROM operation_jobs
        WHERE status='pending' AND available_at <= now() ORDER BY created_at LIMIT 100`,
    );
    for (const row of result.rows) {
      const operation: OperationJob = {
        id: row.id,
        ...(row.organization_id ? { organizationId: row.organization_id } : {}),
        type: row.type,
        dedupKey: row.dedup_key,
        payload: row.payload,
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
      };
      await this.operationQueue.add(row.type, operation, {
        jobId: `${row.id}-${row.attempts}`,
        removeOnComplete: true,
        removeOnFail: { age: 86_400, count: 10_000 },
      });
    }
    return result.rowCount ?? 0;
  }

  private async createOperationJob(
    type: OperationJobType,
    dedupKey: string,
    payload: Record<string, unknown>,
    organizationId?: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO operation_jobs (id,organization_id,type,dedup_key,payload)
       VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (type,dedup_key) DO NOTHING`,
      [randomUUID(), organizationId ?? null, type, dedupKey, JSON.stringify(payload)],
    );
  }

  private async createFollowUpJobs(event: OutboxRow): Promise<void> {
    if (event.event_type === 'publication.submitted') {
      await this.createOperationJob(
        'server_scan',
        `publication:${event.aggregate_id}`,
        { publicationId: event.aggregate_id },
        event.organization_id ?? undefined,
      );
    }
    if (event.event_type === 'capability.version.published') {
      const versionId =
        typeof event.payload.publishedVersionId === 'string' ? event.payload.publishedVersionId : event.aggregate_id;
      const capabilityId = typeof event.payload.capabilityId === 'string' ? event.payload.capabilityId : undefined;
      await Promise.all([
        this.createOperationJob(
          'search_refresh',
          `version:${versionId}`,
          { versionId, ...(capabilityId ? { capabilityId } : {}) },
          event.organization_id ?? undefined,
        ),
        this.createOperationJob(
          'version_update_notifications',
          `event:${event.id}`,
          { eventId: event.id, versionId },
          event.organization_id ?? undefined,
        ),
      ]);
    }
  }

  private async serverScan(job: OperationJob): Promise<void> {
    const publicationId = this.payloadString(job, 'publicationId');
    await this.pool.query(
      `INSERT INTO server_scan_results (job_id,organization_id,publication_id,status,report,completed_at)
       SELECT $2,p.organization_id,p.id,
         CASE WHEN coalesce((p.candidate_scan_report->>'blocked')::boolean,false) THEN 'blocked' ELSE 'passed' END,
         p.candidate_scan_report || jsonb_build_object('serverVerifiedAt',now()),now()
       FROM publications p WHERE p.id=$1
       ON CONFLICT (organization_id,publication_id) DO NOTHING`,
      [publicationId, job.id],
    );
  }

  private async refreshSearchDocument(job: OperationJob): Promise<void> {
    const versionId = this.payloadString(job, 'versionId');
    await this.pool.query(
      `INSERT INTO capability_search_documents (capability_id,organization_id,document,version_id,refreshed_at)
       SELECT c.id,c.organization_id,
         concat_ws(' ',c.slug,c.name,c.description,array_to_string(ARRAY(SELECT jsonb_array_elements_text(c.tags)),' ')),
         v.id,now()
       FROM capability_versions v JOIN capabilities c ON c.id=v.capability_id AND c.organization_id=v.organization_id
       WHERE v.id=$1 AND v.status IN ('published','deprecated')
       ON CONFLICT (capability_id) DO UPDATE SET document=EXCLUDED.document,version_id=EXCLUDED.version_id,
         organization_id=EXCLUDED.organization_id,refreshed_at=now()`,
      [versionId],
    );
  }

  private async deliverVersionUpdates(job: OperationJob): Promise<void> {
    const eventId = this.payloadString(job, 'eventId');
    const result = await this.pool.query<OutboxRow>('SELECT * FROM outbox_events WHERE id=$1', [eventId]);
    const event = result.rows[0];
    if (!event) return;
    const recipients = await this.resolveRecipients(event);
    await this.prepareNotifications(event, recipients);
    await this.deliver(event.id);
  }

  private async replaceDailyAggregates(job: OperationJob): Promise<void> {
    const day = this.payloadString(job, 'day');
    await replaceDailyAggregate(this.pool, day);
  }

  private async archiveAuditLogs(_job: OperationJob): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const groups = await client.query<{
        organization_id: string;
        period_start: Date;
        period_end: Date;
        row_count: number;
        payload: unknown;
        checksum: string;
      }>(
        `SELECT organization_id,date_trunc('month',min(created_at)) AS period_start,
          date_trunc('month',min(created_at))+interval '1 month' AS period_end,count(*)::int AS row_count,
          jsonb_agg(to_jsonb(a) ORDER BY created_at,id) AS payload,
          md5(jsonb_agg(to_jsonb(a) ORDER BY created_at,id)::text) AS checksum
         FROM (SELECT * FROM audit_logs WHERE expires_at < now() ORDER BY created_at) a
         GROUP BY organization_id,date_trunc('month',created_at)`,
      );
      for (const group of groups.rows) {
        await client.query(
          `INSERT INTO audit_archives
            (id,organization_id,period_start,period_end,row_count,payload,checksum)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
           ON CONFLICT (organization_id,period_start,period_end) DO NOTHING`,
          [
            randomUUID(),
            group.organization_id,
            group.period_start,
            group.period_end,
            group.row_count,
            JSON.stringify(group.payload),
            group.checksum,
          ],
        );
      }
      await client.query("SET LOCAL agentdoor.audit_retention = 'on'");
      await client.query(
        `DELETE FROM audit_logs a USING audit_archives archive
          WHERE a.organization_id=archive.organization_id AND a.expires_at < now()
            AND a.created_at >= archive.period_start AND a.created_at < archive.period_end`,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async cleanupExpiredUploads(): Promise<void> {
    const uploads = await this.pool.query<{ id: string; object_key: string }>(
      `SELECT id,object_key FROM artifact_uploads WHERE status='pending' AND expires_at < now()
        ORDER BY expires_at LIMIT 100`,
    );
    for (const upload of uploads.rows) {
      await this.storage.send(new DeleteObjectCommand({ Bucket: this.config.s3.bucket, Key: upload.object_key }));
      await this.pool.query(
        "UPDATE artifact_uploads SET status='expired',failure_code='expired' WHERE id=$1 AND status='pending'",
        [upload.id],
      );
    }
  }

  private async performLifecycleDeletion(job: OperationJob): Promise<void> {
    const scope = this.payloadString(job, 'scope');
    const scopeId = this.payloadString(job, 'scopeId');
    if (scope === 'organization') {
      await this.deleteOrganization(scopeId);
      return;
    }
    if (scope === 'account') {
      await this.anonymizeAccount(scopeId);
      return;
    }
    throw new Error('OperationPayloadInvalid_scope');
  }

  private async deleteOrganization(organizationId: string): Promise<void> {
    const due = await this.pool.query<{ id: string }>(
      "SELECT id FROM organizations WHERE id=$1 AND status='closing' AND deletion_scheduled_at <= now()",
      [organizationId],
    );
    if (!due.rows[0]) return;
    const objects = await this.pool.query<{ object_key: string }>(
      `SELECT object_key FROM artifacts WHERE organization_id=$1
       UNION SELECT object_key FROM artifact_uploads WHERE organization_id=$1`,
      [organizationId],
    );
    for (const object of objects.rows) {
      await this.storage.send(new DeleteObjectCommand({ Bucket: this.config.s3.bucket, Key: object.object_key }));
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO lifecycle_audit_events (id,scope_type,scope_id,action,metadata)
         VALUES ($1,'organization',$2,'organization.deletion_completed',$3::jsonb)`,
        [randomUUID(), organizationId, JSON.stringify({ deletedObjectCount: objects.rows.length })],
      );
      await client.query("SET LOCAL agentdoor.lifecycle_delete = 'on'");
      await client.query(
        'UPDATE audit_logs SET organization_id=NULL,actor_membership_id=NULL WHERE organization_id=$1',
        [organizationId],
      );
      await client.query(
        "DELETE FROM organizations WHERE id=$1 AND status='closing' AND deletion_scheduled_at <= now()",
        [organizationId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async anonymizeAccount(userId: string): Promise<void> {
    const due = await this.pool.query<{ user_id: string }>(
      "SELECT user_id FROM account_deletion_requests WHERE user_id=$1 AND status='scheduled' AND scheduled_at <= now()",
      [userId],
    );
    if (!due.rows[0]) return;
    const soleOwner = await this.pool.query<{ organization_id: string }>(
      `SELECT membership.organization_id FROM organization_memberships membership
       JOIN organizations organization ON organization.id=membership.organization_id AND organization.status='active'
       WHERE membership.user_id=$1 AND membership.role='owner' AND membership.status='active'
       AND NOT EXISTS (
         SELECT 1 FROM organization_memberships another
         WHERE another.organization_id=membership.organization_id AND another.role='owner'
           AND another.status='active' AND another.user_id<>$1
       ) LIMIT 1`,
      [userId],
    );
    if (soleOwner.rows[0]) throw new Error('AccountStillOwnsOrganization');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM user_identities WHERE user_id=$1', [userId]);
      await client.query('DELETE FROM sessions WHERE user_id=$1', [userId]);
      await client.query(
        `UPDATE users SET display_name='Deleted user',password_hash='!account-deleted!',status='deleted',updated_at=now()
         WHERE id=$1`,
        [userId],
      );
      await client.query(
        "UPDATE account_deletion_requests SET status='completed',completed_at=now() WHERE user_id=$1 AND status='scheduled'",
        [userId],
      );
      await client.query(
        `INSERT INTO lifecycle_audit_events (id,scope_type,scope_id,action,metadata)
         VALUES ($1,'account',$2,'account.deletion_completed','{}'::jsonb)`,
        [randomUUID(), userId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private payloadString(job: OperationJob, key: string): string {
    const value = job.payload[key];
    if (typeof value !== 'string' || !value) throw new Error(`OperationPayloadMissing_${key}`);
    return value;
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
      await this.createFollowUpJobs(event);
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
      return versionUpdateRecipients(this.pool, event.organization_id, event.aggregate_id);
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
        if (delivery.channel === 'sms') {
          await this.sms.send({
            to: delivery.target,
            template: 'notification',
            variables: { title: delivery.title, body: delivery.body },
            idempotencyKey: delivery.id,
          });
        } else {
          await this.transport.sendMail({
            from: this.config.notification.smtpFrom,
            to: delivery.target,
            messageId: `<${sourceEventId}.${delivery.user_id}@agentdoor.local>`,
            subject: delivery.title,
            text: delivery.body,
          });
        }
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
