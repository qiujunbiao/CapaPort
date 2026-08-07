import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { capabilities, capabilityVersions } from './capabilities.js';
import { users } from './identity.js';
import { organizations } from './organizations.js';
import { spaces } from './spaces.js';

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    platform: text('platform').notNull(),
    appVersion: text('app_version').notNull(),
    supportedAgents: jsonb('supported_agents').$type<string[]>().notNull(),
    status: text('status').notNull().default('active'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('devices_id_org_user_uidx').on(table.id, table.organizationId, table.userId),
    index('devices_owner_idx').on(table.organizationId, table.userId, table.status, table.updatedAt),
  ],
);

export const installations = pgTable(
  'installations',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    capabilityId: uuid('capability_id')
      .notNull()
      .references(() => capabilities.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => capabilityVersions.id, { onDelete: 'cascade' }),
    versionSpaceId: uuid('version_space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    installedDigest: text('installed_digest').notNull(),
    agent: text('agent').notNull(),
    status: text('status').notNull(),
    failureCode: text('failure_code'),
    idempotencyKey: text('idempotency_key').notNull(),
    installedAt: timestamp('installed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('installations_user_idempotency_uidx').on(table.organizationId, table.userId, table.idempotencyKey),
    uniqueIndex('installations_id_org_user_uidx').on(table.id, table.organizationId, table.userId),
    index('installations_device_idx').on(table.organizationId, table.deviceId, table.updatedAt),
    index('installations_capability_idx').on(table.organizationId, table.capabilityId, table.updatedAt),
  ],
);

export const installationAnalytics = pgTable(
  'installation_analytics',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    capabilityId: uuid('capability_id')
      .notNull()
      .references(() => capabilities.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => capabilityVersions.id, { onDelete: 'cascade' }),
    agent: text('agent').notNull(),
    outcome: text('outcome').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('installation_analytics_rollup_idx').on(table.organizationId, table.occurredAt)],
);
