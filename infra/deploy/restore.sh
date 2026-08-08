#!/bin/sh
set -eu

: "${CONFIRM_RESTORE:?Set CONFIRM_RESTORE=RESTORE to acknowledge target replacement}"
[ "$CONFIRM_RESTORE" = RESTORE ] || { echo 'CONFIRM_RESTORE must equal RESTORE' >&2; exit 64; }
: "${BACKUP_DIR:?Set BACKUP_DIR to a verified CapaPort backup}"
: "${DATABASE_URL:?Set DATABASE_URL to the restore target}"
: "${S3_ENDPOINT:?Set S3_ENDPOINT}"
: "${S3_BUCKET:?Set S3_BUCKET}"
: "${S3_ACCESS_KEY:?Set S3_ACCESS_KEY}"
: "${S3_SECRET_KEY:?Set S3_SECRET_KEY}"

command -v pg_restore >/dev/null 2>&1 || { echo 'pg_restore is required' >&2; exit 69; }
command -v mc >/dev/null 2>&1 || { echo 'MinIO mc is required' >&2; exit 69; }
[ -f "$BACKUP_DIR/database.dump" ] && [ -f "$BACKUP_DIR/SHA256SUMS" ] || {
  echo 'Backup is incomplete' >&2
  exit 65
}

(cd "$BACKUP_DIR" && shasum -a 256 -c SHA256SUMS)
pg_restore --dbname="$DATABASE_URL" --clean --if-exists --no-owner --no-acl --single-transaction "$BACKUP_DIR/database.dump"
mc alias set capaport-restore "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null
mc mirror --overwrite --remove "$BACKUP_DIR/objects" "capaport-restore/$S3_BUCKET"
printf '%s\n' 'Restore completed and checksums verified.'
