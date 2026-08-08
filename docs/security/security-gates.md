# 安全门禁

## 提交与合并

- `pnpm lint`：不得新增错误或 CSS 选择器优先级警告。
- `pnpm typecheck && pnpm test`：覆盖权限、租户、Manifest、适配器和客户端事务。
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`：覆盖授权根、冲突、回滚和原生项目投影。
- `pnpm security:gate`：凭据、依赖、路径、租户和扫描器门禁。

## 发布候选

- `pnpm release:verify`：完整构建、Docker smoke、真实 Compose Acceptance 和跨端 E2E。
- `pnpm release:preflight`：生产 updater 公钥、HTTPS 端点、安全传输和版本一致性。
- macOS 必须验证 Developer ID 签名、公证、首次启动、升级与回滚。
- Windows 必须验证 Authenticode、可信时间戳、安装/卸载、升级与回滚。
- CLI、桌面和容器必须生成摘要；桌面和容器必须附带 SBOM 与来源证明。

## 生产运行

- 监控认证异常、跨租户拒绝、扫描阻断、对象摘要不一致、队列死信和更新失败。
- 定期轮换数据库、对象存储、SMTP/SMS 和签名相关凭据。
- 发现泄露时先撤销凭据与会话，再隔离产物，并按事件手册保全审计证据。
