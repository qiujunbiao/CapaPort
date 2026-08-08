# 生产部署

## 组件与外部依赖

生产需要 PostgreSQL 17、Redis 7、S3 兼容对象存储、SMTP 服务和 TLS 反向代理。部署三个同版本镜像：`agentdoor-api`、`agentdoor-worker`、`agentdoor-migrate`。镜像标签必须是不可变版本或 Git SHA，禁止使用 `latest`。

## 秘密文件

建立仅部署账号可读的目录，分别写入：

```text
database_url
s3_access_key
s3_secret_key
jwt_secret
refresh_token_pepper
verification_pepper
metrics_token
```

`jwt_secret`、两个 pepper 和 metrics token 使用密码学安全随机值，至少 32 字节。Compose 只把它们作为 `/run/secrets/*` 文件挂载，不写入环境转储或镜像层。

## 启动

```bash
export AGENTDOOR_REGISTRY=ghcr.io/your-org
export AGENTDOOR_IMAGE_TAG=0.1.0-<git-sha>
export AGENTDOOR_SECRETS_DIR=/secure/agentdoor
export REDIS_URL=rediss://...
export S3_ENDPOINT=https://s3.internal.example
export S3_PUBLIC_ENDPOINT=https://downloads.example
export S3_BUCKET=agentdoor
export S3_REGION=us-east-1
export S3_SERVER_SIDE_ENCRYPTION=AES256
# 使用 AWS KMS 时改为 aws:kms，并设置 S3_KMS_KEY_ID=alias/agentdoor
export SMTP_HOST=smtp.example
export SMTP_PORT=587
export SMTP_FROM='Agentdoor <no-reply@example.com>'
docker compose -f infra/compose/compose.production.yaml pull
docker compose -f infra/compose/compose.production.yaml up migrate
docker compose -f infra/compose/compose.production.yaml up -d api worker
```

迁移使用 PostgreSQL advisory lock 串行化；多个发布实例同时执行不会并发修改结构。生产环境必须启用对象存储服务端加密，API 会把加密参数纳入上传签名并在确认上传时校验对象加密状态。反向代理仅暴露 API，强制 HTTPS/HSTS，并把对象下载域名限制为受控域。

## 启动验证

```bash
curl -fsS https://agentdoor.example/api/v1/health/live
curl -fsS https://agentdoor.example/api/v1/health/ready
curl -fsS -H "Authorization: Bearer $METRICS_TOKEN" https://agentdoor.example/api/v1/metrics
```

进一步步骤见[部署运行手册](../runbooks/deploy.md)和[回滚手册](../runbooks/rollback.md)。
