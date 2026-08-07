import { Pool } from 'pg';
import { parseConfig } from './config/config.js';

const config = parseConfig(process.env);
const pool = new Pool({ connectionString: config.databaseUrl, max: 5 });
let stopping = false;

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
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

void poll().finally(() => pool.end());
