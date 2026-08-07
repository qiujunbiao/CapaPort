# Restore

Restore is destructive to the selected target database and object bucket. Use a new isolated target first, verify it,
then schedule production cutover.

1. Stop API and worker or block writes at ingress.
2. Confirm the backup directory has `database.dump`, `objects/`, `SHA256SUMS`, and `metadata.json`.
3. Point the environment only at the restore target.
4. Run the guarded restore:

```sh
export CONFIRM_RESTORE=RESTORE
export BACKUP_DIR='/srv/agentdoor-backups/20260808T010000Z'
export DATABASE_URL='postgres://restore-user:REDACTED@restore-db.example.com:5432/agentdoor?sslmode=require'
export S3_ENDPOINT='https://restore-s3.internal.example.com'
export S3_BUCKET='agentdoor-restore'
export S3_ACCESS_KEY='REDACTED'
export S3_SECRET_KEY='REDACTED'
infra/deploy/restore.sh
```

The script verifies every checksum before `pg_restore`, restores in one transaction, and mirrors object storage with
deletion of target-only objects. Then run the current migration image, start API/worker, and verify:

- readiness reports database, Redis, and storage as `up`;
- organization, capability, version, installation, and audit counts match the checkpoint;
- a sampled published artifact downloads and matches its stored digest;
- login, refresh rotation, install-plan creation, and one outbox notification succeed.

Keep the old target read-only until business validation completes. Record the recovery point and recovery time.
