CREATE TABLE IF NOT EXISTS "organizations" (
  "id" uuid PRIMARY KEY,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'archived')),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_slug_uidx" ON "organizations" ("slug");

CREATE TABLE IF NOT EXISTS "organization_memberships" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" text NOT NULL CHECK ("role" IN ('owner', 'admin', 'auditor', 'member')),
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'disabled', 'left')),
  "joined_at" timestamptz NOT NULL DEFAULT now(),
  "disabled_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "organization_memberships_org_user_uidx" ON "organization_memberships" ("organization_id", "user_id");
CREATE INDEX IF NOT EXISTS "organization_memberships_user_idx" ON "organization_memberships" ("user_id", "status");

CREATE TABLE IF NOT EXISTS "organization_invitations" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "kind" text NOT NULL CHECK ("kind" IN ('email', 'phone')),
  "target" text NOT NULL,
  "role" text NOT NULL CHECK ("role" IN ('admin', 'auditor', 'member')),
  "token_digest" text NOT NULL,
  "invited_by_membership_id" uuid NOT NULL REFERENCES "organization_memberships"("id"),
  "expires_at" timestamptz NOT NULL,
  "accepted_at" timestamptz,
  "accepted_by_user_id" uuid REFERENCES "users"("id"),
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "organization_invitations_token_uidx" ON "organization_invitations" ("token_digest");
CREATE INDEX IF NOT EXISTS "organization_invitations_org_idx" ON "organization_invitations" ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "organization_invitations_target_idx" ON "organization_invitations" ("kind", "target", "created_at");

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
  "actor_user_id" uuid REFERENCES "users"("id"),
  "actor_membership_id" uuid REFERENCES "organization_memberships"("id"),
  "action" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "audit_logs_org_created_idx" ON "audit_logs" ("organization_id", "created_at");

ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "current_organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL;
