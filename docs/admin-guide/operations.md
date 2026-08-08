# 运维与可观测性

## 健康与指标

- `/api/v1/health/live`：进程存活。
- `/api/v1/health/ready`：数据库、Redis、对象存储等依赖就绪。
- `/api/v1/metrics`：Bearer metrics token 保护的 Prometheus 指标。

日志为结构化 JSON，包含 `requestId`、`correlationId`、服务名、状态和耗时；认证头、令牌、密码、秘密字段会脱敏。告警至少覆盖 API 5xx、延迟、Worker 失败/积压、数据库连接、对象存储错误和磁盘容量。

## 备份与恢复

```bash
BACKUP_ROOT=/secure/backups infra/deploy/backup.sh
CONFIRM_RESTORE=RESTORE BACKUP_DIR=/secure/backups/<timestamp> infra/deploy/restore.sh
```

数据库和对象存储必须属于同一备份窗口，输出校验和。恢复先进入隔离环境验证行数、对象数和摘要，再切换流量。逐步操作见[备份](../runbooks/backup.md)与[恢复](../runbooks/restore.md)。

## 发布与回滚

先运行 `pnpm release:verify`。生产升级顺序为：拉取不可变镜像、执行 migrate、健康验证、滚动 API、滚动 Worker。应用回滚使用上一个不可变标签；破坏性数据库变更必须通过向前修复，不自动降级结构。见[部署](../runbooks/deploy.md)和[回滚](../runbooks/rollback.md)。

## 容量与保留

监控 PostgreSQL 表/索引增长、Redis 内存、S3 制品数和审计日志增长。发布版本默认不可变，不应以清理缓存方式删除；按组织合规策略制定审计保留和账号删除流程。

组织关闭和账号注销由 `lifecycle_deletion` 持久化作业执行。作业具备数据库去重键、租约恢复、指数退避与死信状态；对象删除失败时不会提交租户数据删除。管理员应监控 `operation_jobs` 的 `pending`、`running`、`dead_letter` 数量，并只在确认外部依赖恢复后从 Web 后台重试死信作业。
