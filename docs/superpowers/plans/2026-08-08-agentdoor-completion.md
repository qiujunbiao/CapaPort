# Agentdoor Complete Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every gap between the approved Agentdoor architecture and the runnable product so the real desktop, cloud, Web, CLI, security, recovery, and delivery workflows satisfy the final acceptance scenario.

**Architecture:** Keep the approved modular monolith plus local adapter runtime. Centralize repeated security, idempotency, delivery, and contract behavior behind focused services; preserve tenant checks in repositories and perform all local mutations through the Rust transaction engine.

**Tech Stack:** TypeScript 7, React 19, NestJS 11/Fastify, PostgreSQL 17, Redis 7/BullMQ, S3-compatible storage, Tauri 2/Rust, pnpm/Turborepo, Vitest, Playwright, Docker Compose.

## Global Constraints

- Desktop targets macOS and Windows; Linux remains supported through the CLI.
- The cloud service remains a Docker-delivered modular monolith with separate API, worker, and migration entrypoints.
- Capability packages contain Skill, Prompt, and project context only; project source code is never uploaded implicitly.
- All organization-scoped reads and writes resolve membership server-side and reject cross-tenant identifiers without leaking existence.
- Every new behavior follows red-green-refactor and has a real-code regression test.
- Installation, update, and uninstall preserve local modifications and provide deterministic recovery.
- No secret, private key, high-entropy credential, dangerous script declaration, or blocked organization term is uploaded before client-side confirmation.

---

### Task 1: Correct desktop version selection and lock-based update planning

**Files:**
- Modify: `apps/desktop/src/app/install-plan.ts`
- Modify: `apps/desktop/src/app/local-client.ts`
- Modify: `apps/desktop/src/app/types.ts`
- Modify: `apps/desktop/src/features/library/install-modal.tsx`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/desktop/src-tauri/src/database/mod.rs`
- Test: `apps/desktop/src/app/install-plan.test.ts`
- Test: `apps/desktop/src-tauri/src/files/mod.rs`

**Interfaces:**
- Consumes: `InstallLockFile[]` returned by `loadInstallLock(adapterId, capabilitySlug, rootPath)`.
- Produces: `buildLocalInstallPlan({ archive, adapterId, rootPath, packageDigest, installedFiles })` and `selectInstallVersion(versions, availableVersionId?)`.

- [ ] **Step 1: Write failing TypeScript and Rust tests** proving semantic version ordering chooses `10.0.0` over `2.0.0`, unchanged installed files use the prior `afterDigest`, and a clean update previews as `update`, not `conflict`.
- [ ] **Step 2: Run** `pnpm --filter @agentdoor/desktop test -- install-plan.test.ts` and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml files::tests` **and confirm the assertions fail for the old zero digest/string sort behavior.**
- [ ] **Step 3: Implement** lock lookup and semantic ordering. The plan writes must set `expectedDigest: installedByPath.get(relativePath)?.afterDigest`; new files omit the expected digest.
- [ ] **Step 4: Run the same focused tests and confirm they pass.**
- [ ] **Step 5: Commit** the desktop update correction with its regression tests.

### Task 2: Route uninstall through a recoverable file transaction

**Files:**
- Modify: `apps/desktop/src-tauri/src/files/mod.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/desktop/src-tauri/src/database/mod.rs`
- Modify: `apps/desktop/src/generated/commands.ts`
- Test: `apps/desktop/src-tauri/src/files/mod.rs`

**Interfaces:**
- Consumes: `UninstallInput` and the persisted installation lock.
- Produces: `FileEngine::uninstall(input, database) -> ApplyResult` and rollback support using the same journal states as install/update.

- [ ] **Step 1: Write failing Rust tests** that inject a removal failure after the first target and assert every original file and lock are restored, then assert explicit rollback restores a completed uninstall.
- [ ] **Step 2: Run** `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml uninstall` **and verify failure because uninstall currently removes files directly.**
- [ ] **Step 3: Implement** staging, backup, journal transitions, atomic removal, lock retention until commit, rollback, and `needs_manual_recovery` with backup location.
- [ ] **Step 4: Run the focused Rust tests and confirm pass.**
- [ ] **Step 5: Commit** the transactional uninstall implementation.

### Task 3: Complete conflict diff, local-draft import, overwrite, and recovery UI

**Files:**
- Create: `apps/desktop/src/features/library/conflict-resolution.ts`
- Modify: `apps/desktop/src/features/library/install-modal.tsx`
- Modify: `apps/desktop/src/app/local-client.ts`
- Modify: `apps/desktop/src/app/cloud-client.ts`
- Modify: `apps/desktop/src/app/types.ts`
- Modify: `apps/desktop/src/styles.css`
- Test: `apps/desktop/src/features/library/conflict-resolution.test.ts`
- Test: `apps/desktop/tests/e2e/desktop/workflows.spec.ts`

