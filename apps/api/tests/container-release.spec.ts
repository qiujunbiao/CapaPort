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
    expect(compose).not.toMatch(/agentdoor-(?:jwt|refresh|verification)-development/);
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
    expect(dockerfile).toContain('pnpm turbo run build --filter=@agentdoor/web');
    expect(dockerfile).not.toContain('pnpm --filter @agentdoor/web build');
  });
});
