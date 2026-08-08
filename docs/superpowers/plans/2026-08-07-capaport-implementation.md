# CapaPort Full MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete runnable CapaPort MVP covering account and organization management, four-level spaces, canonical capability packages, review and publishing, secure local discovery and installation for four Agent tools, Web administration, CLI, audit, analytics, and Docker deployment.

**Architecture:** A pnpm/Turborepo monorepo contains a NestJS modular-monolith API, React Web console, React/Tauri desktop client, TypeScript CLI, shared contracts, a canonical capability toolkit, security scanner, and Agent adapter SDK. PostgreSQL stores transactional tenant data, S3-compatible storage stores immutable artifacts, Redis backs jobs and rate limits, and Docker Compose runs the complete backend dependency set.

**Tech Stack:** Node.js 22+, TypeScript, pnpm, Turborepo, React, Vite, NestJS with Fastify, PostgreSQL, Drizzle ORM, Redis/BullMQ, S3/MinIO, Vitest, Playwright, Tauri 2/Rust, Docker/OCI.

## Global Constraints

- Support macOS and Windows desktop; Linux is supported through the CLI in MVP.
- Support Codex, Claude Code, Cursor, and Gemini CLI through local directory adapters.
- Never upload business source code or local absolute paths.
- Published capability versions are immutable.
- Organization publication always requires review; team and project review is configurable.
- All organization business records are tenant-scoped and all sensitive actions are audited.
- Local file changes are previewed, atomic, recoverable, and never overwritten silently.
- Backend delivery is Docker-first with separate API, Worker, and migration entrypoints.
- Tests are written before production behavior for each task.

## File Map

- `apps/api/src/modules/*`: one NestJS module per cloud domain; modules expose services, not database tables.
- `apps/web/src/features/*`: Web console features grouped by business domain.
- `apps/desktop/src/features/*`: desktop UI grouped by local workflow.
- `apps/desktop/src-tauri/src/*`: privileged Rust code for paths, credentials, local database, transactions, and updates.
- `apps/cli/src/commands/*`: non-interactive and interactive CLI commands.
- `packages/contracts/src/*`: stable request, response, event, and error contracts.
- `packages/domain-types/src/*`: framework-free IDs, enums, and state-machine values.
- `packages/capability-kit/src/*`: manifest parsing, packaging, hashing, diffing, and version validation.
- `packages/security-scan/src/*`: shared secret, path, file, and policy scanning.
- `packages/adapter-sdk/src/*`: canonical adapter interfaces and compliance suite.
- `adapters/*`: one isolated implementation per supported Agent.
- `infra/docker/*`, `infra/compose/*`: container build and runnable local stack.
- `tests/e2e/*`, `tests/tenancy/*`, `tests/security/*`: system-wide acceptance gates.

---

### Task 1: Monorepo and Quality Baseline

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `vitest.workspace.ts`, `biome.json`
- Create: `packages/domain-types/package.json`, `packages/domain-types/src/index.ts`, `packages/domain-types/src/index.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: workspace scripts `build`, `dev`, `test`, `typecheck`, `lint`, `format`; branded IDs and shared enums from `@capaport/domain-types`.

- [ ] **Step 1: Write the failing domain-type test**

```ts
import { describe, expect, it } from 'vitest';
import { asOrganizationId, SpaceType } from './index';

