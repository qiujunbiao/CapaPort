# Linux CLI

构建并安装：

```bash
pnpm artifacts:cli
install -m 0755 artifacts/capaport-cli.mjs ~/.local/bin/capaport
capaport --help
```

CLI 需要 Node.js 22。发布包旁的 `.sha256` 文件用于校验：

```bash
sha256sum -c capaport-cli.mjs.sha256
```

常用命令：

```bash
capaport auth login --api http://127.0.0.1:3210/api/v1
capaport auth status
capaport org list
capaport org use <organization-id>
capaport search "release" --agent claude-code
capaport pull <slug>
capaport publish --slug <slug> --space <space-id> --path <directory>
capaport install <slug> --agent codex --scope workspace
capaport install <slug> --agent workbuddy --scope workspace
capaport install <slug> --agent qwenwork --scope user
capaport sync
capaport doctor
```

危险写入和覆盖需要交互确认；自动化可显式传 `--yes`。`--json` 输出稳定机器格式。退出码：`0` 成功、`2` 参数错误、`3` 认证错误、`4` 网络错误、`5` 本地冲突、`6` 用户取消。令牌保存在系统凭据服务中，`doctor` 输出会脱敏。

WorkBuddy 支持用户级 `~/.workbuddy/skills/` 和项目级 `.codebuddy/skills/`。千问 Work 只支持用户级 `~/.qwenworkcn/skills/`；对其使用 `--scope workspace` 会直接报错，不会改写到用户目录。两个客户端当前均只接收 Skill 组件。
