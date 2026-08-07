CREATE TABLE IF NOT EXISTS "devices" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "platform" text NOT NULL CHECK ("platform" IN ('macos','windows','linux')),
  "app_version" text NOT NULL,
  "supported_agents" jsonb NOT NULL CHECK (jsonb_typeof("supported_agents") = 'array'),
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active','revoked')),
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "devices_id_org_user_uidx" ON "devices" ("id","organization_id","user_id");
CREATE INDEX IF NOT EXISTS "devices_owner_idx" ON "devices" ("organization_id","user_id","status","updated_at");

CREATE UNIQUE INDEX IF NOT EXISTS "capability_versions_id_org_uidx"
  ON "capability_versions" ("id","organization_id");

CREATE TABLE IF NOT EXISTS "installations" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "device_id" uuid NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
  "capability_id" uuid NOT NULL REFERENCES "capabilities"("id") ON DELETE CASCADE,
  "version_id" uuid NOT NULL REFERENCES "capability_versions"("id") ON DELETE CASCADE,
  "version_space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "installed_digest" text NOT NULL CHECK ("installed_digest" ~ '^[a-f0-9]{64}$'),
  "agent" text NOT NULL CHECK ("agent" IN ('codex','claude-code','cursor','gemini-cli')),
  "status" text NOT NULL CHECK ("status" IN ('installed','failed','uninstalled')),
  "failure_code" text,
  "idempotency_key" text NOT NULL,
  "installed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "installations_failure_shape_check" CHECK (
    ("status" = 'failed' AND "failure_code" IS NOT NULL) OR
    ("status" <> 'failed' AND "failure_code" IS NULL)
  ),
  CONSTRAINT "installations_device_owner_fk" FOREIGN KEY ("device_id","organization_id","user_id")
    REFERENCES "devices"("id","organization_id","user_id") ON DELETE CASCADE,
  CONSTRAINT "installations_capability_org_fk" FOREIGN KEY ("capability_id","organization_id")
    REFERENCES "capabilities"("id","organization_id") ON DELETE CASCADE,
  CONSTRAINT "installations_version_scope_fk" FOREIGN KEY ("version_id","organization_id","version_space_id")
    REFERENCES "capability_versions"("id","organization_id","space_id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "installations_user_idempotency_uidx"
  ON "installations" ("organization_id","user_id","idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "installations_id_org_user_uidx"
  ON "installations" ("id","organization_id","user_id");
CREATE INDEX IF NOT EXISTS "installations_device_idx" ON "installations" ("organization_id","device_id","updated_at");
CREATE INDEX IF NOT EXISTS "installations_capability_idx"
  ON "installations" ("organization_id","capability_id","updated_at");

CREATE TABLE IF NOT EXISTS "installation_analytics" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "capability_id" uuid NOT NULL REFERENCES "capabilities"("id") ON DELETE CASCADE,
  "version_id" uuid NOT NULL REFERENCES "capability_versions"("id") ON DELETE CASCADE,
  "agent" text NOT NULL CHECK ("agent" IN ('codex','claude-code','cursor','gemini-cli')),
  "outcome" text NOT NULL CHECK ("outcome" IN ('installed','failed','uninstalled')),
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "installation_analytics_capability_org_fk" FOREIGN KEY ("capability_id","organization_id")
    REFERENCES "capabilities"("id","organization_id") ON DELETE CASCADE,
  CONSTRAINT "installation_analytics_version_org_fk" FOREIGN KEY ("version_id","organization_id")
    REFERENCES "capability_versions"("id","organization_id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "installation_analytics_rollup_idx"
  ON "installation_analytics" ("organization_id","occurred_at");
