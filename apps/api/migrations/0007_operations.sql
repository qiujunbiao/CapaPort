ALTER TABLE "outbox_events"
  ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "available_at" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "last_error" text;

ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "expires_at" timestamptz NOT NULL DEFAULT (now() + interval '7 years');
CREATE INDEX IF NOT EXISTS "audit_logs_retention_idx" ON "audit_logs" ("expires_at");

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('agentdoor.audit_retention', true) = 'on'
    AND OLD.expires_at < now() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit logs are append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "audit_logs_append_only" ON "audit_logs";
CREATE TRIGGER "audit_logs_append_only"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "source_event_id" uuid NOT NULL REFERENCES "outbox_events"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "read_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "notifications_membership_fk" FOREIGN KEY ("organization_id","user_id")
    REFERENCES "organization_memberships"("organization_id","user_id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_event_user_uidx" ON "notifications" ("source_event_id","user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_id_org_user_uidx"
  ON "notifications" ("id","organization_id","user_id");
CREATE INDEX IF NOT EXISTS "notifications_inbox_idx"
  ON "notifications" ("organization_id","user_id","read_at","created_at");

CREATE TABLE IF NOT EXISTS "notification_deliveries" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "notification_id" uuid NOT NULL REFERENCES "notifications"("id") ON DELETE CASCADE,
  "source_event_id" uuid NOT NULL REFERENCES "outbox_events"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "channel" text NOT NULL CHECK ("channel" IN ('email','sms')),
  "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','delivered','failed','dead_letter')),
  "attempts" integer NOT NULL DEFAULT 0,
  "error_code" text,
  "delivered_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "notification_deliveries_notification_tenant_fk"
    FOREIGN KEY ("notification_id","organization_id","user_id")
    REFERENCES "notifications"("id","organization_id","user_id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "notification_deliveries_event_user_channel_uidx"
  ON "notification_deliveries" ("source_event_id","user_id","channel");
CREATE INDEX IF NOT EXISTS "notification_deliveries_status_idx"
  ON "notification_deliveries" ("status","updated_at");

CREATE TABLE IF NOT EXISTS "product_events" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "actor_digest" text NOT NULL CHECK ("actor_digest" ~ '^[a-f0-9]{64}$'),
  "event_name" text NOT NULL CHECK ("event_name" IN (
    'agent.discovered','capability.imported','publication.started','capability.installed',
    'capability.updated','capability.uninstalled'
  )),
  "capability_id" uuid REFERENCES "capabilities"("id") ON DELETE CASCADE,
  "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "product_events_capability_org_fk" FOREIGN KEY ("capability_id","organization_id")
    REFERENCES "capabilities"("id","organization_id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "product_events_metrics_idx"
  ON "product_events" ("organization_id","event_name","occurred_at");
CREATE INDEX IF NOT EXISTS "product_events_retention_idx" ON "product_events" ("expires_at");
