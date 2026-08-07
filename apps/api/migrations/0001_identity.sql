CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY,
  "display_name" text NOT NULL,
  "password_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user_identities" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" text NOT NULL CHECK ("kind" IN ('email', 'phone')),
  "normalized_value" text NOT NULL,
  "verified_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_identities_kind_value_uidx" ON "user_identities" ("kind", "normalized_value");
CREATE INDEX IF NOT EXISTS "user_identities_user_idx" ON "user_identities" ("user_id");

CREATE TABLE IF NOT EXISTS "verification_challenges" (
  "id" uuid PRIMARY KEY,
  "purpose" text NOT NULL CHECK ("purpose" IN ('verify_identity', 'recover_password')),
  "kind" text NOT NULL CHECK ("kind" IN ('email', 'phone')),
  "target" text NOT NULL,
  "code_digest" text NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "identity_id" uuid REFERENCES "user_identities"("id") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "attempts" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "verification_target_idx" ON "verification_challenges" ("kind", "target", "purpose", "created_at");

CREATE TABLE IF NOT EXISTS "sessions" (
  "id" uuid PRIMARY KEY,
  "family_id" uuid NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "device_name" text NOT NULL,
  "ip_hash" text,
  "user_agent" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "last_used_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "revocation_reason" text
);
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "sessions_family_idx" ON "sessions" ("family_id");

CREATE TABLE IF NOT EXISTS "refresh_tokens" (
  "id" uuid PRIMARY KEY,
  "session_id" uuid NOT NULL REFERENCES "sessions"("id") ON DELETE CASCADE,
  "family_id" uuid NOT NULL,
  "token_digest" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_digest_uidx" ON "refresh_tokens" ("token_digest");
CREATE INDEX IF NOT EXISTS "refresh_tokens_family_idx" ON "refresh_tokens" ("family_id");
CREATE INDEX IF NOT EXISTS "refresh_tokens_session_idx" ON "refresh_tokens" ("session_id");

CREATE TABLE IF NOT EXISTS "login_attempts" (
  "id" uuid PRIMARY KEY,
  "identity_digest" text NOT NULL,
  "successful" boolean NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "login_attempts_identity_idx" ON "login_attempts" ("identity_digest", "created_at");
