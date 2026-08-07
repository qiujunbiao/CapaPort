# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@11.16.0 --activate
WORKDIR /workspace

COPY . .
RUN --mount=type=cache,id=agentdoor-pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm --filter @agentdoor/api build
RUN pnpm --filter @agentdoor/api deploy --prod --legacy /deploy

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /deploy/ ./
COPY --from=build --chown=node:node /workspace/apps/api/migrations ./migrations
COPY --from=build --chown=node:node /workspace/infra/docker/entrypoint.sh /usr/local/bin/agentdoor-entrypoint

RUN chmod 0555 /usr/local/bin/agentdoor-entrypoint
USER node
EXPOSE 3100

ENTRYPOINT ["agentdoor-entrypoint"]
CMD ["api"]
