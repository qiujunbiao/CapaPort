import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const userIdentities = pgTable(
  'user_identities',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    normalizedValue: text('normalized_value').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('user_identities_kind_value_uidx').on(table.kind, table.normalizedValue),
    index('user_identities_user_idx').on(table.userId),
  ],
);

export const verificationChallenges = pgTable(
  'verification_challenges',
  {
    id: uuid('id').primaryKey(),
    purpose: text('purpose').notNull(),
    kind: text('kind').notNull(),
    target: text('target').notNull(),
    codeDigest: text('code_digest').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    identityId: uuid('identity_id').references(() => userIdentities.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('verification_target_idx').on(table.kind, table.target, table.purpose, table.createdAt)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    familyId: uuid('family_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceName: text('device_name').notNull(),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revocationReason: text('revocation_reason'),
    currentOrganizationId: uuid('current_organization_id'),
  },
  (table) => [
    index('sessions_user_idx').on(table.userId, table.createdAt),
    index('sessions_family_idx').on(table.familyId),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenDigest: text('token_digest').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('refresh_tokens_digest_uidx').on(table.tokenDigest),
    index('refresh_tokens_family_idx').on(table.familyId),
    index('refresh_tokens_session_idx').on(table.sessionId),
  ],
);

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: uuid('id').primaryKey(),
    identityDigest: text('identity_digest').notNull(),
    successful: boolean('successful').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('login_attempts_identity_idx').on(table.identityDigest, table.createdAt)],
);
