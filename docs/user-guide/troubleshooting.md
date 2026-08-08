# 用户故障排查

## 无法登录

确认 API `/health/ready` 返回 200；开发环境确认 Mailpit 收到最新验证码。验证码过期后重新发送，不要重复使用。CLI 运行 `capaport doctor` 查看脱敏诊断。

## 找不到本地 Agent

确认选择的项目根目录正确且存在对应 `.agents`、`.claude`、`.cursor` 或 `.gemini` 目录。Codex 全局 Skill 还会从 `~/.codex/skills`、`~/.agents/skills` 和已安装插件的 `skills` 目录发现。每个能力目录必须包含普通文件 `SKILL.md`。

可信 Skill 根目录下的目录符号链接可以指向用户目录之外。界面提示“路径未能读取”时，检查链接是否断开、形成循环、目标是否有读取权限，或能力目录内部是否存在指向包外的链接；这些无效路径会被跳过，但不会中断其余能力发现。

## 上传被阻断

按规则编号和文件行号删除密钥或隐私内容，然后重新扫描。扫描报告不会显示原始秘密。不要通过改名或编码绕过规则。

## 更新提示冲突

说明文件自上次安装后被修改。查看差异后选择保留、导入个人草稿或恢复。CapaPort 不会静默覆盖本地编辑。

## Docker 本地栈异常

```bash
docker compose -f infra/compose/compose.yaml ps
docker compose -f infra/compose/compose.yaml logs api worker migrate
pnpm stack:smoke
```

若确认不需要本地数据，可执行 `docker compose -f infra/compose/compose.yaml down -v` 后重建。
