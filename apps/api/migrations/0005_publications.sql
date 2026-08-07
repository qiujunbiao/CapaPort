ALTER TABLE "capability_versions" DROP CONSTRAINT IF EXISTS "capability_versions_capability_scope_fk";
DROP INDEX IF EXISTS "capability_versions_capability_version_uidx";
CREATE UNIQUE INDEX IF NOT EXISTS "capabilities_id_org_uidx" ON "capabilities" ("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "capability_versions_capability_space_version_uidx"
  ON "capability_versions" ("capability_id", "space_id", "version");
CREATE UNIQUE INDEX IF NOT EXISTS "capability_versions_id_org_space_uidx"
  ON "capability_versions" ("id", "organization_id", "space_id");
CREATE UNIQUE INDEX IF NOT EXISTS "draft_revisions_id_org_space_uidx"
  ON "draft_revisions" ("id", "organization_id", "space_id");
ALTER TABLE "capability_versions"
  ADD CONSTRAINT "capability_versions_capability_org_fk" FOREIGN KEY ("capability_id", "organization_id")
    REFERENCES "capabilities" ("id", "organization_id") ON DELETE CASCADE,
  ADD CONSTRAINT "capability_versions_space_org_fk" FOREIGN KEY ("space_id", "organization_id")
    REFERENCES "spaces" ("id", "organization_id") ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS "publications" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "capability_id" uuid NOT NULL REFERENCES "capabilities"("id") ON DELETE CASCADE,
  "source_space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "target_space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "source_revision_id" uuid REFERENCES "draft_revisions"("id"),
  "source_version_id" uuid REFERENCES "capability_versions"("id"),
  "candidate_artifact_id" uuid NOT NULL REFERENCES "artifacts"("id"),
  "candidate_digest" text NOT NULL CHECK ("candidate_digest" ~ '^[a-f0-9]{64}$'),
  "candidate_manifest" jsonb NOT NULL,
  "candidate_scan_report" jsonb NOT NULL,
  "version" text NOT NULL,
  "review_required" boolean NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('in_review', 'published', 'changes_requested', 'rejected', 'withdrawn')),
  "submitted_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "idempotency_key" text NOT NULL,
  "published_version_id" uuid REFERENCES "capability_versions"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_at" timestamptz,
  CONSTRAINT "publications_one_source_check" CHECK (
    ("source_revision_id" IS NOT NULL AND "source_version_id" IS NULL) OR
    ("source_revision_id" IS NULL AND "source_version_id" IS NOT NULL)
  ),
  CONSTRAINT "publications_capability_org_fk" FOREIGN KEY ("capability_id", "organization_id")
    REFERENCES "capabilities" ("id", "organization_id") ON DELETE CASCADE,
  CONSTRAINT "publications_source_space_org_fk" FOREIGN KEY ("source_space_id", "organization_id")
    REFERENCES "spaces" ("id", "organization_id") ON DELETE CASCADE,
  CONSTRAINT "publications_target_space_org_fk" FOREIGN KEY ("target_space_id", "organization_id")
    REFERENCES "spaces" ("id", "organization_id") ON DELETE CASCADE,
  CONSTRAINT "publications_revision_scope_fk" FOREIGN KEY ("source_revision_id", "organization_id", "source_space_id")
    REFERENCES "draft_revisions" ("id", "organization_id", "space_id"),
  CONSTRAINT "publications_source_version_scope_fk" FOREIGN KEY ("source_version_id", "organization_id", "source_space_id")
    REFERENCES "capability_versions" ("id", "organization_id", "space_id"),
  CONSTRAINT "publications_artifact_org_fk" FOREIGN KEY ("candidate_artifact_id", "organization_id")
    REFERENCES "artifacts" ("id", "organization_id"),
  CONSTRAINT "publications_published_version_scope_fk" FOREIGN KEY ("published_version_id", "organization_id", "target_space_id")
    REFERENCES "capability_versions" ("id", "organization_id", "space_id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "publications_submitter_idempotency_uidx"
  ON "publications" ("organization_id", "submitted_by_user_id", "idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "publications_id_org_uidx" ON "publications" ("id", "organization_id");
CREATE INDEX IF NOT EXISTS "publications_target_status_idx"
  ON "publications" ("organization_id", "target_space_id", "status", "created_at");

CREATE OR REPLACE FUNCTION prevent_publication_candidate_mutation() RETURNS trigger AS $$
BEGIN
  IF NEW.organization_id <> OLD.organization_id OR NEW.capability_id <> OLD.capability_id OR
     NEW.source_space_id <> OLD.source_space_id OR NEW.target_space_id <> OLD.target_space_id OR
     NEW.source_revision_id IS DISTINCT FROM OLD.source_revision_id OR
     NEW.source_version_id IS DISTINCT FROM OLD.source_version_id OR
     NEW.candidate_artifact_id <> OLD.candidate_artifact_id OR
     NEW.candidate_digest <> OLD.candidate_digest OR NEW.candidate_manifest <> OLD.candidate_manifest OR
     NEW.candidate_scan_report <> OLD.candidate_scan_report OR NEW.version <> OLD.version OR
     NEW.review_required <> OLD.review_required OR NEW.submitted_by_user_id <> OLD.submitted_by_user_id OR
     NEW.idempotency_key <> OLD.idempotency_key OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'publication candidate is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "publications_candidate_immutable" ON "publications";
CREATE TRIGGER "publications_candidate_immutable"
BEFORE UPDATE ON "publications"
FOR EACH ROW EXECUTE FUNCTION prevent_publication_candidate_mutation();

CREATE TABLE IF NOT EXISTS "publication_reviews" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "publication_id" uuid NOT NULL REFERENCES "publications"("id") ON DELETE CASCADE,
  "reviewer_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "decision" text NOT NULL CHECK ("decision" IN ('approve', 'request_changes', 'reject')),
  "reason" text NOT NULL,
  "candidate_digest" text NOT NULL CHECK ("candidate_digest" ~ '^[a-f0-9]{64}$'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "publication_reviews_publication_org_fk" FOREIGN KEY ("publication_id", "organization_id")
    REFERENCES "publications" ("id", "organization_id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "publication_reviews_publication_reviewer_uidx"
  ON "publication_reviews" ("publication_id", "reviewer_user_id");
CREATE INDEX IF NOT EXISTS "publication_reviews_org_idx" ON "publication_reviews" ("organization_id", "created_at");
