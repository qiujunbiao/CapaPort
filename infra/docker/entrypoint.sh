#!/bin/sh
set -eu

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
    echo "Unknown Agentdoor container role: $role" >&2
    exit 64
    ;;
esac
