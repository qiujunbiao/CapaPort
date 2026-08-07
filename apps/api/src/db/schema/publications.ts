import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { capabilities, capabilityVersions, draftRevisions } from './capabilities.js';
import { users } from './identity.js';
import { organizations } from './organizations.js';
import { spaces } from './spaces.js';

export const publications = pgTable(
  'publications',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    capabilityId: uuid('capability_id')
      .notNull()
      .references(() => capabilities.id, { onDelete: 'cascade' }),
    sourceSpaceId: uuid('source_space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    targetSpaceId: uuid('target_space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    sourceRevisionId: uuid('source_revision_id').references(() => draftRevisions.id),
    sourceVersionId: uuid('source_version_id').references(() => capabilityVersions.id),
    candidateArtifactId: uuid('candidate_artifact_id').notNull(),
    candidateDigest: text('candidate_digest').notNull(),
    candidateManifest: jsonb('candidate_manifest').notNull(),
    candidateScanReport: jsonb('candidate_scan_report').notNull(),
    version: text('version').notNull(),
    reviewRequired: boolean('review_required').notNull(),
    status: text('status').notNull(),
    submittedByUserId: uuid('submitted_by_user_id')
      .notNull()
      .references(() => users.id),
    idempotencyKey: text('idempotency_key').notNull(),
    publishedVersionId: uuid('published_version_id').references(() => capabilityVersions.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('publications_submitter_idempotency_uidx').on(
      table.organizationId,
      table.submittedByUserId,
      table.idempotencyKey,
    ),
    uniqueIndex('publications_id_org_uidx').on(table.id, table.organizationId),
    index('publications_target_status_idx').on(
      table.organizationId,
      table.targetSpaceId,
      table.status,
      table.createdAt,
    ),
  ],
);

export const publicationReviews = pgTable(
  'publication_reviews',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    publicationId: uuid('publication_id')
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    reviewerUserId: uuid('reviewer_user_id')
      .notNull()
      .references(() => users.id),
    decision: text('decision').notNull(),
    reason: text('reason').notNull(),
    candidateDigest: text('candidate_digest').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('publication_reviews_publication_reviewer_uidx').on(table.publicationId, table.reviewerUserId),
    index('publication_reviews_org_idx').on(table.organizationId, table.createdAt),
  ],
);
