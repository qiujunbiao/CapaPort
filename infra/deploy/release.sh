#!/bin/sh
set -eu

: "${AGENTDOOR_IMAGE_TAG:?Set immutable AGENTDOOR_IMAGE_TAG}"
case "$AGENTDOOR_IMAGE_TAG" in latest|*latest*|'') echo 'Mutable image tags are forbidden' >&2; exit 64;; esac
: "${AGENTDOOR_PRODUCTION_ENV:?Set AGENTDOOR_PRODUCTION_ENV to the production env file}"

compose_file="${AGENTDOOR_COMPOSE_FILE:-infra/compose/compose.production.yaml}"
lock_dir="${AGENTDOOR_RELEASE_LOCK:-/tmp/agentdoor-release.lock}"
mkdir "$lock_dir" 2>/dev/null || { echo 'Another release is in progress' >&2; exit 75; }
trap 'rmdir "$lock_dir"' EXIT INT TERM

docker compose --env-file "$AGENTDOOR_PRODUCTION_ENV" -f "$compose_file" config --quiet
docker compose --env-file "$AGENTDOOR_PRODUCTION_ENV" -f "$compose_file" pull api worker migrate
docker compose --env-file "$AGENTDOOR_PRODUCTION_ENV" -f "$compose_file" run --rm migrate
docker compose --env-file "$AGENTDOOR_PRODUCTION_ENV" -f "$compose_file" up -d --no-deps --wait api worker
curl --fail --silent --show-error "${AGENTDOOR_HEALTH_URL:-http://127.0.0.1:3210/api/v1/health/ready}" >/dev/null
printf '%s\n' "Released $AGENTDOOR_IMAGE_TAG"
