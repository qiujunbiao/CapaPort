# WorkBuddy 与千问 Work 客户端适配设计

日期：2026-08-11

状态：已确认

## 1. 决策摘要

CapaPort 新增两个一等 Agent 客户端：`workbuddy` 与 `qwenwork`。两者首版只声明并实现已验证的原生 Skill 能力，不把 Prompt 或项目上下文转换为 Skill，也不为客户端虚构不存在的安装范围。

核心决策：

1. 新增独立适配器包 `@capaport/adapter-workbuddy` 与 `@capaport/adapter-qwenwork`。
2. WorkBuddy 支持用户级与项目级 Skill；用户级根目录为 `~/.workbuddy`，项目级根目录为 `.codebuddy`，Skill 子目录均为 `skills`。
3. 千问 Work 只支持用户级 Skill，根目录为 `~/.qwenworkcn`，Skill 子目录为 `skills`。
4. 两个适配器都复用 CapaPort 的发现、导入、安装计划、校验、事务写入、冲突保护、锁文件和卸载能力。
5. `prompt` 与 `context` 在两个客户端上均为明确不支持；能力包兼容性校验必须在安装前阻止错误目标。
6. Adapter SDK 的文件系统根目录改为按 scope 可选，使客户端可以只提供真实存在的安装范围。
7. CLI、桌面端、API 契约、能力编辑器、兼容矩阵、测试夹具和文档同步增加两个客户端。

## 2. 依据与边界

### 2.1 WorkBuddy

腾讯云 WorkBuddy Skill 文档定义了以 `SKILL.md` 为必需入口、以 `scripts/`、`references/`、`assets/` 为可选辅助目录的 Skill 结构，并给出项目级 `.codebuddy/skills/` 路径：

- <https://cloud.tencent.com/document/product/1831/134516>

WorkBuddy 桌面端的用户级 Skill 实际目录采用 `~/.workbuddy/skills/`。由于官方公开文档对用户级路径的说明仍不完整，首版只把 `.workbuddy` 作为 WorkBuddy 用户级写入目标，不主动写入 `~/.codebuddy`，避免与独立 CodeBuddy 客户端混淆。

### 2.2 千问 Work

千问办公官方文档明确说明每个 Skill 是包含 `SKILL.md` 的文件夹，可包含辅助文件，并将本地 Skill 稳定目录定义为 `~/.qwenworkcn/skills/`：

- <https://qwenwork.cn/docs/features/skills>

当前没有经过官方确认的项目级 Skill 目录，因此适配器只暴露用户级安装。未来若官方发布项目级契约，再通过新增 scope 扩展，不用兼容性猜测替代原生能力。

## 3. 产品表现

客户端标识和显示名称：

| Agent ID | 显示名称 | user scope | workspace scope | 支持组件 |
| --- | --- | --- | --- | --- |
| `workbuddy` | WorkBuddy | `~/.workbuddy/skills/` | `<project>/.codebuddy/skills/` | Skill |
| `qwenwork` | 千问 Work（QwenWork） | `~/.qwenworkcn/skills/` | 不支持 | Skill |

能力编辑器选择 Prompt 或项目上下文时，不得把 WorkBuddy 或千问 Work 列为兼容目标。导入的本地 Skill 可以生成同时兼容多个 Agent 的平台中立能力包。

CLI 和桌面端只展示实际检测到或能够安全创建的 scope。对千问 Work 请求 `workspace` 安装时返回确定性错误，不回退到用户目录。

## 4. Adapter SDK 调整

当前 `FilesystemAdapterConfig.roots` 强制同时提供 `user` 和 `workspace`。调整为按 scope 可选：

```ts
type FilesystemAdapterConfig = {
  // ...
  roots: Partial<Record<InstallScope, string>>;
};
```

约束如下：

- 至少提供一个根目录；配置校验或测试必须阻止空 roots。
- `detect()` 只遍历已配置 scope。
- `inventory()`、`planInstall()`、`validatePlan()` 和 `uninstall()` 继续执行 adapter ID、scope 与根目录三重校验。
- 未配置 scope 的 installation 即使路径落在另一个允许根目录内，也必须拒绝。
- 根目录仍由 `homeDir` 或 `projectRoot` 与相对路径组合，禁止绝对配置、`..` 逃逸和符号链接穿透。
- 现有四个适配器保持双 scope 行为，不改变兼容性。

CLI 创建安装目标时不再维护一份假设所有 Agent 均有双 scope 的硬编码根目录表，而是从适配器公开的 scope/root 配置或统一安装目标解析函数获得结果。

## 5. 适配器实现

### 5.1 WorkBuddy

