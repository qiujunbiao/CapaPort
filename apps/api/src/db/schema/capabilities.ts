import { bigint, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity.js';
import { organizations } from './organizations.js';
import { spaces } from './spaces.js';

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    sha256: text('sha256').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    objectKey: text('object_key').notNull(),
    status: text('status').notNull().default('ready'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('artifacts_org_digest_uidx').on(table.organizationId, table.sha256),
    uniqueIndex('artifacts_object_key_uidx').on(table.objectKey),
  ],
);

export const artifactUploads = pgTable(
  'artifact_uploads',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    requestedByUserId: uuid('requested_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    originalName: text('original_name').notNull(),
    contentType: text('content_type').notNull(),
    declaredSizeBytes: bigint('declared_size_bytes', { mode: 'number' }).notNull(),
    declaredSha256: text('declared_sha256').notNull(),
    objectKey: text('object_key').notNull(),
    status: text('status').notNull().default('pending'),
    artifactId: uuid('artifact_id').references(() => artifacts.id),
    failureCode: text('failure_code'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('artifact_uploads_object_key_uidx').on(table.objectKey),
    index('artifact_uploads_expiry_idx').on(table.status, table.expiresAt),
    index('artifact_uploads_user_idx').on(table.organizationId, table.requestedByUserId, table.createdAt),
  ],
);

export const capabilities = pgTable(
  'capabilities',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    compatibility: jsonb('compatibility').$type<string[]>().notNull().default([]),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    forkedFromVersionId: uuid('forked_from_version_id'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('capabilities_org_slug_uidx').on(table.organizationId, table.slug),
    uniqueIndex('capabilities_id_org_space_uidx').on(table.id, table.organizationId, table.spaceId),
    index('capabilities_search_idx').on(table.organizationId, table.status, table.name),
  ],
);

export const capabilityDrafts = pgTable(
  'capability_drafts',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    capabilityId: uuid('capability_id')
      .notNull()
      .references(() => capabilities.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    status: text('status').notNull().default('draft'),
    currentRevisionId: uuid('current_revision_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('capability_drafts_id_org_space_uidx').on(table.id, table.organizationId, table.spaceId),
    index('capability_drafts_capability_idx').on(table.organizationId, table.capabilityId, table.updatedAt),
  ],
);

export const draftRevisions = pgTable(
  'draft_revisions',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    draftId: uuid('draft_id')
      .notNull()
      .references(() => capabilityDrafts.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id),
    contentDigest: text('content_digest').notNull(),
    manifest: jsonb('manifest').notNull(),
    scanStatus: text('scan_status').notNull(),
    scanReport: jsonb('scan_report').notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('draft_revisions_draft_sequence_uidx').on(table.draftId, table.sequence),
    index('draft_revisions_digest_idx').on(table.organizationId, table.contentDigest),
  ],
);

export const capabilityVersions = pgTable(
  'capability_versions',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    capabilityId: uuid('capability_id')
      .notNull()
      .references(() => capabilities.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id),
    contentDigest: text('content_digest').notNull(),
    manifest: jsonb('manifest').notNull(),
    status: text('status').notNull().default('published'),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('capability_versions_capability_version_uidx').on(table.capabilityId, table.version),
    index('capability_versions_org_digest_idx').on(table.organizationId, table.contentDigest),
  ],
);