describe('domain types', () => {
  it('creates a branded organization id and exports all space types', () => {
    expect(asOrganizationId('org_1')).toBe('org_1');
    expect(Object.values(SpaceType)).toEqual(['personal', 'team', 'project', 'organization']);
  });
});
```

- [ ] **Step 2: Run `pnpm install && pnpm test --filter @capaport/domain-types` and verify the missing module or export failure.**
- [ ] **Step 3: Implement the workspace configuration and domain types.**

```ts
export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type OrganizationId = Brand<string, 'OrganizationId'>;
export const asOrganizationId = (value: string) => value as OrganizationId;
export const SpaceType = {
  Personal: 'personal', Team: 'team', Project: 'project', Organization: 'organization',
} as const;
```

- [ ] **Step 4: Run `pnpm test && pnpm typecheck && pnpm lint`; expect all commands to pass.**
- [ ] **Step 5: Commit with `git commit -m "chore: establish monorepo quality baseline"`.**

### Task 2: Canonical Capability Package

**Files:**
- Create: `packages/capability-kit/src/schema.ts`, `manifest.ts`, `hash.ts`, `archive.ts`, `diff.ts`, `version.ts`, `index.ts`
- Test: `packages/capability-kit/src/*.test.ts`, `tests/fixtures/capabilities/valid/*`, `tests/fixtures/capabilities/unsafe/*`

**Interfaces:**
- Produces: `parseManifest(yaml: string): CapabilityManifest`, `hashPackage(files): Promise<string>`, `buildArchive(root): Promise<Uint8Array>`, `diffPackages(a,b): PackageDiff`, `classifyVersion(diff): major|minor|patch`.

- [ ] **Step 1: Add tests for the exact `capaport.io/v1alpha1` manifest, normalized file ordering, stable SHA-256, archive traversal rejection, structural diffs, and semantic-version classification.**
- [ ] **Step 2: Run `pnpm test --filter @capaport/capability-kit`; expect schema and helper imports to fail.**
- [ ] **Step 3: Implement Zod manifest validation and canonical path normalization.**

```ts
export const manifestSchema = z.object({
  schemaVersion: z.literal('capaport.io/v1alpha1'),
  kind: z.literal('CapabilityPackage'),
  metadata: z.object({ slug: slugSchema, name: z.string().min(1).max(120), description: z.string().max(2000), tags: z.array(slugSchema).max(20) }),
  spec: z.object({ components: z.array(componentSchema).min(1), compatibility: compatibilitySchema, permissions: permissionsSchema, entrypoints: z.record(z.string()), dependencies: z.array(dependencySchema) }),
});
```

- [ ] **Step 4: Implement deterministic hashing, ZIP creation/extraction guards, diffing, and version classification.**
- [ ] **Step 5: Run package tests and fixture round-trips; expect all to pass and identical input to produce identical digests.**
- [ ] **Step 6: Commit with `git commit -m "feat: add canonical capability package toolkit"`.**

### Task 3: Shared Security Scanner

**Files:**
- Create: `packages/security-scan/src/types.ts`, `secret-rules.ts`, `path-rules.ts`, `content-rules.ts`, `scan.ts`, `index.ts`
- Test: `packages/security-scan/src/*.test.ts`, `tests/fixtures/security/*`

**Interfaces:**
- Produces: `scanPackage(input, policy): Promise<ScanReport>` where findings have stable rule ID, severity, location, evidence digest, and blocking flag.

- [ ] **Step 1: Add failing tests for private keys, cloud tokens, connection strings, high-entropy strings, `.env`, absolute paths, `..` traversal, symlink escape, executable declarations, allowed examples, and custom organization terms.**
- [ ] **Step 2: Run the scanner test suite and verify missing implementation failures.**
- [ ] **Step 3: Implement deterministic rules that redact evidence and never return the discovered secret.**

```ts
export type ScanFinding = {
  ruleId: string; severity: 'low'|'medium'|'high'|'critical';
  path: string; line?: number; evidenceDigest: string; message: string; blocking: boolean;
};
```

- [ ] **Step 4: Add policy thresholds and client/server scan modes; critical and high findings block by default.**
- [ ] **Step 5: Run tests, typecheck, and a fixture scan CLI; expect redacted reports and nonzero exit for blocked packages.**
- [ ] **Step 6: Commit with `git commit -m "feat: add capability security scanning"`.**

### Task 4: API Platform, Database, and Container Skeleton

**Files:**
- Create: `apps/api/src/main.ts`, `app.module.ts`, `config/*`, `platform/database/*`, `platform/errors/*`, `platform/health/*`, `platform/events/*`
- Create: `apps/api/drizzle.config.ts`, `apps/api/src/db/schema/*`, `apps/api/src/db/migrations/*`
- Create: `infra/docker/backend.Dockerfile`, `infra/docker/entrypoint.sh`, `infra/compose/compose.yaml`, `infra/compose/.env.example`
- Test: `apps/api/src/platform/health/*.test.ts`, `tests/e2e/health.spec.ts`

**Interfaces:**
- Produces: `/api/v1/health/live`, `/api/v1/health/ready`, shared `AppError`, `RequestContext`, transaction outbox, API/Worker/Migrate container targets.

- [ ] **Step 1: Add failing tests for liveness, readiness dependency failure, request IDs, stable error envelopes, and configuration rejection.**
- [ ] **Step 2: Run API tests; expect missing bootstrap failures.**
- [ ] **Step 3: Implement NestJS/Fastify bootstrap, Zod configuration, Drizzle connection, Redis and S3 probes, error filter, and graceful shutdown.**
- [ ] **Step 4: Implement an outbox table and `publishAfterCommit(event)` transaction helper.**
- [ ] **Step 5: Build multi-stage non-root OCI targets and Compose services `api`, `worker`, `migrate`, `postgres`, `redis`, `minio`, and `mailpit`.**
- [ ] **Step 6: Run `docker compose -f infra/compose/compose.yaml up -d --build`; expect all health checks to become healthy.**
- [ ] **Step 7: Run `pnpm test --filter @capaport/api`, stop and restart Compose, and verify data volume recovery.**
- [ ] **Step 8: Commit with `git commit -m "feat: add containerized API platform"`.**

### Task 5: Identity and Session Security

**Files:**
- Create: `apps/api/src/modules/identity/{identity.module,identity.service,auth.controller,session.service,verification.service,identity.repository}.ts`
- Create: `apps/api/src/db/schema/identity.ts`
- Create: `packages/contracts/src/auth.ts`, `packages/contracts/src/errors.ts`
- Test: `apps/api/src/modules/identity/*.test.ts`, `tests/e2e/auth.spec.ts`, `tests/security/session-replay.spec.ts`

**Interfaces:**
- Produces: register, verify, login, refresh rotation, logout, recovery, session list/revoke; `AuthenticatedUser { userId, sessionId }`.

- [ ] **Step 1: Add failing tests for email and phone registration, duplicate identities, verification expiry, password strength, login rate limits, rotating refresh tokens, replay-chain revocation, recovery, and redacted responses.**
- [ ] **Step 2: Run identity tests and verify route-not-found failures.**
- [ ] **Step 3: Implement normalized identities, Argon2id password hashes, one-time verification digests, short access JWTs, hashed rotating refresh tokens, and revocation.**
- [ ] **Step 4: Implement provider adapters for email and SMS with Mailpit/log-safe development implementations.**
- [ ] **Step 5: Run auth E2E and replay tests; expect all cases to pass.**
- [ ] **Step 6: Commit with `git commit -m "feat: implement secure account authentication"`.**

### Task 6: Organizations, Invitations, and Tenant Context

**Files:**
- Create: `apps/api/src/modules/organizations/*`, `apps/api/src/platform/tenancy/*`, `apps/api/src/db/schema/organizations.ts`
- Create: `packages/contracts/src/organizations.ts`
- Test: `apps/api/src/modules/organizations/*.test.ts`, `tests/tenancy/organization-isolation.spec.ts`, `tests/e2e/invitations.spec.ts`

**Interfaces:**
- Produces: organization CRUD, current-organization switch, member list, invite/accept/revoke, role changes, owner transfer, leave; `TenantContext { organizationId, membershipId, organizationRole }`.

- [ ] **Step 1: Add failing tests for create-as-owner, expiring single-use invitations, existing/new user acceptance, role constraints, last-owner protection, removal, switching, and guessed cross-tenant IDs.**
- [ ] **Step 2: Implement tenant context resolution from verified membership and reject client-supplied resource tenant mismatches.**
- [ ] **Step 3: Implement repositories whose public methods always require `organizationId`.**
- [ ] **Step 4: Implement invitation notification events and append-only audit writes.**
- [ ] **Step 5: Run organization, invitation, and tenant-isolation suites; expect zero cross-tenant disclosure.**
- [ ] **Step 6: Commit with `git commit -m "feat: add tenant-safe organizations and invitations"`.**

### Task 7: Spaces and Authorization Matrix

**Files:**
- Create: `apps/api/src/modules/access/*`, `apps/api/src/db/schema/spaces.ts`, `packages/contracts/src/spaces.ts`
- Test: `apps/api/src/modules/access/authorization.test.ts`, `tests/tenancy/space-access.spec.ts`

**Interfaces:**
- Produces: `authorize(subject, action, resource): AuthorizationDecision`, personal/team/project/organization spaces, space membership and review policies.

- [ ] **Step 1: Encode the complete Owner/Admin/Auditor/Member and Manager/Reviewer/Contributor/Viewer matrix as table-driven failing tests.**
- [ ] **Step 2: Add tests for automatic personal and organization spaces, private personal content, team/project membership, review policy changes, disabled members, and organization admins not reading personal content by default.**
- [ ] **Step 3: Implement pure authorization policy functions before route guards.**
- [ ] **Step 4: Implement space services, repositories, guards, and audited role/policy changes.**
- [ ] **Step 5: Run authorization mutation and isolation tests; expect every denied decision to use stable error code `ACCESS_DENIED`.**
- [ ] **Step 6: Commit with `git commit -m "feat: implement spaces and scoped authorization"`.**

### Task 8: Artifact Storage and Capability Registry

**Files:**
- Create: `apps/api/src/modules/capabilities/*`, `apps/api/src/platform/storage/*`, `apps/api/src/db/schema/capabilities.ts`
- Create: `packages/contracts/src/capabilities.ts`
- Test: `apps/api/src/modules/capabilities/*.test.ts`, `tests/e2e/artifact-upload.spec.ts`

**Interfaces:**
- Produces: capabilities, drafts, immutable versions, presigned upload request/confirm, metadata search, tags, compatibility, forks, content-addressed artifacts.

- [ ] **Step 1: Add failing tests for create/edit drafts, three-step uploads, digest mismatch, expired upload, orphan cleanup, same-tenant content dedupe, immutable versions, slug uniqueness, and authorized search filtering.**
- [ ] **Step 2: Implement S3 storage keys using random IDs and store original names only as metadata.**
- [ ] **Step 3: Implement capability and draft repositories with explicit organization and space authorization.**
- [ ] **Step 4: Implement server-side manifest/archive validation and security scan before a draft becomes submittable.**
- [ ] **Step 5: Run MinIO integration, registry, immutability, and search tests.**
- [ ] **Step 6: Commit with `git commit -m "feat: add capability registry and artifact storage"`.**

### Task 9: Publishing, Review, and Version Lifecycle

**Files:**
- Create: `apps/api/src/modules/publishing/*`, `apps/api/src/db/schema/publications.ts`, `packages/contracts/src/publications.ts`
- Test: `apps/api/src/modules/publishing/*.test.ts`, `tests/e2e/publishing.spec.ts`

**Interfaces:**
- Produces: submit, request changes, reject, approve, withdraw, deprecate, archive, promote, version diff and scan report endpoints.

- [ ] **Step 1: Add table-driven state-machine tests for every allowed and forbidden transition.**
- [ ] **Step 2: Add failing policy tests: personal direct save, configurable team/project review, mandatory organization review, reviewer separation, frozen candidate digest, resubmission as a new revision.**
- [ ] **Step 3: Implement transactional publication, review, version, outbox, and audit writes.**
- [ ] **Step 4: Implement structured diffs and semantic-version recommendations using capability-kit.**
- [ ] **Step 5: Run publishing E2E including concurrent approval and duplicate idempotency keys; expect one published version.**
- [ ] **Step 6: Commit with `git commit -m "feat: implement governed capability publishing"`.**

### Task 10: Distribution, Devices, Installations, and Updates

**Files:**
- Create: `apps/api/src/modules/distribution/*`, `apps/api/src/db/schema/distribution.ts`, `packages/contracts/src/distribution.ts`
- Test: `apps/api/src/modules/distribution/*.test.ts`, `tests/e2e/distribution.spec.ts`

**Interfaces:**
- Produces: device registration, compatibility resolution, authorized download plan, installation result, update check, withdrawal notice, anonymized installation analytics.

- [ ] **Step 1: Add failing tests for compatible/incompatible Agents, private-space download denial, short-lived download authorization, device ownership, idempotent installation reports, update availability, withdrawn version handling, and no hardware serial collection.**
- [ ] **Step 2: Implement install-plan responses containing version digest, declared permissions, target adapter, and signed artifact URL.**
- [ ] **Step 3: Implement installation and update services with audit/outbox events.**
- [ ] **Step 4: Run distribution E2E and verify artifact URLs expire and unauthorized users cannot infer capability existence.**
- [ ] **Step 5: Commit with `git commit -m "feat: add secure capability distribution"`.**

### Task 11: Audit, Notifications, and Analytics

**Files:**
- Create: `apps/api/src/modules/audit/*`, `notifications/*`, `analytics/*`
- Create: `apps/api/src/worker.ts`, `apps/api/src/db/schema/audit.ts`
- Test: `apps/api/src/modules/{audit,notifications,analytics}/*.test.ts`, `tests/e2e/audit.spec.ts`

**Interfaces:**
- Produces: immutable audit query, in-app notifications, email/SMS jobs, product-event ingestion, aggregate MVP metrics, dead-letter visibility.

- [ ] **Step 1: Add failing tests for append-only audit behavior, tenant filtering, PII redaction, notification idempotency, retry/dead-letter, event minimization, and metric aggregation.**
- [ ] **Step 2: Implement outbox polling and BullMQ consumers with deterministic job IDs.**
- [ ] **Step 3: Implement audit and analytics retention rules; content and absolute paths must be rejected from event payloads.**
- [ ] **Step 4: Run worker integration tests with Redis and Mailpit; expect one delivered notification per event.**
- [ ] **Step 5: Commit with `git commit -m "feat: add audit notifications and analytics"`.**

### Task 12: Agent Adapter SDK and Compliance Suite

**Files:**
- Create: `packages/adapter-sdk/src/{types,paths,compliance,index}.ts`
- Create: `adapters/{codex,claude-code,cursor,gemini-cli}/src/*`
- Test: `packages/adapter-sdk/src/compliance.test.ts`, `adapters/*/src/*.test.ts`, `tests/fixtures/agents/*`

**Interfaces:**
- Produces: `AgentAdapter.detect`, `inventory`, `import`, `planInstall`, `validatePlan`, `apply`, `uninstall` and a reusable compliance test factory.

- [ ] **Step 1: Add a failing fake-adapter compliance suite covering deterministic inventory, canonical import, allowed roots, traversal rejection, install plan, lock metadata, uninstall, and unsupported components.**
- [ ] **Step 2: Implement SDK types, normalized paths, declared adapter capabilities, and compliance factory.**
- [ ] **Step 3: Add real filesystem fixtures and implement Codex adapter. Run compliance until it passes.**
- [ ] **Step 4: Implement and pass the same suite for Claude Code, Cursor, and Gemini CLI using each tool's explicit directory mapping.**
- [ ] **Step 5: Run all adapters on macOS fixtures and Windows path fixtures.**
- [ ] **Step 6: Commit with `git commit -m "feat: support four agent adapters"`.**

### Task 13: Tauri Local Runtime and File Transactions

**Files:**
- Create: `apps/desktop/src-tauri/Cargo.toml`, `tauri.conf.json`, `src/main.rs`, `src/commands/*`, `src/database/*`, `src/files/*`, `src/credentials/*`
- Test: `apps/desktop/src-tauri/src/**/*_test.rs`, `tests/fixtures/file-transactions/*`

**Interfaces:**
- Produces Tauri commands: `detect_agents`, `inventory_agent`, `scan_local_package`, `preview_install`, `apply_install`, `rollback_install`, `bind_project_directory`, `sync_queue_status`.

- [ ] **Step 1: Add Rust tests for root allowlists, path canonicalization, symlink escape, preview diffs, backups, atomic commit, simulated failure rollback, rollback failure state, local-modification conflicts, and credential abstraction.**
- [ ] **Step 2: Implement SQLite migrations for device cache, path bindings, install locks, backups, sync cursors, and retry queue.**
- [ ] **Step 3: Implement file transactions with temporary staging, SHA-256 verification, atomic rename, and recovery journal.**
- [ ] **Step 4: Implement OS credential-store integration and ensure logs never expose tokens or absolute paths.**
- [ ] **Step 5: Expose only typed allowlisted Tauri commands and generate TypeScript bindings.**
- [ ] **Step 6: Run `cargo test` and Tauri command integration tests on the current platform.**
- [ ] **Step 7: Commit with `git commit -m "feat: add secure desktop local runtime"`.**

### Task 14: Desktop Application Workflows

**Files:**
- Create: `apps/desktop/src/app/*`, `features/auth/*`, `features/agents/*`, `features/library/*`, `features/projects/*`, `features/publishing/*`, `features/settings/*`
- Test: `apps/desktop/src/**/*.test.tsx`, `tests/e2e/desktop/*.spec.ts`

**Interfaces:**
- Consumes generated cloud SDK and Tauri command bindings.
- Produces complete employee UI for login, organization switch, agent status, local discovery, import, scan, draft, submission, marketplace, install, update, conflicts, project bindings, and diagnostics.

- [ ] **Step 1: Add failing component tests for route protection, offline mode, organization switch cache partitioning, scan blocking, install preview, update conflict choices, retry queue, and accessible error states.**
- [ ] **Step 2: Implement the desktop shell, query client, authenticated API client, local-command client, and persisted non-sensitive preferences.**
- [ ] **Step 3: Implement each workflow against real API contracts and mocked Tauri fixtures; no fake production data sources.**
- [ ] **Step 4: Add Playwright desktop-webview journeys for discover → import → publish and search → install → update conflict.**
- [ ] **Step 5: Build the Tauri app and run tests; expect a launchable development desktop client.**
- [ ] **Step 6: Commit with `git commit -m "feat: build complete desktop workflows"`.**

### Task 15: Web Console and Organization Marketplace

**Files:**
- Create: `apps/web/src/app/*`, `features/auth/*`, `features/organizations/*`, `features/marketplace/*`, `features/reviews/*`, `features/spaces/*`, `features/security/*`, `features/audit/*`, `features/analytics/*`
- Test: `apps/web/src/**/*.test.tsx`, `tests/e2e/web/*.spec.ts`

**Interfaces:**
- Produces Web UI for registration, invitations, organization dashboard, marketplace, capability/version details, review center, members, spaces, policies, security reports, audit, analytics, and settings.

- [ ] **Step 1: Add failing route, authorization, form, empty-state, pagination, filtering, review-diff, audit-redaction, and responsive-navigation tests.**
- [ ] **Step 2: Implement generated-SDK API layer, authenticated routing, organization switch, and permission-aware navigation.**
- [ ] **Step 3: Implement all listed feature pages with real loading, error, retry, success, and disabled states.**
- [ ] **Step 4: Add Playwright journeys for admin invitation, space management, organization review, withdrawal, audit inspection, and metric dashboard.**
- [ ] **Step 5: Run unit/E2E/build; expect production assets without test or mock endpoints.**
- [ ] **Step 6: Commit with `git commit -m "feat: build organization web console"`.**

### Task 16: CLI and Linux Workflow

**Files:**
- Create: `apps/cli/src/main.ts`, `client.ts`, `credentials.ts`, `output.ts`, `commands/{auth,org,search,pull,publish,install,sync,doctor}.ts`
- Test: `apps/cli/src/**/*.test.ts`, `tests/e2e/cli/*.spec.ts`

**Interfaces:**
- Produces commands `capaport auth`, `org`, `search`, `pull`, `publish`, `install`, `sync`, and `doctor`, with JSON output mode and meaningful exit codes.

- [ ] **Step 1: Add failing parser, credential, JSON output, interactive confirmation, non-TTY, adapter, offline, and exit-code tests.**
- [ ] **Step 2: Implement system credential storage, generated API client, adapter loading, and redacted diagnostics.**
- [ ] **Step 3: Implement all commands with `--json`, organization selection, idempotency keys, and explicit destructive confirmations.**
- [ ] **Step 4: Run CLI E2E against Compose using temporary Agent directories; expect publish/install/update journeys to pass.**
- [ ] **Step 5: Build standalone distribution artifacts and smoke-test on Linux container and current host.**
- [ ] **Step 6: Commit with `git commit -m "feat: add complete capaport CLI"`.**

### Task 17: Project Spaces and Selective Context Sync

**Files:**
- Create: `apps/api/src/modules/projects/*`, `apps/desktop/src/features/projects/*`, `apps/desktop/src-tauri/src/projects/*`, `packages/contracts/src/projects.ts`
- Test: `apps/api/src/modules/projects/*.test.ts`, `apps/desktop/src/features/projects/*.test.tsx`, `tests/security/context-sync.spec.ts`

**Interfaces:**
- Produces project-space directory bindings, allowlist previews, ignore policies, context package creation, multi-adapter projection, and device-safe cloud metadata.

- [ ] **Step 1: Add failing tests for multiple directories, device-local absolute paths, default ignores, file/size/type limits, explicit selection, source-tree rejection, secret re-scan, and removed-directory recovery.**
- [ ] **Step 2: Implement cloud binding metadata that stores device and project IDs but never paths.**
- [ ] **Step 3: Implement Rust directory selection and bounded inventory with preview counts and ignore reasons.**
- [ ] **Step 4: Implement canonical context packaging and projection through each adapter.**
- [ ] **Step 5: Run context security and E2E sync tests; inspect captured API bodies to confirm no absolute path or unselected file leaves the device.**
- [ ] **Step 6: Commit with `git commit -m "feat: add secure project context sharing"`.**

### Task 18: Full-System Security and Tenancy Gates

**Files:**
- Create: `tests/tenancy/resource-matrix.spec.ts`, `tests/security/{archive,path,auth,upload,desktop}.spec.ts`, `scripts/security-gate.ts`
- Modify: CI configuration and root scripts.

**Interfaces:**
- Produces `pnpm security:gate` and machine-readable security reports.

- [ ] **Step 1: Generate fixtures for two organizations, every role, every space type, published/private/withdrawn resources, and four devices.**
- [ ] **Step 2: Test every resource endpoint with foreign organization IDs and assert identical not-found disclosure behavior.**
- [ ] **Step 3: Test traversal, symlinks, archive bombs, malicious manifests, token replay, invitation replay, rate limits, and upload digest races.**
- [ ] **Step 4: Test desktop command allowlists, credential redaction, update signatures, and file rollback faults.**
- [ ] **Step 5: Run `pnpm security:gate`; expect zero high/critical failures and a nonzero exit whenever a fixture is intentionally made vulnerable.**
- [ ] **Step 6: Commit with `git commit -m "test: enforce security and tenant isolation"`.**

### Task 19: Docker Release, Observability, and Runbooks

**Files:**
- Create: `infra/docker/*`, `infra/compose/compose.production.yaml`, `infra/deploy/*`, `docs/runbooks/{deploy,rollback,backup,restore,incident}.md`
- Create: `apps/api/src/platform/telemetry/*`, `scripts/build-images.ts`, `scripts/smoke-stack.ts`
- Test: `tests/e2e/container-release.spec.ts`

**Interfaces:**
- Produces multi-arch immutable images, SBOM, health/readiness, graceful shutdown, migration job, structured redacted logs, metrics, and tested rollback/restore procedures.

- [ ] **Step 1: Add failing container tests for non-root UID, read-only root filesystem, no embedded secrets, liveness/readiness, signal shutdown, and migration serialization.**
- [ ] **Step 2: Implement API/Worker/Migrate targets, OCI labels, SBOM generation, vulnerability scan command, and immutable tag validation.**
- [ ] **Step 3: Add request/job correlation IDs, redacted structured logs, metrics, and alerts listed in the architecture.**
- [ ] **Step 4: Write and execute backup, restore, rolling release, application rollback, and forward-compatible migration runbooks in a disposable environment.**
- [ ] **Step 5: Run full Compose smoke test from an empty Docker state; expect signup, publish, install-plan, audit, restart, and data recovery checks to pass.**
- [ ] **Step 6: Commit with `git commit -m "ops: complete container release platform"`.**

### Task 20: Final Cross-Platform Acceptance and Release

**Files:**
- Create: `tests/acceptance/capaport-mvp.spec.ts`, `docs/user-guide/*`, `docs/admin-guide/*`, `CHANGELOG.md`, `README.md`
- Modify: root scripts and release workflow.

**Interfaces:**
- Produces a reproducible one-command local stack, signed desktop build instructions/artifacts, CLI artifacts, user/admin documentation, and final MVP acceptance report.

- [ ] **Step 1: Encode the ten-step final acceptance scenario from the architecture as executable E2E tests using two members, one reviewer, two organizations, Codex source, and Claude Code target fixtures.**
- [ ] **Step 2: Run all unit, integration, adapter, desktop, Web, CLI, tenancy, security, migration, and container tests from a clean checkout.**
- [ ] **Step 3: Build Web assets, API/Worker/Migrate images, macOS and Windows desktop artifacts through CI, and Linux CLI artifact.**
- [ ] **Step 4: Start the documented local stack and manually verify login, organization, discovery, review, install, update conflict, project sync, audit, and restart persistence.**
- [ ] **Step 5: Write exact setup, environment, user, administrator, security, backup, restore, and troubleshooting documentation using verified commands only.**
- [ ] **Step 6: Run `git diff --check`, confirm a clean tree, tag the verified MVP commit, and commit with `git commit -m "release: complete CapaPort MVP"`.**

## Completion Definition

The project is complete only when every task above is checked, the ten-step acceptance scenario passes, `docker compose` starts the backend from an empty environment, the Web console is usable, the desktop app launches on supported CI platforms, the Linux CLI completes the main workflow, all four adapters pass the shared compliance suite, and no high or critical tenancy/security gate remains open.
