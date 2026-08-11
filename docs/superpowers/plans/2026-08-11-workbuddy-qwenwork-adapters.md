# WorkBuddy and QwenWork Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add complete Skill discovery, import, install, update/conflict, rollback, and uninstall support for WorkBuddy and QwenWork across CapaPort's shared contracts, CLI, and desktop client.

**Architecture:** Extend the filesystem adapter SDK so an adapter can expose only the installation scopes its client actually supports. Implement two focused filesystem adapters, then propagate the new Agent IDs and Skill-only component matrix through contracts, CLI, Rust desktop discovery, TypeScript install planning, UI copy, fixtures, and documentation.

**Tech Stack:** TypeScript 7, Zod, Vitest, pnpm/Turborepo, Rust/Tauri, Cargo tests, Markdown.

## Global Constraints

- Machine IDs are exactly `workbuddy` and `qwenwork`.
- Display labels are exactly `WorkBuddy` and `千问 Work（QwenWork）`.
- WorkBuddy user root is `~/.workbuddy`; WorkBuddy workspace root is `<project>/.codebuddy`.
- QwenWork user root is `~/.qwenworkcn`; QwenWork has no workspace root.
- Both adapters support only the `skill` component.
- Never convert `prompt` or `context` into a Skill.
- Preserve all regular files below a Skill directory, including `scripts/`, `references/`, and `assets/`.
- Keep path allowlisting, digest verification, conflict protection, atomic writes, rollback, and safe uninstall behavior unchanged.
- Existing Codex, Claude Code, Cursor, and Gemini CLI behavior must remain backward compatible.

---

## File Structure

### New files

- `adapters/workbuddy/package.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts`: WorkBuddy adapter package and compliance coverage.
- `adapters/qwenwork/package.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts`: QwenWork adapter package and user-only compliance coverage.
- `tests/fixtures/agents/workbuddy/home/.workbuddy/skills/release/SKILL.md`: checked-in native fixture.
- `tests/fixtures/agents/qwenwork/home/.qwenworkcn/skills/release/SKILL.md`: checked-in native fixture.
- `apps/cli/src/installations.ts`, `installations.test.ts`: one source of truth for Agent scope-to-root resolution.

### Modified files

- `packages/adapter-sdk/src/types.ts`, `filesystem-adapter.ts`, `compliance.ts`, `compliance.test.ts`: optional scope roots and shared compliance behavior.
- `packages/domain-types/src/index.ts`: canonical Agent IDs.
- `packages/capability-kit/src/schema.ts`, `editor.ts`, `editor.test.ts`, `index.test.ts`: manifest and authoring compatibility.
- `packages/contracts/src/capabilities.ts`, `capabilities.test.ts`, `distribution.ts`, `distribution.test.ts`, `projects.ts`, `projects.test.ts`: API schemas and six-Agent bounds.
- `apps/cli/package.json`, `src/adapters.ts`, `src/commands/install.ts`, `src/commands/uninstall.ts`, CLI tests: package registration and correct scope handling.
- `apps/desktop/src-tauri/src/commands/mod.rs`: per-Agent user/workspace roots and native component discovery.
- `apps/desktop/src/app/install-plan.ts`, `install-plan.test.ts`: Skill install profiles.
- `apps/desktop/src/features/authoring/authoring-page.tsx`: complete authoring Agent list.
- `apps/desktop/src/features/agents/discovery-modal.tsx`, `home-page.tsx` and related tests/fixtures: six-client display and discovery behavior.
- `apps/desktop/src/generated/commands.ts`: regenerated/updated Agent unions.
- `README.md`, `PRD-CapaPort.md`, `docs/user-guide/cli.md`, `docs/user-guide/desktop.md`, `CHANGELOG.md`: public compatibility documentation.
- `pnpm-lock.yaml`: workspace package graph.

---

### Task 1: Make filesystem adapter scopes optional

**Files:**
- Modify: `packages/adapter-sdk/src/types.ts`
- Modify: `packages/adapter-sdk/src/filesystem-adapter.ts`
- Modify: `packages/adapter-sdk/src/compliance.ts`
- Modify: `packages/adapter-sdk/src/compliance.test.ts`

