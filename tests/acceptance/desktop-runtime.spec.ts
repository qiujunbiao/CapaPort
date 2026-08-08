import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const manifest = 'apps/desktop/src-tauri/Cargo.toml';

function runHarness(): string {
  const cargoAvailable = spawnSync('cargo', ['--version'], { cwd: repositoryRoot, stdio: 'ignore' }).status === 0;
  const result = cargoAvailable
    ? spawnSync('cargo', ['run', '--quiet', '--manifest-path', manifest, '--bin', 'capaport-runtime-harness'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        timeout: 180_000,
      })
    : spawnSync(
        'docker',
        [
          'run',
          '--rm',
          '-v',
          `${repositoryRoot}/apps/desktop/src-tauri:/app`,
          '-v',
          'capaport-cargo-registry:/usr/local/cargo/registry',
          '-w',
          '/app',
          'rust:1.89-slim-bookworm',
          'cargo',
          'run',
          '--quiet',
          '--bin',
          'capaport-runtime-harness',
        ],
        { cwd: repositoryRoot, encoding: 'utf8', timeout: 180_000 },
      );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Rust runtime harness failed.');
  return result.stdout.trim().split('\n').at(-1) ?? '';
}

describe('desktop Rust runtime acceptance', () => {
  it('executes clean update, conflict/import/recovery, and transactional uninstall through Runtime', () => {
    expect(JSON.parse(runHarness())).toEqual({
      cleanUpdate: true,
      conflictBlocked: true,
      localImportExported: true,
      rollbackRecovered: true,
      uninstallRemoved: true,
      uninstallRollbackRecovered: true,
      finalUninstallRemoved: true,
    });
  });
});
