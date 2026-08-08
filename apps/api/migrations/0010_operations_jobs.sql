CREATE TABLE IF NOT EXISTS "operation_jobs" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
  "type" text NOT NULL CHECK ("type" IN (
    'server_scan','search_refresh','version_update_notifications','daily_aggregate','audit_archive','object_cleanup'
  )),
  "dedup_key" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','running','completed','dead_letter')),
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 5 CHECK ("max_attempts" BETWEEN 1 AND 20),
  "available_at" timestamptz NOT NULL DEFAULT now(),
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "operation_jobs_type_dedup_uidx" ON "operation_jobs" ("type","dedup_key");
CREATE INDEX IF NOT EXISTS "operation_jobs_ready_idx" ON "operation_jobs" ("status","available_at","created_at");
CREATE INDEX IF NOT EXISTS "operation_jobs_org_dead_idx" ON "operation_jobs" ("organization_id","status","updated_at");

CREATE TABLE IF NOT EXISTS "server_scan_results" (
  "job_id" uuid PRIMARY KEY REFERENCES "operation_jobs"("id") ON DELETE CASCADE,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "publication_id" uuid NOT NULL REFERENCES "publications"("id") ON DELETE CASCADE,
  "status" text NOT NULL CHECK ("status" IN ('passed','blocked')),
  "report" jsonb NOT NULL,
  "completed_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("organization_id","publication_id")
);

CREATE TABLE IF NOT EXISTS "capability_search_documents" (
  "capability_id" uuid PRIMARY KEY REFERENCES "capabilities"("id") ON DELETE CASCADE,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "document" text NOT NULL,
  "version_id" uuid REFERENCES "capability_versions"("id") ON DELETE SET NULL,
  "refreshed_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "capability_search_documents_org_idx"
  ON "capability_search_documents" ("organization_id","refreshed_at");

CREATE TABLE IF NOT EXISTS "analytics_daily" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "day" date NOT NULL,
  "metrics" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "computed_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("organization_id","day")
);

CREATE TABLE IF NOT EXISTS "audit_archives" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "period_start" timestamptz NOT NULL,
  "period_end" timestamptz NOT NULL,
  "row_count" integer NOT NULL,
  "payload" jsonb NOT NULL,
  "checksum" text NOT NULL CHECK ("checksum" ~ '^[a-f0-9]{32}$'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("organization_id","period_start","period_end")
);