```ts
createFilesystemAdapter({
  id: 'workbuddy',
  displayName: 'WorkBuddy',
  supportedComponents: ['skill'],
  roots: { user: '.workbuddy', workspace: '.codebuddy' },
  directories: { skill: 'skills' },
});
```

导入时递归保留 Skill 目录内的普通文件。缺少根级 `SKILL.md` 的目录不进入 inventory；符号链接或路径逃逸导致整个候选项失败并给出安全错误。

### 5.2 千问 Work

```ts
createFilesystemAdapter({
  id: 'qwenwork',
  displayName: '千问 Work（QwenWork）',
  supportedComponents: ['skill'],
  roots: { user: '.qwenworkcn' },
  directories: { skill: 'skills' },
});
```

适配器不声明 workspace root。导入与安装保留 `SKILL.md` 以及同目录下的辅助文件，不修改客户端原生内容。

## 6. 跨层契约

以下位置必须以同一个 Agent 集合为准：

- `packages/domain-types` 的 `SupportedAgent`。
- `packages/capability-kit` 的 manifest schema、编辑器 Agent 类型、显示名称和组件支持矩阵。
- `packages/contracts` 的请求/响应类型与项目绑定上限。
- API capability、distribution、project binding 的校验和测试。
- CLI 适配器注册、安装、卸载与 doctor 命令。
- Desktop/Tauri Agent 发现、Skill 发现、安装目标和 UI 标签。
- README、产品文档与兼容矩阵。

支持客户端从 4 个增加到 6 个后，项目绑定请求的数组上限同步改为 6。但组件支持矩阵仍会阻止千问 Work 接收项目上下文；“可作为 Agent 标识出现”和“支持某种本地组件”是两个独立契约。

## 7. 文件事务与冲突处理

两个新适配器不引入特殊写入旁路：

1. 安装前验证能力包摘要和 Agent 兼容性。
2. 生成目标根目录内的确定性文件计划。
3. 校验所有 destination 均位于被授权 scope 根目录中。
4. 写入前记录旧内容，通过临时文件原子替换。
5. 写入 `.capaport/locks/<agent>/<slug>.json`，记录包摘要与逐文件摘要。
6. 更新或卸载时比较锁文件摘要；用户修改过的文件不得静默覆盖或删除。
7. 任一步失败时由事务回滚已执行的文件变更。

Skill 辅助文件完整参与摘要、冲突检测和卸载，不能只跟踪 `SKILL.md`。

## 8. 测试策略

### 8.1 Adapter SDK

- 增加 user-only roots 合规用例。
- 验证未配置 scope 不被发现、不能 inventory、不能安装或卸载。
- 保留双 scope 适配器的现有回归用例。
- 覆盖 darwin、linux、win32 路径组合、路径逃逸与符号链接。

### 8.2 新适配器

每个适配器运行共享 compliance suite，并增加原生目录断言：

- WorkBuddy 用户目录与项目目录发现。
- 千问 Work 只发现用户目录。
- 含 `scripts/`、`references/`、`assets/` 的 Skill 可完整导入和安装。
- 缺少 `SKILL.md` 的目录被忽略。
- Prompt/context 能力包安装被拒绝。
- 安装、更新、冲突、卸载和回滚结果正确。

### 8.3 跨层回归

- manifest 与 API 接受两个新 Agent ID。
- 编辑器兼容矩阵只允许 Skill。
- 项目绑定最多接受 6 个去重 Agent。
- CLI registry、doctor、install、uninstall 覆盖两个客户端。
- Desktop 发现和标签快照更新。
- 全仓类型检查、测试、构建及文档链接检查通过。

## 9. 非目标

本次不包含：

- 将 Prompt 或项目上下文降级为 Skill。
- 猜测千问 Work 项目级目录。
- 管理 WorkBuddy/千问 Work 客户端本身的安装、登录或升级。
- 执行 Skill、调度任务或接入客户端会话。
- 自动迁移用户现有 `.codebuddy` 与 `.workbuddy` 目录。
- 为未验证的 Windows 专用应用数据目录增加特殊分支。

## 10. 验收标准

1. 两个 Agent 可在能力包、API、CLI 和桌面端中被一致识别。
2. WorkBuddy 的 user/workspace Skill 与千问 Work 的 user Skill 可完成发现、导入、安装、更新、冲突保护和卸载。
3. 千问 Work 的 workspace 安装和两个 Agent 的非 Skill 组件均明确失败。
4. 所有写入受 allowlist、摘要、锁文件和事务回滚保护。
5. 现有四个 Agent 的行为与测试保持不变。
6. README 与产品文档准确描述真实目录、scope 和组件能力。
