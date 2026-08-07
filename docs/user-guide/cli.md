# Linux CLI

构建并安装：

```bash
pnpm artifacts:cli
install -m 0755 artifacts/agentdoor-cli.mjs ~/.local/bin/agentdoor
agentdoor --help
```

CLI 需要 Node.js 22。发布包旁的 `.sha256` 文件用于校验：

```bash
sha256sum -c agentdoor-cli.mjs.sha256
```

常用命令：

```bash
agentdoor auth login --api http://127.0.0.1:3210/api/v1
agentdoor auth status
agentdoor org list
agentdoor org use <organization-id>
agentdoor search "release" --agent claude-code
agentdoor pull <slug>
agentdoor publish --slug <slug> --space <space-id> --path <directory>
agentdoor install <slug> --agent codex --scope workspace
agentdoor sync
agentdoor doctor
```

危险写入和覆盖需要交互确认；自动化可显式传 `--yes`。`--json` 输出稳定机器格式。退出码：`0` 成功、`2` 参数错误、`3` 认证错误、`4` 网络错误、`5` 本地冲突、`6` 用户取消。令牌保存在系统凭据服务中，`doctor` 输出会脱敏。
