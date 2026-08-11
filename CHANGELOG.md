# Changelog

## Unreleased

- 新增 WorkBuddy 与千问 Work（QwenWork）Skill 适配器，覆盖发现、导入、安装、更新冲突保护和安全卸载。
- WorkBuddy 支持用户级 `~/.workbuddy/skills/` 与项目级 `.codebuddy/skills/`；千问 Work 支持用户级 `~/.qwenworkcn/skills/`。

## 0.1.0 - 2026-08-08

- 完成邮箱/手机号账号体系、验证码、会话刷新、设备和组织邀请闭环。
- 完成个人、组织、团队、项目空间及成员角色、分级审核和跨租户隔离。
- 定义 Skill + Prompt + 项目上下文能力包格式、版本、制品摘要和兼容矩阵。
- 完成发现、沉淀、扫描、审核、发布、搜索、安装、更新、冲突恢复与审计链路。
- 完成 Codex、Claude Code、Cursor、Gemini CLI 本地扫描与同步适配器。
- 完成 macOS/Windows Tauri 桌面客户端、Linux CLI 和 Web 管理后台。
- 完成客户端/服务端双重敏感信息扫描、加密存储边界、租户安全测试和依赖门禁。
- 完成 API、Worker、Migrate 容器，非 root/只读部署、可观测性、备份恢复与发布回滚。
- 增加空数据卷十步业务验收和跨平台发布流水线。
