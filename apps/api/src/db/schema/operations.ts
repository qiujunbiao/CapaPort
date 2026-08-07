import { foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { capabilities } from './capabilities.js';
import { users } from './identity.js';
import { organizations } from './organizations.js';
import { outboxEvents } from './outbox.js';

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