**Interfaces:**
- Produces: `FilesystemAdapterRoots`, a non-empty union permitting user-only, workspace-only, or dual-scope roots.
- Produces: `AdapterComplianceOptions.roots` and `supportedScopes`, used by new adapter packages.
- Preserves: `AgentAdapter` public methods and `InstallScope = 'user' | 'workspace'`.

- [ ] **Step 1: Write failing optional-scope tests**

Add a user-only adapter case to `compliance.test.ts`:

```ts
defineAdapterComplianceSuite({
  name: 'user-only fake adapter',
  adapterId: 'user-only-fake',
  supportedComponents: ['skill'],
  supportedScopes: ['user'],
  roots: { user: '.user-only-fake' },
  createAdapter: (environment) =>
    createFilesystemAdapter({
      id: 'user-only-fake',
      displayName: 'User-only Fake Agent',
      supportedComponents: ['skill'],
      environment,
      roots: { user: '.user-only-fake' },
      directories: { skill: 'skills' },
    }),
});
```

In the shared suite, add an assertion that a forged workspace installation is rejected when `supportedScopes` excludes `workspace`.

- [ ] **Step 2: Run the test and verify the type/runtime failure**

Run: `pnpm --filter @capaport/adapter-sdk test`

Expected: FAIL because `roots.workspace` is required and the suite assumes two installations.

- [ ] **Step 3: Implement a non-empty optional roots type and scope-aware root lookup**

Add to `types.ts`:

```ts
export type FilesystemAdapterRoots =
  | { user: string; workspace?: string }
  | { user?: string; workspace: string };
```

Change `FilesystemAdapterConfig.roots` to `FilesystemAdapterRoots`. In `rootFor`, read `config.roots[scope]` first and return `undefined` when absent:

```ts
function rootFor(config: FilesystemAdapterConfig, scope: InstallScope): string | undefined {
  const relativeRoot = config.roots[scope];
  if (!relativeRoot) return undefined;
  const base = scope === 'user' ? config.environment.homeDir : config.environment.projectRoot;
  if (!base) return undefined;
  return joinPlatform(config.environment.platform, base, relativeRoot);
}
```

Import `InstallScope` in `filesystem-adapter.ts`. Keep `detect`, allowlist checks, inventory, install planning, validation, and uninstall dependent on `rootFor`, so an unconfigured scope fails closed.

- [ ] **Step 4: Make the compliance suite scope-aware**

Extend the options type:

```ts
export type AdapterComplianceOptions = {
  name: string;
  adapterId: string;
  supportedComponents: readonly ComponentType[];
  supportedScopes?: readonly InstallScope[];
  roots?: Partial<Record<InstallScope, string>>;
  fixtureHomeDir?: string;
  createAdapter(environment: AdapterEnvironment): AgentAdapter;
};
```

Default `supportedScopes` to `['user', 'workspace']`, create only configured fixture roots, assert detected scopes against that list, and make the Windows test use `options.roots?.user ?? fixtureRootName(options.adapterId)`.

- [ ] **Step 5: Run SDK tests and typecheck**

Run: `pnpm --filter @capaport/adapter-sdk test && pnpm --filter @capaport/adapter-sdk typecheck`

Expected: both commands PASS; dual-scope and user-only compliance cases pass.

- [ ] **Step 6: Commit**

```bash
git add packages/adapter-sdk/src/types.ts packages/adapter-sdk/src/filesystem-adapter.ts packages/adapter-sdk/src/compliance.ts packages/adapter-sdk/src/compliance.test.ts
git commit -m "feat(adapter-sdk): support scope-specific roots"
```

---

### Task 2: Add WorkBuddy and QwenWork adapter packages

**Files:**
- Create: `adapters/workbuddy/package.json`
- Create: `adapters/workbuddy/tsconfig.json`
- Create: `adapters/workbuddy/src/index.ts`
- Create: `adapters/workbuddy/src/index.test.ts`
- Create: `adapters/qwenwork/package.json`
- Create: `adapters/qwenwork/tsconfig.json`
- Create: `adapters/qwenwork/src/index.ts`
- Create: `adapters/qwenwork/src/index.test.ts`
- Create: `tests/fixtures/agents/workbuddy/home/.workbuddy/skills/release/SKILL.md`
- Create: `tests/fixtures/agents/qwenwork/home/.qwenworkcn/skills/release/SKILL.md`

