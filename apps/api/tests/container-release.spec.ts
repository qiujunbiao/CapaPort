import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

async function source(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), 'utf8');
}

describe('container release contract', () => {
  it('builds separately labelled API, worker, and migration images as a fixed non-root user', async () => {
    const dockerfile = await source('infra/docker/backend.Dockerfile');
    expect(dockerfile).toContain('org.opencontainers.image.revision=$REVISION');
    expect(dockerfile).toContain('USER 10001:10001');
    expect(dockerfile).toContain('FROM runtime AS api');
    expect(dockerfile).toContain('FROM runtime AS worker');
    expect(dockerfile).toContain('FROM runtime AS migrate');
  });

  it('runs production containers with a read-only root filesystem and serialized migrations', async () => {
    const compose = await source('infra/compose/compose.production.yaml');
    const migration = await source('apps/api/src/migrate.ts');
    expect(compose).toContain('read_only: true');
    expect(compose).toContain('user: 10001:10001');
    expect(compose).toContain('no-new-privileges:true');
    expect(compose).not.toMatch(/capaport-(?:jwt|refresh|verification)-development/);
    expect(migration).toContain('pg_advisory_lock');
    expect(migration).toContain('pg_advisory_unlock');
  });

  it('ships immutable multi-platform build, SBOM, scan, smoke, backup and restore automation', async () => {
    await expect(source('scripts/build-images.ts')).resolves.toContain('--platform');
    await expect(source('scripts/build-images.ts')).resolves.toContain('--sbom=true');
    await expect(source('scripts/smoke-stack.ts')).resolves.toContain('restart');
    await expect(source('infra/deploy/backup.sh')).resolves.toContain('pg_dump');
    await expect(source('infra/deploy/restore.sh')).resolves.toContain('pg_restore');
  });

  it('builds Web workspace dependencies inside a clean container', async () => {
    const dockerfile = await source('infra/docker/web.Dockerfile');
    expect(dockerfile).toContain('pnpm turbo run build --filter=@capaport/web');
    expect(dockerfile).not.toContain('pnpm --filter @capaport/web build');
  });

  it('allows the macOS desktop WebView to connect to the local API', async () => {
    const infoPlist = await source('apps/desktop/src-tauri/Info.plist');
    expect(infoPlist).toContain('<key>NSAllowsLocalNetworking</key>');
    expect(infoPlist).toMatch(/<key>NSAllowsLocalNetworking<\/key>\s*<true\s*\/>/);
  });

  it('proxies Web API requests through the same origin', async () => {
    const nginx = await source('infra/docker/nginx.conf');
    expect(nginx).toContain('location /api/');
    expect(nginx).toContain('proxy_pass http://api:3100;');
  });

  it('uses the same-origin API path in Web development and container builds', async () => {
    const main = await source('apps/web/src/main.tsx');
    const vite = await source('apps/web/vite.config.ts');
    const dockerfile = await source('infra/docker/web.Dockerfile');
    expect(main).toContain("'/api/v1'");
    expect(vite).toContain("target: 'http://127.0.0.1:3210'");
    expect(dockerfile).toContain('ARG VITE_API_URL=/api/v1');
  });
});
