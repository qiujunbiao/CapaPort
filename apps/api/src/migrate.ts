import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { parseConfig } from './config/config.js';

async function main(): Promise<void> {
  const config = parseConfig(process.env);
  const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: new URL('../migrations', import.meta.url).pathname });
  } finally {
    await pool.end();
  }
}

void main();
