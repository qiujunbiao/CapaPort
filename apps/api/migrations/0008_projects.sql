CREATE TABLE IF NOT EXISTS "project_bindings" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "project_space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "device_id" uuid NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
  "local_binding_id" uuid NOT NULL,
  "agents" jsonb NOT NULL CHECK (jsonb_typeof("agents") = 'array'),
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active','removed')),
  "last_synced_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "project_bindings_project_org_fk" FOREIGN KEY ("project_space_id","organization_id")
    REFERENCES "spaces"("id","organization_id") ON DELETE CASCADE,
  CONSTRAINT "project_bindings_device_owner_fk" FOREIGN KEY ("device_id","organization_id","user_id")
    REFERENCES "devices"("id","organization_id","user_id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "project_bindings_id_org_project_uidx"
  ON "project_bindings" ("id","organization_id","project_space_id");
CREATE UNIQUE INDEX IF NOT EXISTS "project_bindings_local_uidx"
  ON "project_bindings" ("organization_id","project_space_id","device_id","local_binding_id");
CREATE INDEX IF NOT EXISTS "project_bindings_project_user_idx"
  ON "project_bindings" ("organization_id","project_space_id","user_id","status");

CREATE TABLE IF NOT EXISTS "project_context_snapshots" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "project_space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "binding_id" uuid NOT NULL REFERENCES "project_bindings"("id") ON DELETE CASCADE,
  "device_id" uuid NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
  "artifact_id" uuid NOT NULL REFERENCES "artifacts"("id") ON DELETE RESTRICT,
  "digest" text NOT NULL CHECK ("digest" ~ '^[a-f0-9]{64}$'),
  "selection_digest" text NOT NULL CHECK ("selection_digest" ~ '^[a-f0-9]{64}$'),
  "file_count" integer NOT NULL CHECK ("file_count" BETWEEN 1 AND 1000),
  "total_bytes" integer NOT NULL CHECK ("total_bytes" BETWEEN 1 AND 4000000),
  "agents" jsonb NOT NULL CHECK (jsonb_typeof("agents") = 'array'),
  "scan_engine_version" text NOT NULL,
  "scanned_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "project_context_binding_scope_fk" FOREIGN KEY ("binding_id","organization_id","project_space_id")
    REFERENCES "project_bindings"("id","organization_id","project_space_id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "project_context_digest_uidx"
  ON "project_context_snapshots" ("organization_id","binding_id","digest");
CREATE INDEX IF NOT EXISTS "project_context_project_created_idx"
  ON "project_context_snapshots" ("organization_id","project_space_id","created_at");
