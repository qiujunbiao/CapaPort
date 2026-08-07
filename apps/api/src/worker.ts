import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import { parseConfig } from './config/config.js';
import { OperationsWorker } from './platform/events/operations.worker.js';

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
    console.error('Artifact cleanup failed', error instanceof Error ? error.name : 'unknown error');
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
      console.error('Worker polling failed', code.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80));
    }
    pollCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

void poll().finally(async () => {
  await operations.close();
  storage.destroy();
  await pool.end();
});
