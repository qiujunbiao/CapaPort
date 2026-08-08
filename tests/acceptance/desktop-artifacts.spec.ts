import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createUpdaterManifest } from '../../scripts/create-updater-manifest.js';
import { packageDesktopRelease } from '../../scripts/package-desktop-release.js';

const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => rm(fixture, { recursive: true, force: true })));
});

describe('desktop release artifacts', () => {
  it('writes verifiable checksums and provenance metadata for every bundle file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'capaport-desktop-artifacts-'));
    fixtures.push(root);
    await mkdir(join(root, 'dmg'));
    await writeFile(join(root, 'dmg', 'CapaPort.dmg'), 'signed-bundle');
    const result = await packageDesktopRelease({
      root,
      platform: 'macos',
      arch: 'universal',
      version: '0.2.0',
      commit: 'abc123',
      generatedAt: '2026-08-08T00:00:00.000Z',
    });
    const digest = createHash('sha256').update('signed-bundle').digest('hex');
    expect(await readFile(result.checksumsPath, 'utf8')).toBe(`${digest}  dmg/CapaPort.dmg\n`);
    expect(JSON.parse(await readFile(result.metadataPath, 'utf8'))).toMatchObject({
      version: '0.2.0',
      platform: 'macos',
      arch: 'universal',
      commit: 'abc123',
      artifacts: [{ path: 'dmg/CapaPort.dmg', sha256: digest }],
    });
  });

  it('builds a signed multi-platform Tauri update manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'capaport-updater-manifest-'));
    fixtures.push(root);
    await writeFile(join(root, 'CapaPort.app.tar.gz'), 'mac');
    await writeFile(join(root, 'CapaPort.app.tar.gz.sig'), 'mac-signature');
    await writeFile(join(root, 'CapaPort.nsis.zip'), 'windows');
    await writeFile(join(root, 'CapaPort.nsis.zip.sig'), 'windows-signature');
    const output = join(root, 'latest.json');
    await createUpdaterManifest({
      root,
      version: '0.2.0',
      repository: 'example/capaport',
      tag: 'v0.2.0',
      output,
      publishedAt: '2026-08-08T00:00:00.000Z',
    });
    const manifest = JSON.parse(await readFile(output, 'utf8'));
    expect(manifest.platforms['darwin-aarch64']).toEqual(manifest.platforms['darwin-x86_64']);
    expect(manifest.platforms['windows-x86_64']).toMatchObject({ signature: 'windows-signature' });
    expect(JSON.stringify(manifest)).not.toContain('private');
  });
});
