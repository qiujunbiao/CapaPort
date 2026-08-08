import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDiagnosticPayload } from '../../apps/desktop/src/features/settings/settings-page.js';

const root = resolve(import.meta.dirname, '../..');
const rustMain = readFileSync(join(root, 'apps/desktop/src-tauri/src/main.rs'), 'utf8');
const rustErrors = readFileSync(join(root, 'apps/desktop/src-tauri/src/error.rs'), 'utf8');
const rustFiles = readFileSync(join(root, 'apps/desktop/src-tauri/src/files/mod.rs'), 'utf8');
const capability = JSON.parse(readFileSync(join(root, 'apps/desktop/src-tauri/capabilities/default.json'), 'utf8'));
const tauriConfig = JSON.parse(readFileSync(join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'));

describe('desktop security gate', () => {
  it('exposes only the reviewed typed command allowlist and no shell or unrestricted filesystem plugin', () => {
    const block = /generate_handler!\[([\s\S]*?)\]\)/.exec(rustMain)?.[1];
    expect(block).toBeDefined();
    if (!block) throw new Error('Tauri command handler was not found.');
    const commands = block
      .split(',')
      .map((command) => command.trim())
      .filter(Boolean)
      .sort();
    expect(commands).toEqual([
      'apply_install',
      'bind_project_directory',
      'claim_ready_writes',
      'clear_session',
      'complete_write',
      'detect_agents',
      'enqueue_write',
      'export_local_package',
      'export_project_context',
      'inventory_agent',
      'inventory_project_context',
      'list_project_bindings',
      'load_install_lock',
      'load_session',
      'preview_install',
      'project_context_plan',
      'read_managed_file',
      'remove_project_binding',
      'reschedule_write',
      'retry_failed_writes',
      'rollback_install',
      'scan_local_package',
      'store_session',
      'sync_queue_status',
      'uninstall',
    ]);
    expect(capability.permissions).toEqual(['core:default', 'updater:default', 'process:allow-restart']);
    expect(JSON.stringify(capability)).not.toMatch(/shell:|fs:|remote/i);
  });

  it('pins a signing public key, produces updater artifacts, and refuses insecure update transport', () => {
    expect(tauriConfig.bundle.createUpdaterArtifacts).toBe(true);
    const updater = tauriConfig.plugins.updater;
    expect(Buffer.from(updater.pubkey, 'base64').toString('utf8')).toContain('minisign public key');
    expect(updater.pubkey).not.toMatch(/placeholder|your public key/i);
    expect(updater.endpoints).toHaveLength(1);
    expect(updater.endpoints.every((endpoint: string) => endpoint.startsWith('https://'))).toBe(true);
    expect(updater.dangerousInsecureTransportProtocol).toBe(false);
    expect(rustMain).toContain('tauri_plugin_updater::Builder::new().build()');
    expect(rustMain).toContain('tauri_plugin_process::init()');
  });

  it('redacts diagnostics and serializes only stable Rust command error codes', () => {
    const serialized = JSON.stringify(
      createDiagnosticPayload({
        online: true,
        queue: { pending: 1, failed: 0 },
        generatedAt: new Date(0),
        clientVersion: '0.1.0',
      }),
    );
    expect(serialized).not.toMatch(/token|refresh|user|organization|\/Users|[A-Z]:\\/i);
    expect(rustErrors).toContain('command_errors_only_serialize_stable_codes');
    expect(rustErrors).not.toContain('format!("{value:?}")');
  });

  it('keeps rollback fault injection and manual recovery assertions in the executable Rust suite', () => {
    expect(rustFiles).toContain('apply_with_failures');
    expect(rustFiles).toContain('restores_the_first_file_when_a_later_write_fails');
    expect(rustFiles).toContain('manual_recovery_required');
    expect(rustFiles).toContain('LocalModificationConflict');
  });

  it('makes the security gate fail closed for an intentionally vulnerable fixture', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'capaport-security-probe-'));
    const report = join(directory, 'report.json');
    const result = spawnSync(
      'pnpm',
      ['exec', 'tsx', 'scripts/security-gate.ts', '--probe-vulnerability', '--report', report],
      { cwd: root, encoding: 'utf8' },
    );
    expect(result.status).not.toBe(0);
    const machineReport = JSON.parse(readFileSync(report, 'utf8'));
    expect(machineReport.status).toBe('failed');
    expect(machineReport.summary.critical).toBeGreaterThan(0);
  });
});
