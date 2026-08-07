import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import { parseConfig } from './config/config.js';

const config = parseConfig(process.env);
const pool = new Pool({ connectionString: config.databaseUrl, max: 5 });
const storage = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: true,
  credentials: { accessKeyId: config.s3.accessKey, secretAccessKey: config.s3.secretKey },
});
let stopping = false;
let pollCount = 0;

async function cleanupExpiredUploads(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const uploads = await client.query<{ id: string; object_key: string }>(
      `select id,object_key from artifact_uploads
        where status='pending' and expires_at < now()
        order by expires_at for update skip locked limit 100`,
    );
    for (const upload of uploads.rows) {
      await storage.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: upload.object_key }));
      await client.query("update artifact_uploads set status='expired',failure_code='expired' where id=$1", [
        upload.id,
      ]);
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    console.error('Artifact cleanup failed', error instanceof Error ? error.name : 'unknown error');
  } finally {
    client.release();
  }
}

async function poll(): Promise<void> {
  while (!stopping) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const result = await client.query<{ id: string }>(
        `select id from outbox_events where published_at is null and failed_at is null order by created_at for update skip locked limit 20`,
      );
      for (const event of result.rows) {
        await client.query('update outbox_events set published_at = now() where id = $1', [event.id]);
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      console.error('Outbox polling failed', error instanceof Error ? error.message : 'unknown error');
    } finally {
      client.release();
    }
    if (pollCount % 60 === 0) await cleanupExpiredUploads();
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
  storage.destroy();
  await pool.end();
});
