import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../db/schema/index.js';
import { outboxEvents } from '../../db/schema/outbox.js';

export type DomainEvent = {
  type: string;
  aggregateType: string;
  aggregateId: string;
  organizationId?: string;
  payload: Record<string, unknown>;
};

@Injectable()
export class OutboxService {
  async publishAfterCommit(transaction: NodePgDatabase<typeof schema>, event: DomainEvent): Promise<string> {
    const id = randomUUID();
    await transaction.insert(outboxEvents).values({
      id,
      eventType: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      organizationId: event.organizationId,
      payload: event.payload,
    });
    return id;
  }
}