**Interfaces:**
- Consumes: `createFilesystemAdapter` and scope-aware compliance options from Task 1.
- Produces: `createWorkBuddyAdapter(environment?)` and `createQwenWorkAdapter(environment?)`.

- [ ] **Step 1: Create failing adapter tests and native fixtures**

Use this WorkBuddy test:

```ts
defineAdapterComplianceSuite({
  name: 'WorkBuddy',
  adapterId: 'workbuddy',
  supportedComponents: ['skill'],
  supportedScopes: ['user', 'workspace'],
  roots: { user: '.workbuddy', workspace: '.codebuddy' },
  fixtureHomeDir: resolve(import.meta.dirname, '../../../tests/fixtures/agents/workbuddy/home'),
  createAdapter: createWorkBuddyAdapter,
});
```

Use this QwenWork test:

```ts
defineAdapterComplianceSuite({
  name: 'QwenWork',
  adapterId: 'qwenwork',
  supportedComponents: ['skill'],
  supportedScopes: ['user'],
  roots: { user: '.qwenworkcn' },
  fixtureHomeDir: resolve(import.meta.dirname, '../../../tests/fixtures/agents/qwenwork/home'),
  createAdapter: createQwenWorkAdapter,
});
```

Each fixture `SKILL.md` must contain valid frontmatter and a body:

```md
---
name: release
description: Run release checks safely.
---

# Release

Run the repository release checks.
```

- [ ] **Step 2: Run tests to verify missing implementations**

Run: `pnpm --filter @capaport/adapter-workbuddy test && pnpm --filter @capaport/adapter-qwenwork test`

Expected: FAIL because the packages or exported factories do not exist.

- [ ] **Step 3: Implement both adapter factories**

WorkBuddy `src/index.ts`:

```ts
import { type AdapterEnvironment, createFilesystemAdapter, defaultAdapterEnvironment } from '@capaport/adapter-sdk';

export function createWorkBuddyAdapter(environment: AdapterEnvironment = defaultAdapterEnvironment()) {
  return createFilesystemAdapter({
    id: 'workbuddy',
    displayName: 'WorkBuddy',
    supportedComponents: ['skill'],
    environment,
    roots: { user: '.workbuddy', workspace: '.codebuddy' },
    directories: { skill: 'skills' },
  });
}
```

QwenWork `src/index.ts`:

```ts
import { type AdapterEnvironment, createFilesystemAdapter, defaultAdapterEnvironment } from '@capaport/adapter-sdk';

export function createQwenWorkAdapter(environment: AdapterEnvironment = defaultAdapterEnvironment()) {
  return createFilesystemAdapter({
    id: 'qwenwork',
    displayName: '千问 Work（QwenWork）',
    supportedComponents: ['skill'],
    environment,
    roots: { user: '.qwenworkcn' },
    directories: { skill: 'skills' },
  });
}
```

Create each package manifest and tsconfig by matching `adapters/codex`, changing only the package name and included source path.

- [ ] **Step 4: Verify both adapters preserve auxiliary files and reject non-Skill components**

Add `scripts/check.sh`, `references/release.md`, and `assets/template.md` beneath each temporary Skill in the compliance test fixture, and assert all paths occur in imported and planned files.

Run: `pnpm --filter @capaport/adapter-workbuddy test && pnpm --filter @capaport/adapter-qwenwork test`

Expected: PASS for discovery, inventory, canonical import, installation planning, path safety, Windows paths, conflict-safe uninstall, and fixtures.

- [ ] **Step 5: Commit**

```bash
git add adapters/workbuddy adapters/qwenwork tests/fixtures/agents/workbuddy tests/fixtures/agents/qwenwork
git commit -m "feat(adapters): add WorkBuddy and QwenWork"
```

---

### Task 3: Propagate Agent IDs and Skill-only compatibility through shared contracts

**Files:**
- Modify: `packages/domain-types/src/index.ts`
- Modify: `packages/capability-kit/src/schema.ts`
- Modify: `packages/capability-kit/src/editor.ts`
- Modify: `packages/capability-kit/src/editor.test.ts`
- Modify: `packages/capability-kit/src/index.test.ts`
- Modify: `packages/contracts/src/capabilities.ts`
- Modify: `packages/contracts/src/capabilities.test.ts`
- Modify: `packages/contracts/src/distribution.ts`
- Modify: `packages/contracts/src/distribution.test.ts`
- Modify: `packages/contracts/src/projects.ts`
- Modify: `packages/contracts/src/projects.test.ts`

