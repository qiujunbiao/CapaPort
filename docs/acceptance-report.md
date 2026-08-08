# CapaPort 0.1.0 最终验收报告

验收日期：2026-08-08
范围：桌面客户端、Linux CLI、Web 管理后台、模块化单体云端、本地适配器、容器与运维交付物。

## 自动化业务验收

`pnpm acceptance` 每次使用独立 Docker Compose 项目和空数据卷，完成后销毁环境。已验证：

1. 成员 A 注册、创建组织，邀请成员 B 和审核人。
2. Codex 适配器从真实临时项目发现并导入 Skill。
3. AWS 密钥夹具被客户端扫描阻断，移除后扫描通过且报告不泄露原文。
4. Skill、Prompt、项目上下文组成能力包并保存个人草稿、提交组织空间。
5. 审核人读取差异/服务端扫描结果并发布不可变版本。
6. 成员 B 搜索能力，校验下载摘要，并用 Claude Code 适配器安装。
7. 新版本经审核后对未修改文件完成安全更新。
8. 本地修改触发冲突，阻止静默覆盖，支持差异、导入草稿和恢复。
9. 邀请、提交、审核、下载、安装和版本更新均存在审计证据。
10. 第二组织无法搜索、读取、下载或从错误信息推断第一组织资源。

同一验收还验证组织/账号数据导出、30 天关闭或注销宽限期及取消、所有权移交。`tests/acceptance/desktop-runtime.spec.ts` 会执行 Rust `Runtime` 二进制，而不是读取源码字符串；它覆盖干净更新、本地修改冲突、导出本地版本、事务回滚、卸载和卸载回滚。

最近一次实跑结果：`final-acceptance=passed steps=10 source=codex target=claude-code tenant_isolation=true`。

## 工程验收矩阵

| 面向 | 命令/流水线 | 验收内容 |
| --- | --- | --- |
| 单元/集成 | `pnpm test` | API、领域、Web、Desktop、CLI、四适配器 |
| 类型/构建 | `pnpm typecheck && pnpm build` | 全工作区类型和生产资产 |
| 安全 | `pnpm security:gate` | 凭据、租户、依赖、路径、扫描器 |
| 容器 | `pnpm stack:smoke` | 非 root、只读、迁移、发布分发、备份恢复、重启持久化 |
| 业务 | `pnpm acceptance` | 十步跨端、跨 Agent、跨租户真实流程 |
| CLI | `pnpm artifacts:cli` | 可执行单文件与 SHA-256 |
| 桌面运行时 | Rust acceptance harness | 更新、冲突、导入、恢复、事务卸载 |
| 桌面发布 | Release workflow matrix | macOS universal、Windows x64、updater 签名、SHA-256、SPDX SBOM、provenance |
| 云端 | Release workflow images | API、Worker、Migrate 多架构镜像、SBOM、provenance、漏洞扫描 |

## 结论

0.1.0 MVP 的功能和运行链路已实现。生产上线仍需由部署组织提供正式域名、SMTP/SMS、S3、数据库、签名证书、Tauri updater 私钥、更新文件托管和监控告警接收端；这些外部服务与秘密不属于源码交付物，缺少任一签名秘密时发布流水线会失败关闭。
