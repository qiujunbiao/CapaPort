import type { AuditQuery } from '@capaport/contracts/operations';
import { Inject, Injectable } from '@nestjs/common';
import type { DatabaseService } from '../../platform/database/database.service.js';
import type { AuditDataStore, AuditRecord } from './audit.service.js';

type AuditRow = {
  id: string;
  actor_user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  metadata: Record<string, unknown>;
  created_at: Date;
};

@Injectable()
export class AuditRepository implements AuditDataStore {
  constructor(@Inject('DATABASE_SERVICE') private readonly database: DatabaseService) {}

  async list(organizationId: string, query: AuditQuery) {
    const values: unknown[] = [organizationId];
    const clauses = ['organization_id=$1', 'expires_at > now()'];
    if (query.action) {
      values.push(query.action);
      clauses.push(`action=$${values.length}`);
    }
    if (query.resourceType) {
      values.push(query.resourceType);
      clauses.push(`resource_type=$${values.length}`);
    }
    if (query.cursor) {
      values.push(query.cursor);
      clauses.push(
        `(created_at,id) < (SELECT created_at,id FROM audit_logs WHERE organization_id=$1 AND id=$${values.length})`,
      );
    }
    values.push(query.limit + 1);
    const result = await this.database.pool.query<AuditRow>(
      `SELECT id,actor_user_id,action,resource_type,resource_id,metadata,created_at
         FROM audit_logs WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC,id DESC LIMIT $${values.length}`,
      values,
    );
    const hasMore = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit).map((row) => this.record(row));
    const last = rows.at(-1);
    return { entries: rows, ...(hasMore && last ? { nextCursor: last.id } : {}) };
  }

  private record(row: AuditRow): AuditRecord {
    return {
      id: row.id,
      ...(row.actor_user_id ? { actorUserId: row.actor_user_id } : {}),
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      metadata: row.metadata,
      createdAt: row.created_at,
    };
  }
}
