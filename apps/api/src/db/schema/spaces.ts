import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity.js';
import { organizationMemberships, organizations } from './organizations.js';

export const spaces = pgTable(
  'spaces',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    reviewPolicy: text('review_policy').notNull(),
    status: text('status').notNull().default('active'),
    createdByMembershipId: uuid('created_by_membership_id')
      .notNull()
      .references(() => organizationMemberships.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('spaces_org_slug_uidx').on(table.organizationId, table.slug),
    index('spaces_org_type_status_idx').on(table.organizationId, table.type, table.status),
    index('spaces_owner_idx').on(table.organizationId, table.ownerUserId),
  ],
);

export const spaceMemberships = pgTable(
  'space_memberships',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    addedByMembershipId: uuid('added_by_membership_id')
      .notNull()
      .references(() => organizationMemberships.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('space_memberships_space_user_uidx').on(table.spaceId, table.userId),
    index('space_memberships_user_status_idx').on(table.organizationId, table.userId, table.status),
  ],
);
