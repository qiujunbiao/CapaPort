# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@11.16.0 --activate
WORKDIR /workspace

COPY . .
RUN --mount=type=cache,id=agentdoor-pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=agentdoor-pnpm-metadata,target=/root/.cache/pnpm \
    pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@agentdoor/api
RUN --mount=type=cache,id=agentdoor-pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=agentdoor-pnpm-metadata,target=/root/.cache/pnpm \
    pnpm --filter @agentdoor/api deploy --prod --legacy /deploy

FROM node:22-alpine AS runtime

ARG VERSION=development
ARG REVISION=unknown
ARG SOURCE=https://github.com/agentdoor/agentdoor
LABEL org.opencontainers.image.title="Agentdoor backend" \
      org.opencontainers.image.description="Agentdoor modular-monolith backend" \
      org.opencontainers.image.version=$VERSION \
      org.opencontainers.image.revision=$REVISION \
      org.opencontainers.image.source=$SOURCE \
      org.opencontainers.image.licenses="Apache-2.0"

ENV NODE_ENV=production \
    AGENTDOOR_VERSION=$VERSION
WORKDIR /app

RUN apk add --no-cache tini \
    && addgroup -S -g 10001 agentdoor \
    && adduser -S -D -H -u 10001 -G agentdoor agentdoor

COPY --from=build --chown=10001:10001 /deploy/ ./
COPY --from=build --chown=10001:10001 /workspace/apps/api/migrations ./migrations
COPY --from=build --chown=10001:10001 /workspace/infra/docker/entrypoint.sh /usr/local/bin/agentdoor-entrypoint

RUN chmod 0555 /usr/local/bin/agentdoor-entrypoint \
    && find /app -type d -exec chmod 0555 {} + \
    && find /app -type f -exec chmod 0444 {} +
USER 10001:10001
STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--", "agentdoor-entrypoint"]

FROM runtime AS worker
CMD ["worker"]

FROM runtime AS migrate
CMD ["migrate"]

FROM runtime AS api
EXPOSE 3100
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3100/api/v1/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["api"]
