import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function source(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), 'utf8');
}

describe('release delivery contract', () => {
  it('ships a one-command full local stack with Web and hardened backend services', async () => {
    const compose = await source('infra/compose/compose.yaml');
    const packageJson = await source('package.json');
    expect(packageJson).toContain('docker compose -f infra/compose/compose.yaml up -d --build --wait');
    expect(compose).toContain('web:');
    expect(compose).toContain('api:');
    expect(compose).toContain('worker:');
    expect(compose).toContain('migrate:');
    expect(compose).toContain('read_only: true');
  });

  it('builds signed macOS and Windows bundles, Web assets, CLI checksums, and immutable images', async () => {
    const workflow = await source('.github/workflows/release.yml');
    expect(workflow).toContain('macos-14');
    expect(workflow).toContain('windows-2025');
    expect(workflow).toContain('APPLE_SIGNING_IDENTITY');
    expect(workflow).toContain('WINDOWS_CERTIFICATE_THUMBPRINT');
    expect(workflow).toContain('agentdoor-web');
    expect(workflow).toContain('agentdoor-cli');
    expect(workflow).toContain('pnpm images:build');
    expect(await source('scripts/package-cli.ts')).toContain('sha256');
  });

  it('contains runnable user, administrator, security, operations, and acceptance documentation', async () => {
    for (const path of [
      'README.md',
      'CHANGELOG.md',
      'docs/user-guide/getting-started.md',
      'docs/user-guide/capabilities.md',
      'docs/user-guide/desktop.md',
      'docs/user-guide/cli.md',
      'docs/admin-guide/setup.md',
      'docs/admin-guide/governance.md',
      'docs/admin-guide/security.md',
      'docs/admin-guide/operations.md',
      'docs/admin-guide/release-signing.md',
      'docs/acceptance-report.md',
    ]) {
      await expect(access(resolve(repositoryRoot, path))).resolves.toBeUndefined();
    }
  });
});
