CREATE TABLE IF NOT EXISTS "outbox_events" (
  "id" uuid PRIMARY KEY,
  "event_type" text NOT NULL,
  "aggregate_type" text NOT NULL,
  "aggregate_id" text NOT NULL,
  "organization_id" uuid,
  "payload" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "published_at" timestamptz,
  "failed_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "outbox_unpublished_idx" ON "outbox_events" ("published_at", "created_at");
