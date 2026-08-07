CREATE TABLE IF NOT EXISTS "artifacts" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "sha256" text NOT NULL CHECK ("sha256" ~ '^[a-f0-9]{64}$'),
  "size_bytes" bigint NOT NULL CHECK ("size_bytes" > 0 AND "size_bytes" <= 52428800),
  "object_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ready' CHECK ("status" IN ('ready', 'quarantined')),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "artifacts_org_digest_uidx" ON "artifacts" ("organization_id", "sha256");
CREATE UNIQUE INDEX IF NOT EXISTS "artifacts_object_key_uidx" ON "artifacts" ("object_key");
CREATE UNIQUE INDEX IF NOT EXISTS "artifacts_id_org_uidx" ON "artifacts" ("id", "organization_id");

CREATE TABLE IF NOT EXISTS "artifact_uploads" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "requested_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "original_name" text NOT NULL,
  "content_type" text NOT NULL CHECK ("content_type" = 'application/zip'),
  "declared_size_bytes" bigint NOT NULL CHECK ("declared_size_bytes" > 0 AND "declared_size_bytes" <= 52428800),
  "declared_sha256" text NOT NULL CHECK ("declared_sha256" ~ '^[a-f0-9]{64}$'),
  "object_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'confirmed', 'failed', 'expired')),
  "artifact_id" uuid REFERENCES "artifacts"("id"),
  "failure_code" text,
  "expires_at" timestamptz NOT NULL,
  "confirmed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "artifact_uploads_space_org_fk" FOREIGN KEY ("space_id", "organization_id")
    REFERENCES "spaces" ("id", "organization_id") ON DELETE CASCADE,
  CONSTRAINT "artifact_uploads_artifact_org_fk" FOREIGN KEY ("artifact_id", "organization_id")
    REFERENCES "artifacts" ("id", "organization_id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "artifact_uploads_object_key_uidx" ON "artifact_uploads" ("object_key");
CREATE INDEX IF NOT EXISTS "artifact_uploads_expiry_idx" ON "artifact_uploads" ("status", "expires_at");
CREATE INDEX IF NOT EXISTS "artifact_uploads_user_idx" ON "artifact_uploads" ("organization_id", "requested_by_user_id", "created_at");

CREATE TABLE IF NOT EXISTS "capabilities" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "slug" text NOT NULL CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  "name" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "compatibility" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "owner_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "forked_from_version_id" uuid,
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'archived')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "capabilities_space_org_fk" FOREIGN KEY ("space_id", "organization_id")
    REFERENCES "spaces" ("id", "organization_id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "capabilities_org_slug_uidx" ON "capabilities" ("organization_id", "slug");
CREATE UNIQUE INDEX IF NOT EXISTS "capabilities_id_org_space_uidx" ON "capabilities" ("id", "organization_id", "space_id");
CREATE INDEX IF NOT EXISTS "capabilities_search_idx" ON "capabilities" ("organization_id", "status", "name");
CREATE INDEX IF NOT EXISTS "capabilities_tags_gin_idx" ON "capabilities" USING gin ("tags");
CREATE INDEX IF NOT EXISTS "capabilities_compatibility_gin_idx" ON "capabilities" USING gin ("compatibility");

CREATE TABLE IF NOT EXISTS "capability_drafts" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "capability_id" uuid NOT NULL REFERENCES "capabilities"("id") ON DELETE CASCADE,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "status" text NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'ready', 'blocked', 'submitted')),
  "current_revision_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "capability_drafts_capability_scope_fk" FOREIGN KEY ("capability_id", "organization_id", "space_id")
    REFERENCES "capabilities" ("id", "organization_id", "space_id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "capability_drafts_id_org_space_uidx" ON "capability_drafts" ("id", "organization_id", "space_id");
CREATE INDEX IF NOT EXISTS "capability_drafts_capability_idx" ON "capability_drafts" ("organization_id", "capability_id", "updated_at");

CREATE TABLE IF NOT EXISTS "draft_revisions" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "draft_id" uuid NOT NULL REFERENCES "capability_drafts"("id") ON DELETE CASCADE,
  "sequence" integer NOT NULL CHECK ("sequence" > 0),
  "artifact_id" uuid NOT NULL REFERENCES "artifacts"("id"),
  "content_digest" text NOT NULL CHECK ("content_digest" ~ '^[a-f0-9]{64}$'),
  "manifest" jsonb NOT NULL,
  "scan_status" text NOT NULL CHECK ("scan_status" IN ('passed', 'blocked')),
  "scan_report" jsonb NOT NULL,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "draft_revisions_draft_scope_fk" FOREIGN KEY ("draft_id", "organization_id", "space_id")
    REFERENCES "capability_drafts" ("id", "organization_id", "space_id") ON DELETE CASCADE,
  CONSTRAINT "draft_revisions_artifact_org_fk" FOREIGN KEY ("artifact_id", "organization_id")
    REFERENCES "artifacts" ("id", "organization_id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "draft_revisions_draft_sequence_uidx" ON "draft_revisions" ("draft_id", "sequence");
CREATE UNIQUE INDEX IF NOT EXISTS "draft_revisions_id_scope_uidx" ON "draft_revisions" ("id", "organization_id", "space_id", "draft_id");
CREATE INDEX IF NOT EXISTS "draft_revisions_digest_idx" ON "draft_revisions" ("organization_id", "content_digest");

ALTER TABLE "capability_drafts"
  ADD CONSTRAINT "capability_drafts_current_revision_scope_fk"
  FOREIGN KEY ("current_revision_id", "organization_id", "space_id", "id")
  REFERENCES "draft_revisions"("id", "organization_id", "space_id", "draft_id");

CREATE TABLE IF NOT EXISTS "capability_versions" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "capability_id" uuid NOT NULL REFERENCES "capabilities"("id") ON DELETE CASCADE,
  "version" text NOT NULL,
  "artifact_id" uuid NOT NULL REFERENCES "artifacts"("id"),
  "content_digest" text NOT NULL CHECK ("content_digest" ~ '^[a-f0-9]{64}$'),
  "manifest" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'published' CHECK ("status" IN ('published', 'deprecated', 'withdrawn', 'archived')),
  "published_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "capability_versions_capability_scope_fk" FOREIGN KEY ("capability_id", "organization_id", "space_id")
    REFERENCES "capabilities" ("id", "organization_id", "space_id") ON DELETE CASCADE,
  CONSTRAINT "capability_versions_artifact_org_fk" FOREIGN KEY ("artifact_id", "organization_id")
    REFERENCES "artifacts" ("id", "organization_id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "capability_versions_capability_version_uidx" ON "capability_versions" ("capability_id", "version");
CREATE INDEX IF NOT EXISTS "capability_versions_org_digest_idx" ON "capability_versions" ("organization_id", "content_digest");

ALTER TABLE "capabilities"
  ADD CONSTRAINT "capabilities_fork_version_fk" FOREIGN KEY ("forked_from_version_id")
  REFERENCES "capability_versions"("id") ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION prevent_capability_version_content_mutation() RETURNS trigger AS $$
BEGIN
  IF NEW.organization_id <> OLD.organization_id OR NEW.space_id <> OLD.space_id OR
     NEW.capability_id <> OLD.capability_id OR NEW.version <> OLD.version OR
     NEW.artifact_id <> OLD.artifact_id OR NEW.content_digest <> OLD.content_digest OR
     NEW.manifest <> OLD.manifest OR NEW.published_at <> OLD.published_at THEN
    RAISE EXCEPTION 'capability version content is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "capability_versions_immutable" ON "capability_versions";
CREATE TRIGGER "capability_versions_immutable"
BEFORE UPDATE ON "capability_versions"
FOR EACH ROW EXECUTE FUNCTION prevent_capability_version_content_mutation();
