# CapaPort Desktop Governance Superset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the native Desktop application a tested functional superset of the Web administration console while preserving all existing local workflows.

**Architecture:** Add a shared product-capability inventory and published-capability predicate to contracts, extend Desktop's explicit-session cloud client with every Web governance endpoint, and add role-gated native Desktop governance pages. Keep server authorization authoritative and keep Web/Desktop application source independent.

**Tech Stack:** TypeScript 7, React 19, TanStack Query 5, Vitest, Testing Library, Playwright, NestJS API, Tauri 2.

## Global Constraints

- Preserve the invariant `Desktop capabilities ⊇ Web capabilities` with an automated contract test.
- Desktop Capability Library, Desktop Home, and Web Capability Market show only capabilities with an installable published/deprecated version.
- Owner and Admin may review their own submissions when authorized for the target space.
- Review decisions require candidate metadata, server scan report, structured diff, and a reason of at least three characters.
- Every organization mutation remains authorized and organization-scoped on the server.
- Preserve all unrelated user changes in the dirty worktree.
- Use test-first RED/GREEN cycles for every behavior change.

---

### Task 1: Shared Capability Inventory and Market Visibility

**Files:**
- Create: `packages/contracts/src/product-capabilities.ts`
- Create: `packages/contracts/src/product-capabilities.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/desktop/src/features/agents/home-page.tsx`
- Create: `apps/desktop/src/features/agents/home-page.test.tsx`
- Modify: `apps/web/src/features/marketplace/marketplace-page.tsx`
- Create: `apps/web/src/features/marketplace/marketplace-page.test.tsx`

**Interfaces:**
- Produces: `WEB_GOVERNANCE_CAPABILITIES`, `DESKTOP_PRODUCT_CAPABILITIES`, and `isInstallableCapability(capability)`.
- Consumes: `CapabilitySummary.hasPublishedVersion` from `@capaport/contracts`.

- [ ] **Step 1: Write failing contract and visibility tests**

```ts
expect(WEB_GOVERNANCE_CAPABILITIES.every((id) => DESKTOP_PRODUCT_CAPABILITIES.includes(id))).toBe(true);
expect(screen.queryByText('审核中能力')).not.toBeInTheDocument();
expect(screen.getByText('已发布能力')).toBeInTheDocument();
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @capaport/contracts test && pnpm --filter @capaport/desktop test -- home-page.test.tsx && pnpm --filter @capaport/web test -- marketplace-page.test.tsx`

Expected: failures because the shared inventory/predicate and filtering do not exist.

- [ ] **Step 3: Implement stable inventory and shared predicate**

```ts
export const WEB_GOVERNANCE_CAPABILITIES = [
  'organization.overview', 'capability.assets', 'publication.review', 'organization.members',
  'organization.spaces', 'organization.security', 'organization.audit', 'organization.analytics',
  'organization.settings',
] as const;

export const DESKTOP_PRODUCT_CAPABILITIES = [
  ...WEB_GOVERNANCE_CAPABILITIES,
  'local.discovery', 'local.authoring', 'local.installation', 'local.updates',
  'local.conflicts', 'local.project-bindings', 'local.diagnostics',
] as const;

export const isInstallableCapability = (item: CapabilitySummary) => item.hasPublishedVersion === true;
```

Use `isInstallableCapability` before search/scope filtering in Desktop Home, Desktop Library, and Web Marketplace.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the three commands from Step 2; expect all focused tests to pass.

---

### Task 2: Desktop Governance Cloud Contract

**Files:**
- Modify: `apps/desktop/src/app/types.ts`
- Modify: `apps/desktop/src/app/cloud-client.ts`
- Modify: `apps/desktop/src/app/cloud-client.test.ts`
- Modify: `apps/desktop/src/test/fixtures.ts`

**Interfaces:**
- Produces: explicit-session Desktop methods for every method currently exposed by `WebClient`.
- Consumes: shared organization, space, capability, publication, audit, and security contract types.

- [ ] **Step 1: Add failing cloud-client endpoint tests**

Cover exact request methods, paths, organization headers, and bodies for:

