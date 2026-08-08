import {
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { capabilities, capabilityVersions } from './capabilities.js';
import { users } from './identity.js';
import { organizations } from './organizations.js';
import { outboxEvents } from './outbox.js';
import { publications } from './publications.js';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceEventId: uuid('source_event_id')
      .notNull()
      .references(() => outboxEvents.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('notifications_event_user_uidx').on(table.sourceEventId, table.userId),
    uniqueIndex('notifications_id_org_user_uidx').on(table.id, table.organizationId, table.userId),
    index('notifications_inbox_idx').on(table.organizationId, table.userId, table.readAt, table.createdAt),
  ],
);

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    sourceEventId: uuid('source_event_id')
      .notNull()
      .references(() => outboxEvents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    errorCode: text('error_code'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'notification_deliveries_notification_tenant_fk',
      columns: [table.notificationId, table.organizationId, table.userId],
      foreignColumns: [notifications.id, notifications.organizationId, notifications.userId],
    }).onDelete('cascade'),
    uniqueIndex('notification_deliveries_event_user_channel_uidx').on(table.sourceEventId, table.userId, table.channel),
    index('notification_deliveries_status_idx').on(table.status, table.updatedAt),
  ],
);

export const productEvents = pgTable(
  'product_events',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    actorDigest: text('actor_digest').notNull(),
    eventName: text('event_name').notNull(),
    capabilityId: uuid('capability_id').references(() => capabilities.id, { onDelete: 'cascade' }),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('product_events_metrics_idx').on(table.organizationId, table.eventName, table.occurredAt),
    index('product_events_retention_idx').on(table.expiresAt),
  ],
);

export const operationJobs = pgTable(
  'operation_jobs',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    dedupKey: text('dedup_key').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('operation_jobs_type_dedup_uidx').on(table.type, table.dedupKey),
    index('operation_jobs_ready_idx').on(table.status, table.availableAt, table.createdAt),
    index('operation_jobs_org_dead_idx').on(table.organizationId, table.status, table.updatedAt),
  ],
);

export const capabilitySearchDocuments = pgTable(
  'capability_search_documents',
  {
    capabilityId: uuid('capability_id')
      .primaryKey()
      .references(() => capabilities.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    document: text('document').notNull(),
    versionId: uuid('version_id').references(() => capabilityVersions.id, { onDelete: 'set null' }),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('capability_search_documents_org_idx').on(table.organizationId, table.refreshedAt)],
);

export const serverScanResults = pgTable(
  'server_scan_results',
  {
    jobId: uuid('job_id')
      .primaryKey()
      .references(() => operationJobs.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    publicationId: uuid('publication_id')
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    report: jsonb('report').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('server_scan_results_org_publication_uidx').on(table.organizationId, table.publicationId)],
);

export const analyticsDaily = pgTable(
  'analytics_daily',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'date' }).notNull(),
    metrics: jsonb('metrics').$type<Record<string, unknown>>().notNull().default({}),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.day] })],
);

export const auditArchives = pgTable(
  'audit_archives',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    rowCount: integer('row_count').notNull(),
    payload: jsonb('payload').notNull(),
    checksum: text('checksum').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('audit_archives_org_period_uidx').on(table.organizationId, table.periodStart, table.periodEnd),
  ],
);