**Interfaces:**
- Consumes: preview changes, local file bytes, organization archive bytes, and rollback transaction identifiers.
- Produces: line-oriented `ConflictDiff`, per-file `keep|overwrite`, `importConflictAsDraft()`, and `restoreTransaction()` actions.

- [ ] **Step 1: Write failing tests** for rendered line diffs, importing the local variant as a draft before overwrite, and restoring a completed transaction from the result screen.
- [ ] **Step 2: Run** `pnpm --filter @agentdoor/desktop test -- conflict-resolution.test.ts` **and verify the new API is absent.**
- [ ] **Step 3: Implement** the four conflict choices, accessible diff view, local package export to a personal-space draft, and recovery status with backup path.
- [ ] **Step 4: Run component tests and** `pnpm --filter @agentdoor/desktop test:e2e -- --grep "conflict"` **until the real user workflow passes.**
- [ ] **Step 5: Commit** conflict and recovery UX.

### Task 4: Add complete capability authoring and revision workflow

**Files:**
- Create: `packages/capability-kit/src/editor.ts`
- Create: `apps/desktop/src/features/authoring/authoring-page.tsx`
- Create: `apps/desktop/src/features/authoring/package-editor.tsx`
- Modify: `apps/desktop/src/app/desktop-app.tsx`
- Modify: `apps/desktop/src/app/cloud-client.ts`
- Modify: `apps/desktop/src/styles.css`
- Modify: `apps/web/src/features/marketplace/marketplace-page.tsx`
- Test: `packages/capability-kit/src/editor.test.ts`
- Test: `apps/desktop/src/app/app.test.tsx`

**Interfaces:**
- Produces: `createEditablePackage`, `updatePackageComponent`, `validateEditablePackage`, archive export, save draft revision, submit, reopen changes-requested draft, and version history comparison.

- [ ] **Step 1: Write failing tests** for creating Skill/Prompt/context files, validating paths and manifest declarations, editing content, saving a second immutable revision, and resubmitting a changes-requested publication.
- [ ] **Step 2: Run the focused capability-kit and desktop tests and confirm failure because the authoring API/page does not exist.**
- [ ] **Step 3: Implement** a three-component Markdown editor with manifest metadata, live validation, local save, server revision save, scan report, version diff, and publication actions.
- [ ] **Step 4: Run focused tests and desktop build.**
- [ ] **Step 5: Commit** the authoring workspace.

### Task 5: Enforce the full security policy before upload

**Files:**
- Create: `apps/desktop/src/security/client-scan.ts`
- Modify: `packages/security-scan/src/types.ts`
- Modify: `packages/security-scan/src/scan.ts`
- Modify: `apps/desktop/src/features/agents/discovery-modal.tsx`
- Modify: `apps/desktop/src/features/authoring/authoring-page.tsx`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Test: `packages/security-scan/src/scan.test.ts`
- Test: `apps/desktop/src/security/client-scan.test.ts`

**Interfaces:**
- Consumes: package entries plus organization rules `{ blockedTerms, allowedNetworkHosts, executablePolicy }`.
- Produces: deterministic findings for secrets, entropy, sensitive names, personal/internal data, executable declarations, network declarations, path escape, oversized files, and source-tree patterns; blocking findings prevent requesting an upload URL.

- [ ] **Step 1: Add failing shared-policy and desktop tests** covering each scan category and asserting no cloud method is called when a blocking finding exists.
- [ ] **Step 2: Run focused tests and verify the missing categories fail.**
- [ ] **Step 3: Implement** one policy result model shared by TypeScript clients and mirrored by Rust discovery, including evidence digests without secret values.
- [ ] **Step 4: Run package, desktop, and security gate tests.**
- [ ] **Step 5: Commit** complete pre-upload scanning.

### Task 6: Wire durable offline write queue and synchronization