**Interfaces:**
- Produces: `AgentId` and `EditableAgent` unions with six values.
- Produces: component matrix where WorkBuddy and QwenWork equal `['skill']`.
- Preserves: all existing request and response shapes apart from the expanded enum and maximum Agent count.

- [ ] **Step 1: Write failing schema and editor tests**

Add assertions that both IDs parse in `manifestSchema` and `agentIdSchema`, six distinct agents pass all `max` constraints, and seven entries fail. Add editor assertions:

```ts
expect(unsupportedComponentsForAgent('workbuddy', ['skill', 'prompt', 'context'])).toEqual(['prompt', 'context']);
expect(unsupportedComponentsForAgent('qwenwork', ['skill', 'prompt', 'context'])).toEqual(['prompt', 'context']);
expect(compatibleAgentsForComponents(['skill'])).toEqual([
  'codex',
  'claude-code',
  'cursor',
  'gemini-cli',
  'workbuddy',
  'qwenwork',
]);
```

- [ ] **Step 2: Verify the new IDs fail before implementation**

Run: `pnpm --filter @capaport/capability-kit test && pnpm --filter @capaport/contracts test`

Expected: FAIL because the enum values are not accepted and limits remain four.

- [ ] **Step 3: Extend the canonical ID and component matrices**

Add to `SupportedAgent`:

```ts
WorkBuddy: 'workbuddy',
QwenWork: 'qwenwork',
```

Use this six-value order everywhere:

```ts
['codex', 'claude-code', 'cursor', 'gemini-cli', 'workbuddy', 'qwenwork']
```

Extend `EditableAgent`, `agentComponentSupport`, and labels:

```ts
workbuddy: ['skill'],
qwenwork: ['skill'],
```

```ts
workbuddy: 'WorkBuddy',
qwenwork: '千问 Work（QwenWork）',
```

Change Agent-list bounds from `.max(4)` to `.max(6)` in capabilities, device registration, project binding, and project context schemas. Replace handwritten four-value response unions with `AgentId[]` where possible; otherwise add the two exact literals.

- [ ] **Step 4: Run shared contract tests and typechecks**

Run: `pnpm --filter @capaport/domain-types typecheck && pnpm --filter @capaport/capability-kit test && pnpm --filter @capaport/contracts test`

Expected: PASS; Prompt/context validation messages name both new clients as unsupported when selected.

- [ ] **Step 5: Commit**

```bash
git add packages/domain-types packages/capability-kit packages/contracts
git commit -m "feat(contracts): add WorkBuddy and QwenWork agents"
```

---

### Task 4: Register adapters and scope-safe root resolution in the CLI

