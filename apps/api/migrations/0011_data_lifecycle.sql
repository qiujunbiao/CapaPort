ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "organizations_status_check";
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "closure_requested_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "deletion_scheduled_at" timestamptz,
  ADD CONSTRAINT "organizations_status_check" CHECK ("status" IN ('active','closing','archived'));
CREATE INDEX IF NOT EXISTS "organizations_deletion_idx" ON "organizations" ("status","deletion_scheduled_at");

ALTER TABLE "operation_jobs" DROP CONSTRAINT IF EXISTS "operation_jobs_type_check";
ALTER TABLE "operation_jobs" ADD CONSTRAINT "operation_jobs_type_check" CHECK ("type" IN (
  'server_scan','search_refresh','version_update_notifications','daily_aggregate','audit_archive','object_cleanup',
  'lifecycle_deletion'
));

CREATE TABLE IF NOT EXISTS "account_deletion_requests" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'scheduled' CHECK ("status" IN ('scheduled','completed','cancelled')),
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "scheduled_at" timestamptz NOT NULL,
  "completed_at" timestamptz
);

CREATE TABLE IF NOT EXISTS "lifecycle_audit_events" (
  "id" uuid PRIMARY KEY,
  "scope_type" text NOT NULL CHECK ("scope_type" IN ('organization','account')),
  "scope_id" text NOT NULL,
  "actor_user_id" text,
  "action" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "lifecycle_audit_scope_idx" ON "lifecycle_audit_events" ("scope_type","scope_id","created_at");

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('capaport.audit_retention', true) = 'on'
    AND OLD.expires_at < now() THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
    AND current_setting('capaport.lifecycle_delete', true) = 'on'
    AND OLD.organization_id IS NOT NULL
    AND NEW.organization_id IS NULL
    AND NEW.actor_membership_id IS NULL
    AND NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.actor_user_id IS NOT DISTINCT FROM OLD.actor_user_id
    AND NEW.action IS NOT DISTINCT FROM OLD.action
    AND NEW.resource_type IS NOT DISTINCT FROM OLD.resource_type
    AND NEW.resource_id IS NOT DISTINCT FROM OLD.resource_id
    AND NEW.metadata IS NOT DISTINCT FROM OLD.metadata
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
    AND NEW.expires_at IS NOT DISTINCT FROM OLD.expires_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit logs are append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_lifecycle_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'lifecycle audit events are append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "lifecycle_audit_append_only" ON "lifecycle_audit_events";
CREATE TRIGGER "lifecycle_audit_append_only"
BEFORE UPDATE OR DELETE ON "lifecycle_audit_events"
FOR EACH ROW EXECUTE FUNCTION prevent_lifecycle_audit_mutation();
