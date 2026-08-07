# Backup

Back up PostgreSQL and the S3 bucket at the same operational checkpoint. The script produces a private,
timestamped directory containing a PostgreSQL custom archive, mirrored objects, checksums, and metadata.

Install PostgreSQL client tools and MinIO `mc`, then provide credentials without command-line interpolation:

```sh
export DATABASE_URL='postgres://backup-user:REDACTED@db.example.com:5432/agentdoor?sslmode=require'
export S3_ENDPOINT='https://s3.internal.example.com'
export S3_BUCKET='agentdoor-production'
export S3_ACCESS_KEY='REDACTED'
export S3_SECRET_KEY='REDACTED'
export BACKUP_ROOT='/srv/agentdoor-backups'
umask 077
infra/deploy/backup.sh
```

Copy the completed timestamp directory to encrypted off-site storage. A directory named `.partial-*` is never a
valid backup. Test the newest backup weekly in an isolated restore target and retain the output of checksum and row/
object count verification. Rotate backup credentials independently of application credentials.