```ts
publicationDetails; scanReport; publicationDiff; withdrawPublication;
updateCapability; versionDiff; transitionVersion;
members; invitations; invite; revokeInvitation; changeMemberRole; removeMember;
createSpace; updateSpacePolicy; archiveSpace; spaceMembers; addSpaceMember;
changeSpaceMemberRole; removeSpaceMember; updateSecurityPolicy;
audit; metrics; sessions; revokeSession; deadLetters; retryDeadLetter;
exportOrganization; closeOrganization; cancelOrganizationClosure;
transferOwnership; leaveOrganization; exportAccount;
requestAccountDeletion; cancelAccountDeletion; accountDeletionStatus;
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @capaport/desktop test -- cloud-client.test.ts`

Expected: TypeScript/test failures because the methods are absent.

- [ ] **Step 3: Extend `CloudClient` and `createCloudClient`**

Each method delegates through the existing request helper with `session` and `organizationId`. Example:

```ts
scanReport: (session, organizationId, publicationId) =>
  request(`/publications/${publicationId}/scan-report`, { session, organizationId }),
updateSecurityPolicy: (session, organizationId, policy) =>
  request(`/organizations/${organizationId}/security-policy`, {
    method: 'PATCH', session, organizationId, body: JSON.stringify(policy),
  }),
```

Add deterministic fixture responses and call recording for component tests.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm --filter @capaport/desktop test -- cloud-client.test.ts`

Expected: all cloud-client tests pass.

---

### Task 3: Complete Native Review Center

**Files:**
- Replace behavior in: `apps/desktop/src/features/publishing/publishing-page.tsx`
- Modify: `apps/desktop/src/features/publishing/publishing-page.test.tsx`
- Modify: `apps/desktop/src/app/desktop-app.tsx`
- Modify: `apps/desktop/src/styles.css`

**Interfaces:**
- Consumes: `cloud.scanReport`, `cloud.publicationDiff`, `cloud.publicationDetails`, and `cloud.reviewPublication`.
- Produces: a role-gated review queue/detail UI with immutable candidate context.

- [ ] **Step 1: Write failing review-context tests**

```ts
await user.click(screen.getByRole('button', { name: /find-skills/ }));
expect(await screen.findByText('安全扫描')).toBeVisible();
expect(await screen.findByText(/新增 1/)).toBeVisible();
expect(screen.getByRole('button', { name: '批准发布' })).toBeEnabled();
```

Also assert the decision buttons remain disabled while context is loading or failed.

- [ ] **Step 2: Run test and verify RED**

Run: `pnpm --filter @capaport/desktop test -- publishing-page.test.tsx`

Expected: failure because Desktop does not load scan/diff/detail context.

- [ ] **Step 3: Implement review queue and detail panel**

Add status tabs, capability/space labels, loading/error states, scan summary, added/modified/removed lists, review history, reason textarea, and three decision buttons. Invalidate publications, capabilities, versions, analytics, audit, and notifications after a successful decision.

- [ ] **Step 4: Run focused test and verify GREEN**

Run the command from Step 2; expect all review tests to pass.

---

### Task 4: Capability Assets and Version Lifecycle

**Files:**
- Create: `apps/desktop/src/features/governance/capability-assets-page.tsx`
- Create: `apps/desktop/src/features/governance/capability-assets-page.test.tsx`
- Modify: `apps/desktop/src/app/desktop-app.tsx`
- Modify: `apps/desktop/src/styles.css`

**Interfaces:**
- Consumes: capability list, spaces, metadata update, version list/diff, and lifecycle transition methods.
- Produces: `CapabilityAssetsPage` with unpublished assets separated from the installable market.

- [ ] **Step 1: Write failing metadata/version lifecycle tests**

Assert an owner can select an unpublished asset, edit metadata, inspect versions, compare two versions, and invoke deprecate/withdraw/archive with pending and error feedback.

- [ ] **Step 2: Run test and verify RED**

Run: `pnpm --filter @capaport/desktop test -- capability-assets-page.test.tsx`

Expected: module-not-found failure.

- [ ] **Step 3: Implement `CapabilityAssetsPage`**

Use separate list/detail sections. Validate non-empty name and at least one compatible Agent. Disable lifecycle operations while offline or pending. Refresh capabilities, publications, versions, audit, and metrics after success.

- [ ] **Step 4: Run focused test and verify GREEN**

Run the command from Step 2; expect all tests to pass.

---

### Task 5: Members, Invitations, Spaces, and Policies

**Files:**
- Create: `apps/desktop/src/features/governance/members-page.tsx`
- Create: `apps/desktop/src/features/governance/members-page.test.tsx`
- Create: `apps/desktop/src/features/governance/spaces-page.tsx`
- Create: `apps/desktop/src/features/governance/spaces-page.test.tsx`
- Modify: `apps/desktop/src/app/desktop-app.tsx`
- Modify: `apps/desktop/src/styles.css`

**Interfaces:**
- Produces: role-gated native management for organization invitations/members and team/project spaces.
- Consumes: all member, invitation, space, policy, and space-membership cloud methods.

- [ ] **Step 1: Write failing interaction tests**

Members tests cover invite, revoke, organization-role change, and removal. Spaces tests cover create, review-policy change, member add/role change/removal, and archive confirmation.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @capaport/desktop test -- members-page.test.tsx spaces-page.test.tsx`

