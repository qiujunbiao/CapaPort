import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { AppConfig } from '../../config/config.js';
import { APP_CONFIG } from '../../config/config.js';
import * as schema from '../../db/schema/index.js';
import type { DependencyProbe } from '../health/health.service.js';

@Injectable()
export class DatabaseService implements DependencyProbe, OnModuleDestroy {
  readonly name = 'database';
  readonly pool: Pool;
  readonly db: NodePgDatabase<typeof schema>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl, max: 20 });
    this.db = drizzle(this.pool, { schema });
  }

  async check(): Promise<void> {
    await this.pool.query('select 1');
  }

  async transaction<T>(callback: (transaction: NodePgDatabase<typeof schema>) => Promise<T>): Promise<T> {
    return this.db.transaction(callback);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
