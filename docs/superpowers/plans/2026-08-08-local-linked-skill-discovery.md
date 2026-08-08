# Local Linked Skill Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover direct, nested, plugin-provided, and symbolically linked local Skills from trusted Agent roots without allowing a Skill package to read outside its canonical package root.

**Architecture:** Add a focused Rust discovery module that enumerates trusted Skill roots, follows root-level directory links with cycle detection, identifies packages by `SKILL.md`, and returns canonical source paths plus non-fatal diagnostics. Keep a separate read-only discovery path policy so dynamically discovered external targets never become installation write roots, then expose one Tauri command consumed by the existing discovery modal.

**Tech Stack:** Rust 2024, `walkdir`, Tauri 2 commands, React 19, TypeScript, Vitest, Cargo tests.

## Global Constraints

- Trusted roots include `~/.agents/skills`, `~/.codex/skills`, installed Codex plugin `skills` directories, and bound project `.agents/skills` directories.
- A capability directory is valid only when it contains a regular `SKILL.md` file.
- A symlink entered from a trusted Skill root may point inside or outside the user home directory.
- Broken links, cycles, permission errors, and invalid packages are isolated diagnostics and do not abort the full discovery run.
- Internal links resolving outside the canonical capability package root are rejected.
- Dynamically discovered roots are read-only and must never be added to installation write policy.
- Existing Prompt, Context, installation, uninstall, and project-context behavior remains unchanged.

---

## File Structure

- Create `apps/desktop/src-tauri/src/skill_discovery.rs`: trusted-root enumeration, safe link traversal, canonical package detection, diagnostics, and unit tests.
- Modify `apps/desktop/src-tauri/src/lib.rs`: export the discovery module.
- Modify `apps/desktop/src-tauri/src/commands/mod.rs`: own the separate discovery read policy, expose discovery and source-based scan/export operations, and retain existing installation policy.
- Modify `apps/desktop/src-tauri/src/main.rs`: register the new Tauri command.
- Modify `apps/desktop/src/generated/commands.ts`: add generated bridge types and command name.
- Modify `apps/desktop/src/app/types.ts`: add the local-client discovery contract.
- Modify `apps/desktop/src/app/local-client.ts`: invoke the new command.
- Modify `apps/desktop/src/features/agents/discovery-modal.tsx`: consume aggregated discovery results, show source labels and non-fatal diagnostics, and use canonical source paths for scan/export.
- Modify `apps/desktop/src/test/fixtures.ts`: provide deterministic discovery fixtures.
- Modify `apps/desktop/src/features/agents/discovery-modal.test.tsx` or `apps/desktop/src/app/app.test.tsx`: cover linked/global discovery UI behavior.
- Modify `docs/user-guide/desktop.md` and `docs/user-guide/troubleshooting.md`: document supported roots and skipped-link diagnostics.

### Task 1: Safe Skill Root Traversal

**Files:**
- Create: `apps/desktop/src-tauri/src/skill_discovery.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `Path`, `PathBuf`, `walkdir::WalkDir`, SHA-256 package hashing supplied later by the runtime.
- Produces:

```rust
pub enum SkillSourceKind { Global, Shared, Plugin, Workspace }

pub struct TrustedSkillRoot {
    pub adapter_id: String,
    pub display_name: String,
    pub scope: String,
    pub source_kind: SkillSourceKind,
    pub path: PathBuf,
}

pub struct DiscoveredSkillPackage {
    pub adapter_id: String,
    pub display_name: String,
    pub scope: String,
    pub source_kind: SkillSourceKind,
    pub source_root: PathBuf,
    pub package_root: PathBuf,
    pub slug: String,
    pub linked: bool,
}

pub struct DiscoveryIssue {
    pub path: String,
    pub reason: String,
}

pub struct SkillDiscoveryReport {
    pub packages: Vec<DiscoveredSkillPackage>,
    pub issues: Vec<DiscoveryIssue>,
}