**Files:**
- Create: `apps/desktop/src/app/offline-queue.ts`
- Modify: `apps/desktop/src/app/cloud-client.ts`
- Modify: `apps/desktop/src/app/desktop-app.tsx`
- Modify: `apps/desktop/src/app/local-client.ts`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/desktop/src-tauri/src/database/mod.rs`
- Modify: `apps/desktop/src/features/settings/settings-page.tsx`
- Test: `apps/desktop/src/app/offline-queue.test.ts`
- Test: `apps/desktop/src-tauri/src/database/mod.rs`

**Interfaces:**
- Produces: `enqueueWrite`, `claimReadyWrites`, `completeWrite`, `rescheduleWrite`, `syncNow`; operations carry stable idempotency keys, attempt count, next run, and terminal error state.

- [ ] **Step 1: Write failing tests** for network failure persistence, restart recovery, exponential retry, exactly-once completion, permanent authorization failure, and status UI.
- [ ] **Step 2: Run focused tests and verify there is no runtime producer/consumer.**
- [ ] **Step 3: Implement** durable enqueue before network dispatch, online/startup draining, capped backoff, dead-letter state, manual retry, and cache permission revalidation.
- [ ] **Step 4: Run focused desktop/Rust tests and build.**
- [ ] **Step 5: Commit** offline synchronization.

### Task 7: Implement real pluggable SMS delivery

**Files:**
- Create: `apps/api/src/platform/notifications/sms.provider.ts`
- Modify: `apps/api/src/config/config.ts`
- Modify: `apps/api/src/modules/identity/notification.provider.ts`
- Modify: `apps/api/src/modules/organizations/invitation.sender.ts`
- Modify: `apps/api/src/platform/events/operations.worker.ts`
- Modify: `infra/compose/compose.production.yaml`
- Modify: `.env.example`
- Test: `apps/api/src/config/config.test.ts`
- Test: `apps/api/src/platform/notifications/sms.provider.test.ts`

**Interfaces:**
- Produces: `SmsProvider.send({ to, template, variables, idempotencyKey })`; HTTP provider uses configured endpoint/token/sender and a development provider writes to Mailpit only outside production.

- [ ] **Step 1: Write failing tests** proving production rejects absent SMS configuration, E.164 validation, provider request shape, idempotency header, timeout, retryable status classification, and redacted logs.
- [ ] **Step 2: Run API tests and confirm failure.**
- [ ] **Step 3: Implement** provider injection for verification, invitations, and worker notifications; add production Compose secrets/configuration.
- [ ] **Step 4: Run API tests, typecheck, and Compose config validation.**
- [ ] **Step 5: Commit** real SMS delivery.

### Task 8: Apply multi-dimensional throttling, recent reauthentication, and universal idempotency

**Files:**
- Create: `apps/api/src/platform/security/rate-limit.service.ts`
- Create: `apps/api/src/platform/security/recent-auth.guard.ts`
- Create: `apps/api/src/platform/idempotency/idempotency.interceptor.ts`
- Create: `apps/api/src/platform/idempotency/idempotency.store.ts`
- Modify: `apps/api/src/platform/platform.module.ts`
- Modify: identity, organization, access, capability, project, publication, distribution, and notification controllers
- Modify: `apps/api/src/modules/identity/session.service.ts`
- Test: `apps/api/src/platform/security/rate-limit.service.test.ts`
- Test: `apps/api/src/platform/security/recent-auth.guard.test.ts`
- Test: `apps/api/src/platform/idempotency/idempotency.interceptor.test.ts`

**Interfaces:**
- Produces: purpose-based account/IP/device throttles, a five-minute `recentlyAuthenticatedAt` claim, and Redis-backed idempotent response replay keyed by actor/tenant/method/path/key with body fingerprint.

- [ ] **Step 1: Write failing tests** for verification/invite/recovery throttles, stale authentication rejection for owner/role operations, replay, concurrent reservation, mismatched payload conflict, and expiry.
- [ ] **Step 2: Run focused API tests and verify failures.**
- [ ] **Step 3: Implement** reusable guards/interceptor and apply them to every mutating route; retain domain-level publication/install idempotency as defense in depth.
- [ ] **Step 4: Run API tests and tenant/security suites.**
- [ ] **Step 5: Commit** security controls and idempotency.

### Task 9: Generate OpenAPI and one shared TypeScript SDK

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/bootstrap.ts`
- Create: `apps/api/src/openapi.ts`
- Create: `packages/sdk/package.json`
- Create: `packages/sdk/src/client.ts`
- Create: `packages/sdk/src/generated.ts`
- Create: `scripts/generate-sdk.ts`
- Modify: `apps/web/src/app/api-client.ts`
- Modify: `apps/desktop/src/app/cloud-client.ts`
- Modify: `apps/cli/src/client.ts`
- Modify: `package.json`
- Test: `packages/sdk/src/client.test.ts`
- Test: `tests/acceptance/openapi-contract.spec.ts`

**Interfaces:**
- Produces: `/api/v1/openapi.json`, checked-in generated request/response types, and `AgentdoorClient` consumed by all three clients.

- [ ] **Step 1: Write failing contract tests** asserting OpenAPI includes every controller operation and generated output is unchanged after regeneration.
- [ ] **Step 2: Run the contract test and confirm the endpoint/package is absent.**
- [ ] **Step 3: Implement** Nest Swagger generation, deterministic SDK generation, shared auth/tenant/idempotency transport, and migrate clients without changing UI-facing interfaces.
- [ ] **Step 4: Run SDK tests, client tests, typecheck, and build.**
- [ ] **Step 5: Commit** OpenAPI and shared SDK.

