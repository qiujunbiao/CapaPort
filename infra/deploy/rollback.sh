#!/bin/sh
set -eu

: "${CAPAPORT_ROLLBACK_TAG:?Set CAPAPORT_ROLLBACK_TAG to the prior immutable application tag}"
case "$CAPAPORT_ROLLBACK_TAG" in latest|*latest*|'') echo 'Mutable image tags are forbidden' >&2; exit 64;; esac
: "${CAPAPORT_PRODUCTION_ENV:?Set CAPAPORT_PRODUCTION_ENV}"

export CAPAPORT_IMAGE_TAG="$CAPAPORT_ROLLBACK_TAG"
compose_file="${CAPAPORT_COMPOSE_FILE:-infra/compose/compose.production.yaml}"
docker compose --env-file "$CAPAPORT_PRODUCTION_ENV" -f "$compose_file" pull api worker
docker compose --env-file "$CAPAPORT_PRODUCTION_ENV" -f "$compose_file" up -d --no-deps --wait api worker
curl --fail --silent --show-error "${CAPAPORT_HEALTH_URL:-http://127.0.0.1:3210/api/v1/health/ready}" >/dev/null
printf '%s\n' "Rolled application containers back to $CAPAPORT_ROLLBACK_TAG; database migrations were not reversed."