pub fn discover_skill_packages(roots: &[TrustedSkillRoot]) -> SkillDiscoveryReport;
```

- [ ] **Step 1: Write failing traversal tests**

Add Unix tests that create direct, nested, external-linked, duplicate-linked, broken, cyclic, and internal-escape fixtures. Assertions must require direct and linked packages, canonical-path deduplication, `broken-symlink`/`symlink-cycle` diagnostics, and rejection of a package whose `SKILL.md` itself resolves outside its package root.

```rust
#[cfg(unix)]
#[test]
fn discovers_nested_and_external_linked_skills_once() {
    use std::os::unix::fs::symlink;
    let home = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let skills = home.path().join(".codex/skills");
    std::fs::create_dir_all(skills.join(".system/imagegen")).unwrap();
    std::fs::write(skills.join(".system/imagegen/SKILL.md"), "# Imagegen").unwrap();
    std::fs::create_dir_all(outside.path().join("shared")).unwrap();
    std::fs::write(outside.path().join("shared/SKILL.md"), "# Shared").unwrap();
    symlink(outside.path().join("shared"), skills.join("shared-a")).unwrap();
    symlink(outside.path().join("shared"), skills.join("shared-b")).unwrap();

    let report = discover_skill_packages(&[TrustedSkillRoot::codex_global(skills)]);

    assert_eq!(report.packages.iter().filter(|item| item.slug == "shared").count(), 1);
    assert!(report.packages.iter().any(|item| item.slug == "imagegen"));
}
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml skill_discovery -- --nocapture`

Expected: compilation failure because `skill_discovery` and its interfaces do not exist.

- [ ] **Step 3: Implement minimal safe traversal**

Implement root normalization, recursive directory traversal, explicit symlink resolution, visited-real-directory tracking, package detection by regular in-root `SKILL.md`, canonical package-path deduplication, deterministic sorting, and isolated issues. Do not use `WalkDir::follow_links(true)` without an explicit visited set and containment check.

The internal containment check must follow this rule:

```rust
let canonical_entry = entry_path.canonicalize().map_err(|_| "broken-symlink")?;
if inside_confirmed_package && !canonical_entry.starts_with(&canonical_package_root) {
    return Err("package-symlink-escape");
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml skill_discovery -- --nocapture`

Expected: all new discovery tests pass.

- [ ] **Step 5: Commit traversal unit**

```bash
git add apps/desktop/src-tauri/src/skill_discovery.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat: discover linked local skills safely"
```

### Task 2: Runtime Read-Only Discovery Boundary

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`

**Interfaces:**
- Consumes: `discover_skill_packages`, `TrustedSkillRoot`, and the existing installation `PathPolicy`.
- Produces:

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredLocalSkill {
    pub adapter_id: String,
    pub display_name: String,
    pub scope: String,
    pub source_kind: String,
    pub linked: bool,
    pub source_path: String,
    pub slug: String,
    pub digest: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSkillDiscoveryResult {
    pub skills: Vec<DiscoveredLocalSkill>,
    pub issues: Vec<DiscoveryIssue>,
}

impl Runtime {
    pub fn discover_local_skills(&self) -> RuntimeResult<LocalSkillDiscoveryResult>;
}
```

- [ ] **Step 1: Write failing runtime tests**

Add tests to `commands::tests` that construct `.agents`, `.codex`, plugin-cache, workspace, and external-link fixtures. Assert that `discover_local_skills()` aggregates them, assigns source kinds, and deduplicates real paths. Add a negative assertion proving an arbitrary external directory not introduced through a trusted root still fails `scan_local_package` with `PathNotAllowed`.

- [ ] **Step 2: Run tests and verify RED**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml commands::tests::discovers_all_trusted_skill_sources -- --exact --nocapture`

Expected: compilation failure because `discover_local_skills` does not exist.

- [ ] **Step 3: Add a separate read policy**

Extend `Runtime` with a `discovery_policy: PathPolicy`. Initialize it independently from `engine.policy()` and only add canonical package roots returned by `discover_local_skills()`.

```rust
pub struct Runtime {
    database: Database,
    engine: FileEngine,
    discovery_policy: PathPolicy,
    projects: ProjectEngine,
    home_dir: PathBuf,
    project_root: Option<PathBuf>,
    credentials: Arc<dyn CredentialStore>,
}
```

Build trusted roots from existing Agent directories plus `.codex/skills` and plugin-cache `skills` directories. Bound projects contribute `<project>/.agents/skills`.

- [ ] **Step 4: Make scan/export source-based without widening writes**

Add optional `source_path` to `ExportPackageInput`. When supplied, canonicalize it, require exact membership in `discovery_policy.roots()`, and export from that package root. Keep the existing root/slug path for install-managed direct components.

Update `scan_local_package` to authorize canonical selected paths against either existing read roots or `discovery_policy`, but do not call `engine.policy().add_root()` for linked targets.

Implement a package walker shared by digest, scan, and export that follows only links resolving within the canonical package root and rejects `package-symlink-escape`.

- [ ] **Step 5: Run focused and full Rust tests**

Run:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml commands::tests::discovers_all_trusted_skill_sources -- --exact --nocapture
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Expected: focused test and all runtime tests pass; existing forged-root and symlink-escape tests remain green.

- [ ] **Step 6: Commit runtime integration**

```bash
git add apps/desktop/src-tauri/src/commands/mod.rs
git commit -m "feat: expose read-only global skill discovery"
```

### Task 3: Tauri and TypeScript Bridge

**Files:**
- Modify: `apps/desktop/src-tauri/src/main.rs`
- Modify: `apps/desktop/src/generated/commands.ts`
- Modify: `apps/desktop/src/app/types.ts`
- Modify: `apps/desktop/src/app/local-client.ts`
- Modify: `apps/desktop/src/test/fixtures.ts`

**Interfaces:**
- Consumes: `Runtime::discover_local_skills()`.
- Produces:

```ts
export type DiscoveredLocalSkill = {
  adapterId: 'codex' | 'claude-code' | 'cursor' | 'gemini-cli';
  displayName: string;
  scope: 'user' | 'workspace';
  sourceKind: 'global' | 'shared' | 'plugin' | 'workspace';
  linked: boolean;
  sourcePath: string;
  slug: string;
  digest: string;
};

export type LocalSkillDiscoveryResult = {
  skills: DiscoveredLocalSkill[];
  issues: Array<{ path: string; reason: string }>;
};

discoverLocalSkills(): Promise<LocalSkillDiscoveryResult>;
```

- [ ] **Step 1: Write a failing bridge contract test**

Extend the existing local-client or app fixture test to call `discoverLocalSkills()` and expect one linked Skill with its canonical `sourcePath` and `sourceKind: 'symlink'`.

- [ ] **Step 2: Run the TypeScript test and verify RED**

Run: `pnpm --filter @capaport/desktop test -- app`

Expected: type or assertion failure because the local-client method is missing.

- [ ] **Step 3: Register and type the command**

Add the Tauri wrapper and register `discover_local_skills` in the invoke handler. Update generated command types, `LocalClient`, the Tauri implementation, and deterministic test fixture. Extend `ExportPackageInput` and its TypeScript call type with optional `sourcePath`.

- [ ] **Step 4: Run typecheck and bridge tests**

Run:

```bash
pnpm --filter @capaport/desktop typecheck
pnpm --filter @capaport/desktop test -- app
```

Expected: typecheck and bridge/app tests pass.

- [ ] **Step 5: Commit bridge changes**

```bash
git add apps/desktop/src-tauri/src/main.rs apps/desktop/src/generated/commands.ts apps/desktop/src/app/types.ts apps/desktop/src/app/local-client.ts apps/desktop/src/test/fixtures.ts
git commit -m "feat: bridge global skill discovery to desktop"
```

### Task 4: Discovery Modal Integration and Diagnostics

**Files:**
- Modify: `apps/desktop/src/features/agents/discovery-modal.tsx`
- Test: `apps/desktop/src/features/agents/discovery-modal.test.tsx`
- Modify: `apps/desktop/src/styles.css` only if the diagnostic/source label needs an existing-compatible style hook.

**Interfaces:**
- Consumes: `LocalClient.discoverLocalSkills()` and `DiscoveredLocalSkill.sourcePath`.
- Produces: a deduplicated local inventory whose Skill scan/export calls use the canonical `sourcePath`.

- [ ] **Step 1: Write failing UI tests**

Render the modal with a local client returning direct and linked Skills plus one broken-link issue. Assert that both valid Skills appear once, their source labels are shown, the skipped issue is non-fatal, and clicking import calls `scanLocalPackage(sourcePath)`.

```tsx
expect(await screen.findByText('linked-review')).toBeVisible();
expect(screen.getByText('符号链接')).toBeVisible();
expect(screen.getByText(/跳过 1 项无效路径/)).toBeVisible();
fireEvent.click(screen.getByRole('button', { name: '导入 linked-review' }));
await waitFor(() => expect(local.scanLocalPackage).toHaveBeenCalledWith('/external/linked-review'));
```

- [ ] **Step 2: Run UI test and verify RED**

Run: `pnpm --filter @capaport/desktop test -- discovery-modal.test.tsx`

Expected: FAIL because the modal still uses `detectAgents` plus first-level `inventoryAgent` only.

- [ ] **Step 3: Integrate aggregated discovery**

Load `detectAgents()` and `discoverLocalSkills()` together. Keep existing Prompt and Context inventory, replace Codex Skill entries with aggregated Skill results, and deduplicate by canonical `sourcePath`. Use Chinese source labels `全局`、`共享`、`插件`、`项目`; when `linked` is true, append `符号链接` without losing the original source kind.

On selection call `scanLocalPackage(skill.sourcePath)`. On export pass `sourcePath` so linked and nested packages do not depend on `root/skills/<slug>` reconstruction. Show issue count and reason summary without exposing file content.

- [ ] **Step 4: Run UI tests and desktop suite**

Run:

```bash
pnpm --filter @capaport/desktop test -- discovery-modal.test.tsx
pnpm --filter @capaport/desktop test
```

Expected: discovery tests and the full desktop suite pass.

- [ ] **Step 5: Commit UI integration**

```bash
git add apps/desktop/src/features/agents/discovery-modal.tsx apps/desktop/src/features/agents/discovery-modal.test.tsx apps/desktop/src/styles.css
git commit -m "feat: show global and linked skills in discovery"
```

### Task 5: Documentation and Full Verification

**Files:**
- Modify: `docs/user-guide/desktop.md`
- Modify: `docs/user-guide/troubleshooting.md`

**Interfaces:**
- Consumes: final supported roots and diagnostic reason names.
- Produces: user-facing documentation matching runtime behavior.

- [ ] **Step 1: Update supported-directory documentation**

Document `.agents/skills`, `.codex/skills`, plugin skills, project skills, external linked targets, canonical deduplication, and why internal package escapes remain blocked.

- [ ] **Step 2: Run formatting and static validation**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
```

Expected: all commands exit 0.

- [ ] **Step 3: Run complete relevant tests and builds**

Run:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter @capaport/desktop test
pnpm --filter @capaport/desktop build
pnpm security:gate
```

Expected: all tests, desktop build, and security gate pass.

- [ ] **Step 4: Perform live discovery smoke check**

Run the desktop runtime against the current home directory and verify that discovered canonical Skill paths include entries from both `~/.agents/skills` and `~/.codex/skills`, including at least one symlinked collection, without duplicate canonical paths.

- [ ] **Step 5: Commit documentation and verification contract**

```bash
git add docs/user-guide/desktop.md docs/user-guide/troubleshooting.md
git commit -m "docs: explain global linked skill discovery"
```
