CREATE TABLE organization_security_policies (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  blocked_severities jsonb NOT NULL DEFAULT '["high","critical"]'::jsonb,
  confirmation_severities jsonb NOT NULL DEFAULT '["medium"]'::jsonb,
  blocked_terms jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_executable_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_network_hosts jsonb NOT NULL DEFAULT '[]'::jsonb,
  executable_policy text NOT NULL DEFAULT 'confirm'
    CHECK (executable_policy IN ('deny', 'confirm', 'allow-listed')),
  updated_by_membership_id uuid NOT NULL REFERENCES organization_memberships(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
