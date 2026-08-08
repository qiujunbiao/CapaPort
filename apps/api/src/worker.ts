import { Pool } from 'pg';
import { parseConfig } from './config/config.js';
import { OperationsWorker } from './platform/events/operations.worker.js';
import { platformMetrics } from './platform/telemetry/metrics-registry.js';
import { platformLogger } from './platform/telemetry/structured-logger.js';

const config = parseConfig(process.env);
const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
const operations = new OperationsWorker(pool, config);
let stopping = false;
let pollCount = 0;

async function poll(): Promise<void> {
  while (!stopping) {
    try {
      await operations.enqueuePending();
      if (pollCount % 60 === 0) {
        await operations.cleanupRetention();
      }
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          ? error.code
          : error instanceof Error
            ? error.message
            : 'unknown-error';
      platformMetrics.increment('capaport_worker_errors_total', { operation: 'poll' });
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
  await pool.end();
  platformLogger.info('worker.shutdown.completed');
});
