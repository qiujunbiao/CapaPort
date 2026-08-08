#!/bin/sh
set -eu

load_secret() {
  variable_name="$1"
  file_path="$2"
  [ -z "$file_path" ] && return 0
  [ -f "$file_path" ] || {
    echo "Secret file for $variable_name is unavailable" >&2
    exit 78
  }
  value="$(tr -d '\r\n' < "$file_path")"
  [ -n "$value" ] || {
    echo "Secret file for $variable_name is empty" >&2
    exit 78
  }
  export "$variable_name=$value"
}

load_secret DATABASE_URL "${DATABASE_URL_FILE:-}"
load_secret S3_ACCESS_KEY "${S3_ACCESS_KEY_FILE:-}"
load_secret S3_SECRET_KEY "${S3_SECRET_KEY_FILE:-}"
load_secret JWT_SECRET "${JWT_SECRET_FILE:-}"
load_secret REFRESH_TOKEN_PEPPER "${REFRESH_TOKEN_PEPPER_FILE:-}"
load_secret VERIFICATION_PEPPER "${VERIFICATION_PEPPER_FILE:-}"
load_secret METRICS_TOKEN "${METRICS_TOKEN_FILE:-}"
load_secret SMS_PROVIDER_TOKEN "${SMS_PROVIDER_TOKEN_FILE:-}"

role="${1:-api}"

case "$role" in
  api)
    exec node dist/main.js
    ;;
  worker)
    exec node dist/worker.js
    ;;
  migrate)
    exec node dist/migrate.js
    ;;
  *)
    echo "Unknown CapaPort container role: $role" >&2
    exit 64
    ;;
esac
