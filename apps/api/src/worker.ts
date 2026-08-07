import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import { parseConfig } from './config/config.js';
import { OperationsWorker } from './platform/events/operations.worker.js';
import { platformMetrics } from './platform/telemetry/metrics-registry.js';
import { platformLogger } from './platform/telemetry/structured-logger.js';

const config = parseConfig(process.env);
const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
const storage = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: true,
  credentials: { accessKeyId: config.s3.accessKey, secretAccessKey: config.s3.secretKey },
});
const operations = new OperationsWorker(pool, config);
let stopping = false;
let pollCount = 0;

async function cleanupExpiredUploads(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const uploads = await client.query<{ id: string; object_key: string }>(
      `SELECT id,object_key FROM artifact_uploads
        WHERE status='pending' AND expires_at < now()
        ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT 100`,
    );
    for (const upload of uploads.rows) {
      await storage.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: upload.object_key }));
      await client.query("UPDATE artifact_uploads SET status='expired',failure_code='expired' WHERE id=$1", [
        upload.id,
      ]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    platformMetrics.increment('agentdoor_worker_errors_total', { operation: 'artifact_cleanup' });
    platformLogger.error('worker.artifact_cleanup.failed', { error });
  } finally {
    client.release();
  }
}

async function poll(): Promise<void> {
  while (!stopping) {
    try {
      await operations.enqueuePending();
      if (pollCount % 60 === 0) {
        await cleanupExpiredUploads();
        await operations.cleanupRetention();
      }
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          ? error.code
          : error instanceof Error
            ? error.message
            : 'unknown-error';
      platformMetrics.increment('agentdoor_worker_errors_total', { operation: 'poll' });
      platformLogger.error('worker.poll.failed', { code: code.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) });
    }
    pollCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    platformLogger.info('worker.shutdown.requested', { signal });
    stopping = true;
  });
}

void poll().finally(async () => {
  await operations.close();
  storage.destroy();
  await pool.end();
  platformLogger.info('worker.shutdown.completed');
});
