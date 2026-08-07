import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { parseConfig } from './config/config.js';
import { platformLogger } from './platform/telemetry/structured-logger.js';

const migrationLockId = '627216060701';

async function main(): Promise<void> {
  const config = parseConfig(process.env);
  const pool = new Pool({ connectionString: config.databaseUrl, max: 2 });
  const lockClient = await pool.connect();
  try {
    platformLogger.info('migration.lock.waiting');
    await lockClient.query('SELECT pg_advisory_lock($1)', [migrationLockId]);
    platformLogger.info('migration.started');
    await migrate(drizzle(pool), { migrationsFolder: new URL('../migrations', import.meta.url).pathname });
    platformLogger.info('migration.completed');
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [migrationLockId]).catch((error: unknown) => {
      platformLogger.error('migration.unlock.failed', { error });
    });
    lockClient.release();
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  platformLogger.error('migration.failed', { error });
  process.exitCode = 1;
});