**Files:**
- Create: `apps/cli/src/installations.ts`
- Create: `apps/cli/src/installations.test.ts`
- Modify: `apps/cli/package.json`
- Modify: `apps/cli/src/adapters.ts`
- Modify: `apps/cli/src/commands/install.ts`
- Modify: `apps/cli/src/commands/uninstall.ts`
- Modify: `apps/cli/tests/e2e/cli/workflow.spec.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `AgentId`, `InstallScope`, and the two factory functions.
- Produces: `resolveAgentRoot(agentId, scope, environment?)` and `ensureAgentInstallation(agentId, scope)`.

- [ ] **Step 1: Write failing CLI root-resolution tests**

Test this matrix in `installations.test.ts`:

```ts
expect(resolveAgentRoot('workbuddy', 'user', environment)).toBe('/home/person/.workbuddy');
expect(resolveAgentRoot('workbuddy', 'workspace', environment)).toBe('/work/project/.codebuddy');
expect(resolveAgentRoot('qwenwork', 'user', environment)).toBe('/home/person/.qwenworkcn');
expect(() => resolveAgentRoot('qwenwork', 'workspace', environment)).toThrow(/不支持 workspace/);
```

Use an injected environment `{ homeDir: '/home/person', projectRoot: '/work/project', platform: 'linux' }` so the test is independent of the machine.

- [ ] **Step 2: Run CLI tests and verify failure**

Run: `pnpm --filter @capaport/cli test`

Expected: FAIL because the root resolver and adapter registrations do not exist.

- [ ] **Step 3: Implement one root profile map**

In `installations.ts` define:

```ts
const roots: Record<AgentId, Partial<Record<InstallScope, string>>> = {
  codex: { user: '.agents', workspace: '.agents' },
  'claude-code': { user: '.claude', workspace: '.claude' },
  cursor: { user: '.cursor', workspace: '.cursor' },
  'gemini-cli': { user: '.gemini', workspace: '.gemini' },
  workbuddy: { user: '.workbuddy', workspace: '.codebuddy' },
  qwenwork: { user: '.qwenworkcn' },
};
```

`resolveAgentRoot` must throw `UsageError(`${agentId} 不支持 ${scope} scope`)` when the relative root is absent. `ensureAgentInstallation` creates the resolved directory, calls the registered adapter's `detect`, and requires an exact scope/root match.

- [ ] **Step 4: Wire both commands and adapters**

Register factories in `adapters.ts`:

```ts
workbuddy: createWorkBuddyAdapter(),
qwenwork: createQwenWorkAdapter(),
```

Remove duplicate `roots` constants from install and uninstall commands. Use `ensureAgentInstallation` for install and `resolveAgentRoot` for uninstall. Add both workspace adapter packages to CLI dependencies and run `pnpm install` to update the lockfile.

- [ ] **Step 5: Add end-to-end CLI assertions**

Extend the CLI workflow fixture so a Skill can install/uninstall into WorkBuddy user/workspace roots and QwenWork user root. Add a QwenWork workspace case that exits non-zero and contains `qwenwork 不支持 workspace scope` without creating `.qwenworkcn` inside the project.

- [ ] **Step 6: Verify CLI behavior**

Run: `pnpm --filter @capaport/cli test && pnpm --filter @capaport/cli typecheck && pnpm --filter @capaport/cli test:e2e`

Expected: PASS; all three valid roots complete the lifecycle and the invalid scope fails closed.

- [ ] **Step 7: Commit**

```bash
git add apps/cli pnpm-lock.yaml
git commit -m "feat(cli): support WorkBuddy and QwenWork installations"
```

---

### Task 5: Add desktop runtime discovery and installation profiles

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/desktop/src/app/install-plan.ts`
- Modify: `apps/desktop/src/app/install-plan.test.ts`
- Modify: `apps/desktop/src/generated/commands.ts`

**Interfaces:**
- Produces: Rust `AgentDirectory` entries with independent `user_root` and optional `workspace_root`.
- Produces: TypeScript Skill install profiles for both Agent IDs.

- [ ] **Step 1: Write failing Rust discovery and TypeScript install-plan tests**

Rust tests must create:

```text
<home>/.workbuddy/skills/release/SKILL.md
<project>/.codebuddy/skills/review/SKILL.md
<home>/.qwenworkcn/skills/release/SKILL.md
<project>/.qwenworkcn/skills/ignored/SKILL.md
```

Assert WorkBuddy is detected for user and workspace, QwenWork only for user, and project `.qwenworkcn` is ignored.

In `install-plan.test.ts`, build a Skill-only archive compatible with each new ID and assert relative writes are `skills/<slug>/SKILL.md`. Also assert a Prompt component fails with `所选 Agent 不支持 prompt`.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `pnpm --filter @capaport/desktop test -- src/app/install-plan.test.ts`

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml commands::tests`

Expected: FAIL because neither profile exists and Rust knows only four same-root agents.

- [ ] **Step 3: Refactor Rust directory profiles without changing existing roots**

Add:

```rust
#[derive(Clone, Copy)]
struct AgentDirectory {
    id: &'static str,
    display_name: &'static str,
    user_root: &'static str,
    workspace_root: Option<&'static str>,
}
```

Return six entries, including:

```rust
AgentDirectory { id: "workbuddy", display_name: "WorkBuddy", user_root: ".workbuddy", workspace_root: Some(".codebuddy") },
AgentDirectory { id: "qwenwork", display_name: "千问 Work（QwenWork）", user_root: ".qwenworkcn", workspace_root: None },
```

Update runtime allowlist construction, `detect_agents`, bound-project discovery, `inventory_agent`, and `trusted_skill_roots` to use the correct root for each scope. Never unwrap `workspace_root`; skip agents where it is `None`.

- [ ] **Step 4: Add native component profiles**

Extend Rust `component_formats`:

```rust
"workbuddy" | "qwenwork" => &[("skill", "skills", "")],
```

Extend TypeScript `componentProfiles`:

```ts
workbuddy: { skill: { directory: 'skills' } },
qwenwork: { skill: { directory: 'skills' } },
```

Update generated Agent unions in `generated/commands.ts` to include both literals; do not widen them to unbounded `string`.

- [ ] **Step 5: Run desktop runtime and install-plan tests**

Run: `pnpm --filter @capaport/desktop test -- src/app/install-plan.test.ts`

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`

