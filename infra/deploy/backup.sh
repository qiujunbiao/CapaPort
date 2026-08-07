#!/bin/sh
set -eu

: "${DATABASE_URL:?Set DATABASE_URL to the source database}"
: "${S3_ENDPOINT:?Set S3_ENDPOINT}"
: "${S3_BUCKET:?Set S3_BUCKET}"
: "${S3_ACCESS_KEY:?Set S3_ACCESS_KEY}"
: "${S3_SECRET_KEY:?Set S3_SECRET_KEY}"

backup_root="${BACKUP_ROOT:-./backups}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
final_dir="$backup_root/$timestamp"
mkdir -p "$backup_root"
partial_dir="$(mktemp -d "$backup_root/.partial-$timestamp-XXXXXX")"
trap 'rm -rf "$partial_dir"' EXIT INT TERM

command -v pg_dump >/dev/null 2>&1 || { echo 'pg_dump is required' >&2; exit 69; }
command -v mc >/dev/null 2>&1 || { echo 'MinIO mc is required' >&2; exit 69; }
[ ! -e "$final_dir" ] || { echo 'Backup destination already exists' >&2; exit 73; }

pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl --file="$partial_dir/database.dump"
mc alias set agentdoor-backup "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null
mc mirror --overwrite "agentdoor-backup/$S3_BUCKET" "$partial_dir/objects"

(cd "$partial_dir" && find . -type f -print | LC_ALL=C sort | xargs shasum -a 256 > SHA256SUMS)
cat > "$partial_dir/metadata.json" <<EOF
{"formatVersion":1,"createdAt":"$timestamp","database":"postgres-custom","bucket":"$S3_BUCKET"}
EOF
chmod -R go-rwx "$partial_dir"
mv "$partial_dir" "$final_dir"
trap - EXIT INT TERM
printf '%s\n' "$final_dir"