### Task 10: Complete background jobs, operations visibility, and update notifications

**Files:**
- Modify: `apps/api/src/platform/events/operations.worker.ts`
- Modify: `apps/api/src/worker.ts`
- Modify: `apps/api/src/db/schema/operations.ts`
- Add: `apps/api/migrations/0010_operations_jobs.sql`
- Modify: `apps/api/src/modules/notifications/notification.service.ts`
- Modify: `apps/api/src/modules/analytics/analytics.repository.ts`
- Modify: `apps/web/src/features/security/security-page.tsx`
- Test: `apps/api/src/platform/events/operations.worker.test.ts`

**Interfaces:**
- Produces: idempotent jobs for server scan, search document refresh, version-update notifications, daily aggregates, audit archive, object cleanup, retry limits, dead-letter listing, and administrator retry.

- [ ] **Step 1: Write failing tests** for every job type, duplicate delivery, capped retry, dead-letter visibility, update notification fan-out, and aggregate replacement.
- [ ] **Step 2: Run focused tests and verify unsupported jobs fail.**
- [ ] **Step 3: Implement** persisted job state, processors, metrics, administrator operations endpoints/UI, and retention-safe archival.
- [ ] **Step 4: Run API/Web tests and worker integration checks.**
- [ ] **Step 5: Commit** the completed worker platform.

### Task 11: Add organization export, ownership/closure UI, and deletion lifecycle

**Files:**
- Add: `apps/api/migrations/0011_data_lifecycle.sql`
- Modify: `apps/api/src/modules/organizations/organization.controller.ts`
- Modify: `apps/api/src/modules/organizations/organization.service.ts`
- Modify: `apps/api/src/modules/organizations/organization.repository.ts`
- Modify: `apps/web/src/app/api-client.ts`
- Modify: `apps/web/src/features/organizations/settings-page.tsx`
- Test: `apps/api/src/modules/organizations/organization.service.test.ts`
- Test: `apps/web/src/app/web-app.test.tsx`

**Interfaces:**
- Produces: streamed organization export manifest, ownership transfer, close request with grace period, cancel closure, scheduled hard deletion, member account export, and account deletion request.

- [ ] **Step 1: Write failing tests** for owner-only export/transfer/closure, recent-auth enforcement, immutable audit events, cancellation, grace expiry deletion, storage cleanup, and UI confirmation.
- [ ] **Step 2: Run focused API/Web tests and verify missing flows fail.**
- [ ] **Step 3: Implement** lifecycle state and worker deletion with referential cleanup; expose guarded Web settings controls.
- [ ] **Step 4: Run API/Web/security/tenant tests.**
- [ ] **Step 5: Commit** data lifecycle management.

### Task 12: Wire signed desktop updates, cross-platform artifacts, and real final acceptance

**Files:**
- Modify: `apps/desktop/src-tauri/src/main.rs`
- Create: `apps/desktop/src/app/updater.ts`
- Modify: `apps/desktop/src/features/settings/settings-page.tsx`
- Modify: `.github/workflows/release.yml`
- Modify: `scripts/acceptance-stack.ts`
- Modify: `tests/acceptance/agentdoor-mvp.spec.ts`
- Create: `tests/acceptance/desktop-runtime.spec.ts`
- Modify: `docs/acceptance-report.md`
- Modify: `docs/admin-guide/release-signing.md`

**Interfaces:**
- Produces: signed manifest check/download/install/restart UI, macOS universal and Windows x64 bundles with checksums/SBOM/provenance, and an acceptance harness that invokes the Rust runtime for update/conflict/import/recovery/uninstall.

- [ ] **Step 1: Write failing acceptance tests** that call the real Rust command surface, prove clean update, modified-file conflict with diff/import/recovery, transactional uninstall, updater error states, and artifact metadata validation.
- [ ] **Step 2: Run the focused acceptance and release tests and verify the old mocked/string-only checks fail.**
- [ ] **Step 3: Implement** updater commands/UI, release matrices and signing gates, real runtime harness, and accurate acceptance reporting.
- [ ] **Step 4: Run** `pnpm release:verify`, desktop Rust tests, desktop Playwright, Compose health/smoke, CLI packaging, and artifact checksum verification.
- [ ] **Step 5: Commit** release readiness and final acceptance evidence.

## Plan Self-Review

- Coverage maps every P0 item and each gap identified by the 2026-08-08 intended-versus-implemented audit to one task.
- Each production behavior starts with a focused failing test and ends with a full-surface verification.
- Shared interfaces use consistent names across tasks: install locks feed plans, security results gate upload, idempotency keys feed offline replay, and generated SDK transport serves all clients.
- The plan deliberately preserves the approved product boundary: no SSO, billing, semantic search, external guests, source-code indexing, or hosted Agent execution is introduced.