Expected: PASS; discovery and installation honor the distinct roots and unsupported scope.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/mod.rs apps/desktop/src/app/install-plan.ts apps/desktop/src/app/install-plan.test.ts apps/desktop/src/generated/commands.ts
git commit -m "feat(desktop): discover WorkBuddy and QwenWork skills"
```

---

### Task 6: Expose both clients consistently in the desktop UI

**Files:**
- Modify: `apps/desktop/src/features/authoring/authoring-page.tsx`
- Modify: `apps/desktop/src/features/agents/discovery-modal.tsx`
- Modify: `apps/desktop/src/features/agents/home-page.tsx`
- Modify: `apps/desktop/src/features/agents/home-page.test.tsx`
- Modify: `apps/desktop/src/app/app.test.tsx`
- Modify: `apps/desktop/src/test/fixtures.ts`
- Modify: `apps/desktop/tests/e2e/desktop/workflows.spec.ts`

**Interfaces:**
- Consumes: `EditableAgent`, `compatibleAgentsForComponents`, and runtime `AgentDescriptor` values.
- Produces: six-client labels and Skill-only authoring selection behavior.

- [ ] **Step 1: Write failing UI tests**

Add assertions that a Skill-only draft shows enabled WorkBuddy and QwenWork checkboxes, while a draft containing Prompt disables both. Extend discovery fixtures with:

```ts
{ adapterId: 'workbuddy', displayName: 'WorkBuddy', scope: 'user', rootPath: '[authorized-workbuddy-root]' },
{ adapterId: 'qwenwork', displayName: '千问 Work（QwenWork）', scope: 'user', rootPath: '[authorized-qwenwork-root]' },
```

Assert the Agent home empty-state and discovery help copy names both clients.

- [ ] **Step 2: Run focused UI tests and verify failure**

Run: `pnpm --filter @capaport/desktop test -- src/features/agents/home-page.test.tsx src/app/app.test.tsx`

Expected: FAIL because copy, checkboxes, and fixtures contain only four clients.

- [ ] **Step 3: Render the canonical six-Agent list**

Replace the hard-coded authoring tuple with:

```ts
const editableAgents: readonly EditableAgent[] = [
  'codex',
  'claude-code',
  'cursor',
  'gemini-cli',
  'workbuddy',
  'qwenwork',
];
```

Render labels through the shared capability-kit label helper or an exported `agentLabels` map so the UI displays `WorkBuddy` and `千问 Work（QwenWork）`, not raw IDs. Update discovery copy to “Codex、Claude Code、Cursor、Gemini CLI、WorkBuddy 与千问 Work”.

- [ ] **Step 4: Update desktop fixtures and E2E flow**

Include both detected Agent descriptors. Add a discovery/import assertion for each and a QwenWork Skill install preview using its user root. Do not add a QwenWork workspace option.

- [ ] **Step 5: Verify desktop UI**

Run: `pnpm --filter @capaport/desktop test && pnpm --filter @capaport/desktop typecheck && pnpm --filter @capaport/desktop test:e2e`

Expected: PASS with both clients visible and component-incompatible selections disabled.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src apps/desktop/tests/e2e/desktop/workflows.spec.ts
git commit -m "feat(desktop-ui): expose WorkBuddy and QwenWork"
```

---

### Task 7: Update API fixtures, generated surfaces, and public documentation

**Files:**
- Modify: API tests returned by `rg -l "codex|claude-code|cursor|gemini-cli" apps/api`
- Modify: `apps/web/src/app/types.ts`
- Modify: `apps/web/src/test/fixtures.ts`
- Modify: `README.md`
- Modify: `PRD-CapaPort.md`
- Modify: `docs/user-guide/cli.md`
- Modify: `docs/user-guide/desktop.md`
- Modify: `CHANGELOG.md`
- Modify: generated SDK files changed by `pnpm sdk:generate`

