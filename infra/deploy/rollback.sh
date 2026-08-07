#!/bin/sh
set -eu

: "${AGENTDOOR_ROLLBACK_TAG:?Set AGENTDOOR_ROLLBACK_TAG to the prior immutable application tag}"
case "$AGENTDOOR_ROLLBACK_TAG" in latest|*latest*|'') echo 'Mutable image tags are forbidden' >&2; exit 64;; esac
: "${AGENTDOOR_PRODUCTION_ENV:?Set AGENTDOOR_PRODUCTION_ENV}"

export AGENTDOOR_IMAGE_TAG="$AGENTDOOR_ROLLBACK_TAG"
compose_file="${AGENTDOOR_COMPOSE_FILE:-infra/compose/compose.production.yaml}"
docker compose --env-file "$AGENTDOOR_PRODUCTION_ENV" -f "$compose_file" pull api worker
docker compose --env-file "$AGENTDOOR_PRODUCTION_ENV" -f "$compose_file" up -d --no-deps --wait api worker
curl --fail --silent --show-error "${AGENTDOOR_HEALTH_URL:-http://127.0.0.1:3210/api/v1/health/ready}" >/dev/null
printf '%s\n' "Rolled application containers back to $AGENTDOOR_ROLLBACK_TAG; database migrations were not reversed."
