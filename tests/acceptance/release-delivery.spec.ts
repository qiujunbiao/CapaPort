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
    expect(workflow).toContain('universal-apple-darwin');
    expect(workflow).toContain('x86_64-pc-windows-msvc');
    expect(workflow).toContain('APPLE_SIGNING_IDENTITY');
    expect(workflow).toContain('WINDOWS_CERTIFICATE_THUMBPRINT');
    expect(workflow).toContain('capaport-web');
    expect(workflow).toContain('capaport-cli');
    expect(workflow).toContain('pnpm images:build');
    expect(workflow).toContain('anchore/sbom-action');
    expect(workflow).toContain('attest-build-provenance');
    expect(workflow).toContain('package-desktop-release.ts');
    expect(workflow).toContain('SHA256SUMS');
    expect(await source('scripts/package-cli.ts')).toContain('sha256');
  });

  it('injects a real cloud endpoint into release clients and permits secure desktop API traffic', async () => {
    const workflow = await source('.github/workflows/release.yml');
    const tauri = await source('apps/desktop/src-tauri/tauri.conf.json');
    expect(workflow).toContain('CAPAPORT_API_URL');
    expect(workflow).not.toContain('https://capaport.example');
    expect(tauri).toContain("connect-src 'self' https:");
    expect(tauri).toContain('github.com/qiujunbiao/CapaPort/releases/latest/download/latest.json');
  });

  it('ships an executable Rust runtime acceptance harness instead of source-string assertions', async () => {
    const harness = await source('apps/desktop/src-tauri/src/bin/runtime_harness.rs');
    const test = await source('tests/acceptance/desktop-runtime.spec.ts');
    expect(harness).toContain('Runtime::new');
    expect(harness).toContain('preview_install');
    expect(harness).toContain('apply_install');
    expect(harness).toContain('export_local_package');
    expect(harness).toContain('rollback_install');
    expect(harness).toContain('uninstall');
    expect(test).toContain('capaport-runtime-harness');
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

  it('keeps every authenticated smoke-test mutation on the idempotent API contract', async () => {
    for (const path of [
      'apps/api/scripts/publication-real-e2e.mjs',
      'apps/api/scripts/distribution-real-e2e.mjs',
      'apps/api/scripts/operations-real-e2e.mjs',
    ]) {
      const script = await source(path);
      expect(script).toContain("!['GET', 'HEAD', 'OPTIONS'].includes(method)");
      expect(script).toContain("'idempotency-key': randomUUID()");
    }
  });
});