**Interfaces:**
- Consumes: shared six-Agent API schemas.
- Produces: generated client types and public compatibility documentation matching runtime behavior.

- [ ] **Step 1: Add API acceptance assertions for both IDs**

In capability, distribution, and project-context service/route tests, use `workbuddy` and `qwenwork` in valid request bodies. Assert six distinct supported agents are accepted and duplicate normalization remains deterministic. Keep business assertions unchanged.

- [ ] **Step 2: Run API tests and SDK check to expose stale literals**

Run: `pnpm --filter @capaport/api test && pnpm sdk:check`

Expected: API tests or SDK check FAIL wherever generated or handwritten four-Agent unions remain stale.

- [ ] **Step 3: Regenerate and update typed fixtures**

Run: `pnpm sdk:generate`

Replace remaining handwritten unions with the generated/shared `AgentId` type where module boundaries permit. Where they cannot import it, use the exact six-literal union. Update web and API fixtures without weakening types to `string[]`.

- [ ] **Step 4: Document the exact compatibility matrix**

Add this table to README and relevant user guides:

```md
| 客户端 | 用户级 Skill | 项目级 Skill | Prompt | 项目上下文 |
| --- | --- | --- | --- | --- |
| WorkBuddy | `~/.workbuddy/skills/` | `.codebuddy/skills/` | 不支持 | 不支持 |
| 千问 Work（QwenWork） | `~/.qwenworkcn/skills/` | 不支持 | 不支持 | 不支持 |
```

State that CapaPort preserves auxiliary files and fails closed on unsupported scopes/components. Add an unreleased changelog entry describing both adapters.

- [ ] **Step 5: Run API, web, SDK, and documentation checks**

Run: `pnpm --filter @capaport/api test && pnpm --filter @capaport/web test && pnpm sdk:check && pnpm format:check`

Expected: PASS; generated contracts and public documentation agree on six Agent IDs.

- [ ] **Step 6: Commit**

```bash
git add apps/api apps/web packages/sdk README.md PRD-CapaPort.md docs/user-guide/cli.md docs/user-guide/desktop.md CHANGELOG.md
git commit -m "docs: publish WorkBuddy and QwenWork compatibility"
```

---

### Task 8: Whole-repository verification and remote delivery

**Files:**
- Verify only; modify only failures caused by Tasks 1-7 and stage each exact correction with its owning task files.

**Interfaces:**
- Consumes: all previous task deliverables.
- Produces: release-level evidence and a pushed branch whose remote HEAD equals local HEAD.

- [ ] **Step 1: Scan for stale four-Agent contracts**

Run:

```bash
rg -n "max\(4\)|'codex' \| 'claude-code' \| 'cursor' \| 'gemini-cli'|Codex、Claude Code、Cursor、Gemini CLI" packages apps README.md PRD-CapaPort.md docs
```

Expected: no Agent-count maximum or user-facing four-client list remains; unrelated severity `.max(4)` matches are explicitly excluded by file context.

- [ ] **Step 2: Run formatting, lint, types, tests, security, and builds**

Run: `pnpm format:check`

Run: `pnpm lint`

Run: `pnpm typecheck`

Run: `pnpm test`

Run: `pnpm security:gate`

Run: `pnpm build`

Run: `pnpm sdk:check`

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`

Expected: every command exits 0. Fix only regressions introduced by this feature, then rerun the failing command and its dependent full command.

- [ ] **Step 3: Verify Git integrity**

Run: `git diff --check`

Run: `git status --short --branch`

Run: `git log --oneline --decorate -8`

Expected: no unstaged feature edits, no whitespace errors, and the task commits are present on the current branch.

- [ ] **Step 4: Commit any verification-only corrections**

If verification required source corrections, stage only those exact files and commit:

```bash
git commit -m "fix: complete WorkBuddy and QwenWork integration"
```

If no corrections were required, do not create an empty commit.

- [ ] **Step 5: Push and verify remote HEAD**

Run: `git push origin HEAD`

Run: `git rev-parse HEAD`

Run: `git ls-remote origin refs/heads/$(git rev-parse --abbrev-ref HEAD)`

Expected: push succeeds and the two commit hashes are identical.
