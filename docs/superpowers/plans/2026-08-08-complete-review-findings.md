# CapaPort Complete Review Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve every confirmed review finding and leave CapaPort with a passing release gate across cloud, Web, Desktop, CLI, adapters, containers, and documentation.

**Architecture:** Preserve the modular-monolith cloud and local-adapter architecture. Fix authorization and state at their server-side trust boundaries, keep local file transactions durable, expose organization security policy through contracts/API/Web/Desktop, and complete the breaking CapaPort-to-CapaPort namespace migration across source and delivery artifacts.

**Tech Stack:** TypeScript 7, React 19, NestJS, PostgreSQL/Drizzle, Tauri 2/Rust, Vitest, Playwright, pnpm/Turbo, Docker Compose, GitHub Actions.

## Global Constraints

- Product name is `CapaPort`; package scope, CLI, protocol, runtime namespace, environment prefix, Docker assets, and documentation use `capaport`/`CAPAPORT_` with no legacy compatibility aliases.
- Organization space publication remains mandatory-review; personal spaces remain private.
- Project context never uploads business source and requires contributor-or-manager write authority.
- Desktop release supports macOS and Windows; Linux remains CLI-first.
- Every behavior change follows a failing-test-first red/green cycle.

---

### Task 1: Project-context authorization

**Files:**
- Modify: `apps/api/src/modules/projects/project.controller.ts`
- Modify: `apps/api/src/modules/projects/project.service.ts`
- Test: `apps/api/src/modules/projects/project.service.test.ts`
- Test: `apps/api/tests/tenancy/space-access.spec.ts`

**Interfaces:**
- Consumes: `SpaceService.authorize(tenant, userId, spaceId, action)`.
- Produces: reads require `space:view`; binding/context writes require `content:create`.

- [ ] Add tests proving viewers cannot create/remove bindings or register context while contributors can.
- [ ] Run the focused tests and confirm `ACCESS_DENIED` failures.
- [ ] Add method-level guards and service-level action checks.
- [ ] Run focused tests and confirm they pass.

