# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@11.16.0 --activate
WORKDIR /workspace
COPY . .
RUN --mount=type=cache,id=capaport-web-pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
ARG VITE_API_URL=http://127.0.0.1:3210/api/v1
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm turbo run build --filter=@capaport/web

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
LABEL org.opencontainers.image.title="CapaPort Web" \
      org.opencontainers.image.description="CapaPort organization administration console"
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
