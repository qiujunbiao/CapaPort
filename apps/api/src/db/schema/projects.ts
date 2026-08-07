import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { artifacts } from './capabilities.js';
import { devices } from './distribution.js';
import { users } from './identity.js';
import { organizations } from './organizations.js';
import { spaces } from './spaces.js';

export const projectBindings = pgTable(
  'project_bindings',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectSpaceId: uuid('project_space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    localBindingId: uuid('local_binding_id').notNull(),
    agents: jsonb('agents').$type<string[]>().notNull(),
    status: text('status').notNull().default('active'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('project_bindings_id_org_project_uidx').on(table.id, table.organizationId, table.projectSpaceId),
    uniqueIndex('project_bindings_local_uidx').on(
      table.organizationId,
      table.projectSpaceId,
      table.deviceId,
      table.localBindingId,
    ),
    index('project_bindings_project_user_idx').on(
      table.organizationId,
      table.projectSpaceId,
      table.userId,
      table.status,
    ),
  ],
);

export const projectContextSnapshots = pgTable(
  'project_context_snapshots',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectSpaceId: uuid('project_space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    bindingId: uuid('binding_id')
      .notNull()
      .references(() => projectBindings.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'restrict' }),
    digest: text('digest').notNull(),
    selectionDigest: text('selection_digest').notNull(),
    fileCount: integer('file_count').notNull(),
    totalBytes: integer('total_bytes').notNull(),
    agents: jsonb('agents').$type<string[]>().notNull(),
    scanEngineVersion: text('scan_engine_version').notNull(),
    scannedAt: timestamp('scanned_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('project_context_digest_uidx').on(table.organizationId, table.bindingId, table.digest),
    index('project_context_project_created_idx').on(table.organizationId, table.projectSpaceId, table.createdAt),
  ],
);