Expected: module-not-found failures.

- [ ] **Step 3: Implement both governance pages**

Use explicit forms, stable row actions, disabled pending controls, confirmation for removal/archive, and query invalidation after success. Do not permit creating personal or organization system spaces.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2; expect all tests to pass.

---

### Task 6: Security, Audit, Analytics, Operations, and Organization Lifecycle

**Files:**
- Create: `apps/desktop/src/features/governance/organization-overview-page.tsx`
- Create: `apps/desktop/src/features/governance/security-center-page.tsx`
- Create: `apps/desktop/src/features/governance/audit-page.tsx`
- Create: `apps/desktop/src/features/governance/analytics-page.tsx`
- Create: `apps/desktop/src/features/governance/organization-settings-page.tsx`
- Create: `apps/desktop/src/features/governance/governance-pages.test.tsx`
- Modify: `apps/desktop/src/app/desktop-app.tsx`
- Modify: `apps/desktop/src/styles.css`

**Interfaces:**
- Consumes: security policy, sessions, dead letters, audit, metrics, organization/member/account lifecycle methods.
- Produces: all remaining Web governance capabilities as native Desktop pages.

- [ ] **Step 1: Write failing governance-page tests**

Assert role visibility and successful calls for security policy update, session revoke, dead-letter retry, audit filtering/pagination, analytics rendering, export, ownership transfer, leave, closure/cancellation, and account deletion/cancellation.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @capaport/desktop test -- governance-pages.test.tsx`

Expected: module-not-found failures.

- [ ] **Step 3: Implement focused pages and role-gated navigation**

Add Desktop navigation entries matching the shared capability inventory. Hide Owner/Admin pages from Members; allow Auditor read-only Security/Audit/Analytics. Require exact confirmation strings for destructive organization/account actions and clear the session after leave or completed logout transitions.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2; expect all tests to pass.

---

### Task 7: End-to-End Parity, Documentation, Build, and Installation

**Files:**
- Modify: `apps/desktop/tests/e2e/desktop/workflows.spec.ts`
- Modify: `apps/web/tests/e2e/web/admin-workflows.spec.ts`
- Modify: `docs/user-guide/desktop.md`
- Modify: `docs/admin-guide/governance.md`

**Interfaces:**
- Consumes: all completed Desktop governance pages and cloud methods.
- Produces: regression evidence and installed signed Desktop application.

- [ ] **Step 1: Extend E2E tests before any remaining glue implementation**

Cover:

```text
submit -> open full review context -> owner approve -> market visible -> install preview
invite -> role change -> revoke/remove
create space -> set review policy -> manage membership -> archive
update security policy -> inspect audit/analytics -> retry operation
export -> ownership/closure confirmation flows
```

- [ ] **Step 2: Run E2E and verify RED for missing integration**

Run: `pnpm --filter @capaport/desktop test:e2e`

Expected: failures at unconnected navigation/query invalidation until glue is complete.

- [ ] **Step 3: Complete integration and documentation**

Wire missing query invalidations, offline gating, organization switching resets, notification refresh, and documentation. Keep all operations inside existing API authorization boundaries.

- [ ] **Step 4: Run complete verification**

Run:

```bash
pnpm test
pnpm build
pnpm e2e
pnpm acceptance
docker compose -f infra/compose/compose.yaml build api web
docker compose -f infra/compose/compose.yaml up -d api web
pnpm --dir apps/desktop exec tauri build
```

Expected: zero failures; API live/ready endpoints return `status: ok`; Web and Desktop smoke tests pass.

- [ ] **Step 5: Sign, install, and smoke-test Desktop**

Ad-hoc sign the local bundle, verify with `codesign --verify --deep --strict`, back up the current `/Applications/CapaPort.app`, install the new bundle with `ditto`, launch it, and confirm the installed process plus organization governance routes.