### Task 2: Canonical local paths and transactional uninstall

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/desktop/src-tauri/src/files/mod.rs`
- Test: `apps/desktop/src-tauri/src/bin/runtime_harness.rs`
- Test: `tests/acceptance/desktop-runtime.spec.ts`

**Interfaces:**
- Consumes: `Path::canonicalize()` and `Database::{load_lock,save_lock}`.
- Produces: one canonical root string for install, lookup, uninstall, rollback, and restart.

- [ ] Run the harness and retain the `runtime-harness-error=NOT_FOUND` red result.
- [ ] Normalize the root before every lock read/write and preserve raw-path fallback for existing local locks.
- [ ] Run Rust unit tests and the harness; require the seven-field JSON success report.

### Task 3: Current installation projection

**Files:**
- Modify: `apps/api/src/modules/distribution/distribution.repository.ts`
- Test: `apps/api/src/modules/distribution/distribution.service.test.ts`
- Test: `apps/api/tests/e2e/distribution.spec.ts`
- Modify: `apps/desktop/src/app/desktop-app.tsx`
- Modify: `apps/desktop/src/features/library/library-page.tsx`
- Modify: `apps/cli/src/commands/sync.ts`

**Interfaces:**
- Produces: `listInstallations()` returns only the latest record per user/device/capability/agent identity while analytics retains immutable events.

- [ ] Add a repository/E2E test for install → update → uninstall yielding one current `uninstalled` projection.
- [ ] Confirm it fails because historical `installed` rows are returned.
- [ ] Implement deterministic `DISTINCT ON` current-state projection and client-side defensive reduction.
- [ ] Confirm API, Desktop, and CLI tests pass.

### Task 4: Desktop session lifecycle and production connectivity

**Files:**
- Modify: `apps/desktop/src/app/cloud-client.ts`
- Modify: `apps/desktop/src/app/desktop-app.tsx`
- Modify: `apps/desktop/src/app/types.ts`
- Test: `apps/desktop/src/app/app.test.tsx`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `.github/workflows/release.yml`
- Modify: `apps/api/src/bootstrap.ts`
- Modify: `apps/api/src/config/config.ts`

**Interfaces:**
- Produces: SDK `session`/`saveSession` callbacks, cloud logout/revocation, configurable `CORS_ORIGINS`, build-time `CAPAPORT_API_URL`, and a GitHub Releases updater endpoint.

- [ ] Add tests for refresh-token persistence and server logout invocation.
- [ ] Confirm current Desktop tests fail.
- [ ] Wire the secure session store into the SDK and await cloud logout before local clearing.
- [ ] Replace placeholder/local-only release configuration with required repository variables and HTTPS CSP connectivity.
- [ ] Run Desktop, SDK, API config, and release-delivery tests.

### Task 5: Organization security policy and security center

**Files:**
- Create: `packages/contracts/src/security.ts`
- Create: `apps/api/migrations/0008_security_policy.sql`
- Create: `apps/api/src/modules/organizations/security-policy.service.ts`
- Modify: organization controller/module/repository files
- Modify: `apps/web/src/app/types.ts`
- Modify: `apps/web/src/app/client.ts`
- Modify: `apps/web/src/features/security/security-page.tsx`
- Modify: `apps/desktop/src/app/cloud-client.ts`
- Modify: Desktop authoring/discovery scan callers
- Test: API, Web, and Desktop security tests

**Interfaces:**
- Produces: `GET/PATCH /organizations/security-policy` returning blocked terms, allow-listed hosts/paths, executable policy, and severity settings.

- [ ] Add contract/API tests for defaults, admin updates, member read, and member update denial.
- [ ] Confirm endpoint tests fail.
- [ ] Add migration, repository/service/controller, audit event, and OpenAPI operation.
- [ ] Add Security Center editor and pass fetched policy into every pre-upload Desktop scan.
- [ ] Run focused API/Web/Desktop tests.

### Task 6: Offline writes, analytics, and workspace discovery

**Files:**
- Modify: `apps/desktop/src/features/authoring/authoring-page.tsx`
- Modify: `apps/desktop/src/app/offline-queue.ts`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: Desktop/CLI/Web cloud clients and success handlers
- Test: offline queue, authoring, analytics, and Rust discovery tests

**Interfaces:**
- Produces: unchanged saved drafts can queue submission while offline; clients emit allow-listed product events; Agent detection includes persisted project roots.

- [ ] Add failing tests for offline enqueue, real-client analytics calls, and persisted project-root detection.
- [ ] Implement the minimum queue/UI changes, best-effort analytics emission, and dynamic discovery roots.
- [ ] Run focused TypeScript and Rust tests.

### Task 7: Complete CapaPort breaking migration

**Files:**
- Rename/update: all tracked source, package manifests, protocol fixtures, Rust identifiers, Docker assets, workflows, scripts, docs, and user-facing copy.
- Regenerate: `pnpm-lock.yaml`, `apps/api/openapi.json`, CLI artifact names.

**Interfaces:**
- Produces: `@capaport/*`, `capaport` CLI, `capaport.yaml`, `capaport.io/v1alpha1`, `CAPAPORT_*`, CapaPort runtime/service identifiers.

- [ ] Add/update residual-scan acceptance asserting no legacy tokens outside Git history.
- [ ] Confirm it fails on the existing namespace.
- [ ] Perform mechanical scope/protocol/runtime/environment migration and rename current documents.
- [ ] Regenerate lockfile/OpenAPI and fix all compile/test fallout.
- [ ] Run the residual scan until it returns zero.

### Task 8: Release gate, documentation, and remote

**Files:**
- Create: `scripts/e2e-stack.ts`
- Modify: `package.json`
- Modify: `.github/workflows/release.yml`
- Modify: `docs/acceptance-report.md` after migration rename
- Modify: setup/admin/user documentation

**Interfaces:**
- Produces: a release gate covering lint, fresh type/test/build, security, acceptance, stack smoke, Web/Desktop Playwright, CLI container E2E, and residual brand scan.

- [ ] Add release-delivery tests that require every gate.
- [ ] Confirm the tests fail against the current scripts.
- [ ] Implement managed-stack E2E orchestration with guaranteed Compose cleanup.
- [ ] Update acceptance evidence only after fresh successful runs.
- [ ] Configure `origin` as `https://github.com/qiujunbiao/CapaPort.git` without pushing.

### Task 9: Full verification

**Files:**
- Verify all changed files and generated artifacts.

**Interfaces:**
- Produces: release evidence and a clean, reviewable branch.

- [ ] Run `pnpm lint` and `pnpm format:check`.
- [ ] Run `pnpm turbo run typecheck test build --force`.
- [ ] Run `PATH=/Users/mingdao/.cargo/bin:$PATH pnpm security:gate`.
- [ ] Run Rust tests and runtime harness.
- [ ] Run Web/Desktop Playwright and CLI container E2E.
- [ ] Run `pnpm acceptance` and `pnpm stack:smoke` sequentially.
- [ ] Run SDK/OpenAPI/artifact/residual checks and inspect `git diff --check`.

## Self-review

- Spec coverage: every confirmed review finding maps to Tasks 1–8; release evidence is Task 9.
- Placeholder scan: no deferred implementation markers are present.
- Type consistency: organization policy uses one shared contract; installation projection preserves existing API response types; CapaPort migration is intentionally breaking with no compatibility aliases.
