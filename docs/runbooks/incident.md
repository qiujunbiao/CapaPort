# Security and availability incident response

## First 15 minutes

1. Declare an incident owner, severity, start time, and communication channel.
2. Preserve request IDs, immutable image tags, deployment revision, audit events, metrics, and redacted JSON logs.
3. Contain the smallest affected surface: disable an account/device, revoke sessions, withdraw a version, or block
   writes at ingress. Do not delete audit data or container volumes.
4. If credentials may be exposed, rotate JWT signing secret, refresh/verification peppers, S3 credentials, database
   credentials, SMTP credentials, and metrics token. Rotating the JWT secret signs out all users.

## Alert triage

- `CapaPortApiUnavailable` or 5xx alert: check `/health/ready`, dependency reachability, migration job, and current tag.
- authorization or refresh replay alert: identify request IDs and sessions; revoke the replay chain and affected user
  sessions; examine tenant-scoped audit records.
- scan/upload alert: quarantine the artifact, disable presigned upload, and verify server-side digest and scan results.
- installation/worker alert: inspect correlated `jobId`, `eventId`, and `correlationId`; preserve the dead-letter row.

Fetch logs without request bodies or credentials:

```sh
docker compose --env-file /etc/capaport/capaport.env -f infra/compose/compose.production.yaml \
  logs --since 30m --no-color api worker migrate > /secure/incident/capaport.log
```

## Recovery and closure

Use application rollback for code regressions and the restore runbook only for verified data corruption. After
recovery, confirm health, tenant isolation, publishing, install plans, audit visibility, notification processing, and
backup integrity. Document impact, root cause, timeline, evidence retention, credential rotations, corrective actions,
and customer/regulatory notification decisions. Logs are intentionally redacted; use tenant-scoped audit IDs for
investigation rather than collecting personal or source content.
