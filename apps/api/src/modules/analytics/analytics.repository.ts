import type { ProductEvent } from '@agentdoor/contracts/operations';
import { Inject, Injectable } from '@nestjs/common';
import { productEvents } from '../../db/schema/operations.js';
import type { DatabaseService } from '../../platform/database/database.service.js';
import type { AnalyticsDataStore } from './analytics.service.js';

@Injectable()
export class AnalyticsRepository implements AnalyticsDataStore {
  constructor(@Inject('DATABASE_SERVICE') private readonly database: DatabaseService) {}

  async ingest(input: {
    id: string;
    organizationId: string;
    actorDigest: string;
    eventName: ProductEvent['eventName'];
    capabilityId?: string;
    data: Record<string, unknown>;
    occurredAt: Date;
    expiresAt: Date;
  }): Promise<void> {
    await this.database.db.insert(productEvents).values(input);
  }

  async metrics(organizationId: string, from: Date, to: Date) {
    const [events, publications, installations, devices] = await Promise.all([
      this.database.pool.query<{ event_name: string; count: string }>(
        `SELECT event_name,count(*)::text AS count FROM product_events
          WHERE organization_id=$1 AND occurred_at >= $2 AND occurred_at < $3
          GROUP BY event_name ORDER BY event_name`,
        [organizationId, from, to],
      ),
      this.database.pool.query<{ status: string; count: string }>(
        `SELECT status,count(*)::text AS count FROM publications
          WHERE organization_id=$1 AND created_at >= $2 AND created_at < $3
          GROUP BY status ORDER BY status`,
        [organizationId, from, to],
      ),
      this.database.pool.query<{ outcome: string; count: string }>(
        `SELECT outcome,count(*)::text AS count FROM installation_analytics
          WHERE organization_id=$1 AND occurred_at >= $2 AND occurred_at < $3
          GROUP BY outcome ORDER BY outcome`,
        [organizationId, from, to],
      ),
      this.database.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM devices
          WHERE organization_id=$1 AND status='active' AND last_seen_at >= $2 AND last_seen_at < $3`,
        [organizationId, from, to],
      ),
    ]);
    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      productEvents: Object.fromEntries(events.rows.map((row) => [row.event_name, Number(row.count)])),
      publicationFunnel: Object.fromEntries(publications.rows.map((row) => [row.status, Number(row.count)])),
      installationOutcomes: Object.fromEntries(installations.rows.map((row) => [row.outcome, Number(row.count)])),
      activeDevices: Number(devices.rows[0]?.count ?? 0),
    };
  }
}
