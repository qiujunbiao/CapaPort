CREATE UNIQUE INDEX IF NOT EXISTS "organization_memberships_id_org_uidx"
  ON "organization_memberships" ("id", "organization_id");

CREATE TABLE IF NOT EXISTS "spaces" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "type" text NOT NULL CHECK ("type" IN ('personal', 'team', 'project', 'organization')),
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "owner_user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "review_policy" text NOT NULL CHECK ("review_policy" IN ('direct', 'required')),
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'archived')),
  "created_by_membership_id" uuid NOT NULL REFERENCES "organization_memberships"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "spaces_creator_org_fk" FOREIGN KEY ("created_by_membership_id", "organization_id")
    REFERENCES "organization_memberships" ("id", "organization_id"),
  CONSTRAINT "spaces_type_policy_check" CHECK (
    ("type" = 'personal' AND "owner_user_id" IS NOT NULL AND "review_policy" = 'direct') OR
    ("type" = 'organization' AND "owner_user_id" IS NULL AND "review_policy" = 'required') OR
    ("type" IN ('team', 'project') AND "owner_user_id" IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "spaces_org_slug_uidx" ON "spaces" ("organization_id", "slug");
CREATE UNIQUE INDEX IF NOT EXISTS "spaces_id_org_uidx" ON "spaces" ("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "spaces_personal_owner_uidx" ON "spaces" ("organization_id", "owner_user_id") WHERE "type" = 'personal';
CREATE UNIQUE INDEX IF NOT EXISTS "spaces_organization_singleton_uidx" ON "spaces" ("organization_id") WHERE "type" = 'organization';
CREATE INDEX IF NOT EXISTS "spaces_org_type_status_idx" ON "spaces" ("organization_id", "type", "status");
CREATE INDEX IF NOT EXISTS "spaces_owner_idx" ON "spaces" ("organization_id", "owner_user_id");

CREATE TABLE IF NOT EXISTS "space_memberships" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" text NOT NULL CHECK ("role" IN ('manager', 'reviewer', 'contributor', 'viewer')),
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'disabled')),
  "added_by_membership_id" uuid NOT NULL REFERENCES "organization_memberships"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "space_memberships_space_org_fk" FOREIGN KEY ("space_id", "organization_id")
    REFERENCES "spaces" ("id", "organization_id") ON DELETE CASCADE,
  CONSTRAINT "space_memberships_user_org_fk" FOREIGN KEY ("organization_id", "user_id")
    REFERENCES "organization_memberships" ("organization_id", "user_id"),
  CONSTRAINT "space_memberships_actor_org_fk" FOREIGN KEY ("added_by_membership_id", "organization_id")
    REFERENCES "organization_memberships" ("id", "organization_id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "space_memberships_space_user_uidx" ON "space_memberships" ("space_id", "user_id");
CREATE INDEX IF NOT EXISTS "space_memberships_user_status_idx" ON "space_memberships" ("organization_id", "user_id", "status");

INSERT INTO "spaces" (id, organization_id, type, name, slug, review_policy, created_by_membership_id)
SELECT gen_random_uuid(), o.id, 'organization', o.name, 'organization', 'required', m.id
FROM organizations o
JOIN LATERAL (
  SELECT id FROM organization_memberships
  WHERE organization_id=o.id AND status='active'
  ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, joined_at
  LIMIT 1
) m ON true
ON CONFLICT DO NOTHING;

INSERT INTO "spaces" (id, organization_id, type, name, slug, owner_user_id, review_policy, created_by_membership_id)
SELECT gen_random_uuid(), m.organization_id, 'personal', u.display_name || '''s space',
       'personal-' || replace(m.user_id::text, '-', ''), m.user_id, 'direct', m.id
FROM organization_memberships m
JOIN users u ON u.id=m.user_id
WHERE m.status='active'
ON CONFLICT DO NOTHING;

INSERT INTO "space_memberships" (id, organization_id, space_id, user_id, role, status, added_by_membership_id)
SELECT gen_random_uuid(), s.organization_id, s.id, s.owner_user_id, 'manager', 'active', m.id
FROM spaces s
JOIN organization_memberships m ON m.organization_id=s.organization_id AND m.user_id=s.owner_user_id
WHERE s.type='personal'
ON CONFLICT (space_id,user_id) DO NOTHING;
