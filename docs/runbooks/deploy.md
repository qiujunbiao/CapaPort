# Production deployment

Agentdoor uses three immutable images built from one source revision: `agentdoor-api`, `agentdoor-worker`, and
`agentdoor-migrate`. Database migrations must remain backward compatible with the previous application version.

## Prerequisites

- Docker Engine 27+ with Buildx and Compose v2
- PostgreSQL 17, Redis 7, S3-compatible object storage, and SMTP reachable from the backend network
- Trivy or Docker Scout on the release builder
- TLS termination and rate limiting at the ingress; expose only the API port

## Build and publish

From a clean, reviewed Git revision:

```sh
export AGENTDOOR_REGISTRY=registry.example.com/agentdoor
export AGENTDOOR_VERSION=0.1.0
export AGENTDOOR_REVISION="$(git rev-parse HEAD)"
pnpm images:build --registry "$AGENTDOOR_REGISTRY" --version "$AGENTDOOR_VERSION" --revision "$AGENTDOOR_REVISION"
```

The command publishes `linux/amd64` and `linux/arm64` manifests, build provenance, and SBOM attestations; it then
fails on fixed high or critical vulnerabilities. The immutable deployment tag is
`$AGENTDOOR_VERSION-${AGENTDOOR_REVISION%${AGENTDOOR_REVISION#????????????}}` and is recorded in
`reports/images.json`.

## Configure secrets

Copy `infra/compose/.env.production.example` outside the repository, fill every endpoint, and set
`AGENTDOOR_IMAGE_TAG` to the immutable build tag. Create mode-0600 files in `AGENTDOOR_SECRETS_DIR`:

```text
database_url
s3_access_key
s3_secret_key
jwt_secret
refresh_token_pepper
verification_pepper
metrics_token
```

The JWT secret and three peppers/tokens must each contain at least 32 random characters. Never reuse development
values. Keep the previous image tag and a verified backup before release.

## Release

```sh
export AGENTDOOR_PRODUCTION_ENV=/etc/agentdoor/agentdoor.env
export AGENTDOOR_IMAGE_TAG=0.1.0-0123456789ab
infra/deploy/release.sh
```

The release script locks concurrent releases, validates Compose, pulls all images, runs the advisory-lock-protected
migration job, replaces API and worker, waits for readiness, and checks the ready endpoint. After it succeeds:

```sh
curl --fail http://127.0.0.1:3210/api/v1/health/ready
curl --fail -H "Authorization: Bearer $(cat /etc/agentdoor/secrets/metrics_token)" \
  http://127.0.0.1:3210/api/v1/metrics
```

Check authentication, capability search, the outbox backlog, error rate, and worker failures before closing the
change. Do not reverse a database migration during an application rollout.
